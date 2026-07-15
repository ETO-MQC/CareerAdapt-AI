# P3.6 通用简历导入实施说明

## 1. 范围与状态

本轮在起始提交 `7a23b5fd7a3042bc5037f39458ebad2bde3277b4` 上连续完成 P3.6a、P3.6b、P3.6c、P3.6d。没有新增 Dexie 表、生产 npm 依赖或新的 Revision 系统；没有修改 Fact Guard 阈值、通用/岗位分支隔离和 PDF 导出语义。

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| JSON v1/v2 | 正式支持 | 标准 JSON 确定性适配；外部 JSON 保留未知叶子并可进入受限 AI 映射 |
| 数字 PDF | 正式支持 | PDF.js 坐标行重建、阅读顺序恢复、页码/bbox/引擎版本追踪 |
| DOCX | 正式支持，带限制 | 保留段落、标题、列表、表格行列和单元格；浮动文本框/复杂绘图无法保证 |
| 图片/扫描 PDF | 本地实验支持 | 通过 localhost PaddleOCR-VL sidecar；不可用时明确提示并保留当前草稿/文件选择 |
| OpenDataLoader | 技术探针，未采用 | 两份黄金样本表现良好，但引入 Java/Python sidecar 与部署体积，不作为浏览器产品默认路径 |
| AI 字段映射 | 正式受限支持 | 只产生可核对草稿，按 Catalog 校验目标、来源块和逐字引文 |
| 原模板视觉复刻 | 尚未完成 | 本轮恢复内容与阅读顺序，不复刻第三方简历视觉样式 |

## 2. 统一管线

```text
PDF / DOCX / JSON / 图片
→ 文件与质量分类
→ 格式 Adapter
→ ResumeSourceBlock[]
→ 确定性清洗与阅读顺序
→ ImportQualityReport
→ Catalog 字段/时间候选
→ 可选 AI 映射
→ 来源、数值与类型验证
→ ImportedResumeDraft v2
→ 用户逐项核对
→ WorkspaceRepository
→ CareerProfile / ResumeBranch / ResumeRevision
```

正式来源块保留稳定 `id`、`sourceKind`、页码或 JSON 路径、原文、规范化文本、bbox、顺序、父子关系、解析引擎/版本、提取置信度和清洗动作。质量报告记录分类、推荐管线、页数、文本/坐标覆盖、乱码/碎片指标、OCR 页和实际阈值，因此路由不是仅供展示的标签。

兼容边界：旧 `resume-import-v1` 草稿仍可读取；新解析结果写 `resume-import-v2`。确认提交继续走现有 Repository 事务，并在写入前验证来源引用、引文、数值和待确认状态。

## 3. P3.6a：来源块与质量路由

- `standard_json`、`external_json`、`docx`、`digital_pdf`、`complex_digital_pdf`、`scanned_pdf`、`image` 使用统一分类。
- 旧 `text_pdf` 只保留为兼容输入；新 PDF 解析写正式数字/复杂/扫描分类。
- OCR 成功块带 `paddleocr_vl` 引擎证据，直接进入人工核对，不重复触发 OCR。
- 空文本、空 highlights 和无有效条目不会伪造成正式 section；未知 JSON 叶子和无可靠目标块进入 `unclassifiedBlocks`。
- JSON 来源块 ID 使用准确 sourcePath，避免 MappingDecision 引用一个与真实来源路径无关的临时编号。

## 4. P3.6b：PDF 与 DOCX 正常化

### 4.1 PDF

根因是旧流程虽读取了 PDF.js 坐标，却仍主要依赖内部对象顺序拼接，导致同一视觉行、右对齐日期和双栏内容可能错序。新路径在文本进入 parser 前执行：

- 按 transform/bbox 与字体高度计算视觉基线；
- 合并同一视觉行并保留右侧日期；
- 检测简单双栏，按标题/列顺序输出；
- 生成稳定 `pdf:{page}:line:{order}` 来源块；
- 标记标题、联系人、日期行、列表项和普通段落；
- 记录坐标覆盖、列数和阅读顺序置信度。

当前没有做主观的“补字”、职位改写或数字纠正。复杂重叠文本框、水印和真正杂志式版面仍可能需要 OCR/人工核对。

### 4.2 DOCX

DOCX Adapter 继续解析 `document.xml`，并补充：

- 表格 row/cell 稳定 ID、`parentId`、`rowIndex`、`columnIndex`；
- 列表编号父级与文档顺序；
- tab、显式换行和表格单元格文本；
- 解析引擎/版本和结构质量指标。

浮动文本框、SmartArt、绘图层和嵌入图片文字无法由当前 XML 正文路径可靠读取时会保留警告，建议改用原 PDF 或本地 OCR，不会声称完整解析。

## 5. P3.6c：本地 PaddleOCR-VL

浏览器只调用同源 `/api/resume-import/ocr`；该 Route 只允许配置为 localhost 的 sidecar，校验文件类型与 30 MB 上限，支持 health、token、超时和取消。Python sidecar：

- 只绑定 `127.0.0.1`；
- 从 `PADDLEOCR_VL_MODEL_DIR` 延迟加载现有模型；
- 不复制模型进仓库，不记录简历正文或敏感字段；
- 将 Paddle 结果隔离转换为严格 OCR Schema；
- 完成后清理单个临时文件；
- 返回页级进度、引擎版本、bbox 和规范化块。

本机真实验证：使用已存在的 PaddleOCR-VL-1.6 模型和独立 Python venv 成功初始化并识别两份黄金 PDF；修复 sidecar 对 `PaddleOCRVLResult` 的结果展开后，API 探针返回 1 页、46 个块、46 个 bbox、1484 个可见字符，端到端约 56.2 秒。详细配置与限制见 `P36_LOCAL_OCR_SETUP.md`。

## 6. P3.6d：Catalog 字段、时间与来源验证

- 确定性候选以 Resume Schema v2 Catalog 为目标，只创建存在的 canonical field。
- 当前规则覆盖邮箱、电话、链接、GPA/满分、排名/总人数，以及教育/工作/实习/项目/科研/校园/志愿栏目的起止时间和 current。
- 日期保留 `year`、`month`、`day`、`current` 精度；只有年份时不伪造月份/日期，`Present/至今` 不伪造当前系统日期。
- 候选保存 `sourceBlockIds`、`sourceQuote`、置信度、理由和可选 dateValue。
- 校验拒绝未知来源、无法定位引文、数字漂移、值类型不匹配；一个来源块映射多个目标时必须逐项确认。
- AI prompt 禁止润色、补写、数字变换和日期精度升级；任务注册表校验 Catalog 目标、来源块、逐字引文和全部来源块去向。
- `buildResumeImportConfirmation()` 在 Repository 写入前再次阻止未确认字段候选。

当前字段候选保存在导入草稿并接受用户确认；它们没有绕过既有 `ImportedResumeItem`/Repository 投影直接修改派生 ResumeDocument。

## 7. 核对 UI

- 左侧新增“来源类型/来源块、处理路线/字段候选、未识别保留”紧凑摘要；不暴露内部工程枚举。
- 字段候选显示 Catalog 名称、逐字值、日期精度、置信度和独立确认按钮；一源多字段不能批量静默确认。
- 基本字段和条目的来源证据恢复为可点击按钮，点击后联动左侧来源。
- OCR 展示页级进度、可取消状态；PDF 无可用文本层时自动转本地 OCR，失败后保留明确重试/人工路径。
- 异步状态使用独立 `aria-live`，页码有 `aria-current`，来源和字段证据有键盘焦点/选择状态，滚动区使用 `overscroll-behavior: contain`。

五档视口前后证据位于：

- `artifacts/p36-universal-import-before/`
- `artifacts/p36-universal-import-after/`

1024×768 结果：根横向溢出 0；模态 962.55×675.83；来源/结构列 311.63/604.92；两侧 clientHeight 均 443；结构 scrollHeight 从 986 降到 901；Footer 可达且模态未越界。

## 8. 隐私、安全与持久化

- 用户提供的真实 PDF 原件、OCR 文本、临时图片、模型、缓存和本机绝对路径均未进入仓库。
- 探针只记录页数、字符/数字统计、耗时、引擎和资源占用，不记录姓名、电话、邮箱、地址或正文。
- OCR/AI 输出必须先过严格 Schema 与来源验证，再进入核对草稿；未经用户确认不能进入预览或 PDF。
- 未新增 Dexie 表；没有直接持久化派生 ResumeDocument；历史 Revision 不重写。
- `.env.example` 只包含占位符，真实模型目录、token 和 API key 留在本地环境。

## 9. 验证摘要

最终门禁均在 Node 24.15.0 / pnpm 10.29.2 下执行：

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `pnpm typecheck` | 0 | 通过；一次与 `next build` 并发时因 `.next/types` 重写失败，随后独立顺序复跑通过，属于门禁编排竞争 |
| `pnpm lint` | 0 | 通过，0 warning |
| `pnpm test` | 0 | 44 files / 219 tests 通过 |
| `pnpm build` | 0 | 通过；包含 `/api/resume-import/ocr` Route |
| `pnpm test:c1:eval` | 0 | 1/1，通过，约 144.19 s |
| `pnpm test:c2:eval` | 0 | 1/1，通过，约 100.60 s |
| `git diff --check` | 0 | 通过，仅有仓库既有 LF/CRLF 提示 |

当前导入入口的 Playwright 最终定向套件为 15/15：`pdfProbe` 1/1、Resume Schema v2 栏目/1024×768 1/1、Stage E1 PDF 3/3、G4a 当前 PDF 导入与 PDF 导出 2/2、G7b.2 统一 JSON/导入核对 8/8。另有当前 Plan3/Stage B 交互 11/11 通过；测试只更新了折叠岗位表单入口和多通知队列的精确定位，没有降低断言或添加 skip。

四分片全量 E2E 的原始命令与拆分结果：

| shard | 原始命令 | 原始结果 | 文件拆分证据 |
| --- | --- | --- | --- |
| 1/4 | `--shard=1/4 --workers=4` | 工具上限约 604 s，退出码 124，无 aggregate | E1 33/33；D1 0/1；D2 整文件约 304 s 超时，代表场景 0/1。失败停在未显式选择通用简历 |
| 2/4 | `--shard=2/4 --workers=4` | 工具上限约 604 s，退出码 124，无 aggregate | 当前入口组 16/16；Stage C/D 0/4；G0a/G1a/G1b 0/14；G2/G3 共用旧 helper 的代表场景 0/1 |
| 3/4 | `--shard=3/4 --workers=4` | 工具上限约 604 s，退出码 124，无 aggregate | G2 0/4、G3a 0/7、G3b 0/2；G4/G5 整文件再次超时，拆出的旧 PDF 入口代表场景 0/3 |
| 4/4 | `--shard=4/4 --workers=4` | 退出码 1，约 304 s | 28 passed / 12 failed / 1 skipped；G4a 2/2、G5a 5/5、G7b.2 导入 8/8 均通过 |

全量历史套件不得记为通过。主要 P2 测试债是旧 fixture 仍直接点击当前正确禁用的 `run-experience-match`、依赖已隐藏的 `create-suggestion-draft`，或查找已经被统一导入模态替代的顶层 PDF dropzone。shard 4 的 skip 是仓库既有、需显式 `G7B2_VISUAL_ACCEPTANCE=1` 的 60 图视觉证据场景；本轮没有新增 skip。另有少量独立旧 UI/fixture 断言漂移（资料归档列表、旧支持格式行、资料库经历种子），均记录为 P2，不通过删测试或放宽正式 Schema 处理。

本轮 P3.6 定向链路、Unit/Integration、build、C1/C2 均通过，未发现 P0/P1。历史 Playwright 前置债不属于导入 Domain 回归，但需要后续单独把旧 branch fixture 迁移到“显式选择通用简历 → 匹配 → 直接派生”的当前流程后，才能宣称全量 E2E 通过。

## 10. 已知限制

- PaddleOCR-VL-1.6 本机加载后占用约 7.9 GB GPU 显存，8 GB 显卡余量很小；不能承诺并发或所有 8 GB 设备稳定。
- 本机有 Paddle 编译 cuDNN 9.9 与运行时 9.5 警告；实测成功，但属于部署风险。
- PaddleOCR-VL 当前结果没有稳定、统一的逐块置信度，Adapter 缺失时保守写 0.7；所有 OCR 映射仍需用户确认。
- 两份黄金 PDF 可完成内容提取和来源块生成，但本轮没有提交包含隐私信息的逐字段 expected fixture；因此不能宣称生产级字段 precision/recall 已由公开 fixture 证明。
- 图标化电话/邮箱、浮动文本框、复杂水印、跨页表格和视觉模板复刻仍可能需要人工核对。
- 百度千帆在线 Adapter 尚未实现；后续可复用 `ResumeOcrAdapter` 的 health、recognize、engine info、timeout/cancel/progress 和严格输出 Schema，不应另建提交分叉。

# V2-G3a：直接 PDF 下载与可靠导出增强

状态：实现完成，等待 G2/G3a 联合独立验收。

日期：2026-07-04

## 1. 基线核查

- G2 模板中心已落地 4 套模板：`classic-technical`、`modern-operations`、`ats-minimal`、`business-consulting`。
- A4 预览、浏览器打印、overflow 测量、`presentationRevision`、`presentationSnapshot` 和 ExportRecord 已存在。
- Dexie 业务 schema 仍为 v7；本轮未新增表、未升级 Dexie、未持久化 ResumeDocument。
- 当前数据仍在浏览器 IndexedDB，Next API 不能直接读取用户本地 Dexie 数据。

## 2. 技术方案评估

### 方案 A：服务端/本地 Headless Chromium

采用。

- 使用现有 Playwright 能力，不新增 Chromium 或 PDF 依赖。
- 客户端在点击时冻结 `ResumeRenderModel` 与 `ResumePresentationConfig`，POST 到本地 Next API。
- API 使用同一套模板 Registry、同一套 renderer、同一份打印 CSS 和 Playwright Chromium/Edge 生成 A4 PDF。
- 运行时优先启动系统 Edge channel，失败时回退 Playwright 默认 Chromium。
- 不写临时 HTML/PDF 文件，PDF buffer 直接返回。

风险与处理：

- 生产部署若仅安装 production dependencies，`@playwright/test` 作为 devDependency 可能不可用；当前项目定位为本地优先，`pnpm build` 已验证通过。若进入云部署，应单独把运行时浏览器依赖提升为正式依赖或服务能力。
- Windows 路径含空格已通过当前仓库路径 `E:\DEF\CareerAdapt AI` 验证。

### 方案 B：浏览器端 HTML 转 PDF 库

未采用。

- 中文字体、A4 精度、双栏布局和文本可抽取性风险较高。
- 常见实现容易把页面转为图片，不能满足正式文本 PDF 要求。
- 会增加前端包体积。

### 方案 C：pdf-lib 重新绘制

未采用。

- 必须维护第二套排版系统，无法保证与正式模板 renderer 一致。
- 只保留为 fixture 或轻量 PDF 检查工具。

### 方案 D：仅增强浏览器打印

未采用为主方案。

- 浏览器打印继续保留为 fallback。
- 单独浏览器打印不满足“直接 PDF 下载”目标。

## 3. 直接下载流程

```text
点击“下载 PDF”
-> 读取当前 A4 DOM overflow
-> 冻结 renderModel、presentationConfig、文件名、时间和 snapshotHash
-> 重新读取最新 branch/profile/job，确认正文 revision 仍匹配启动快照
-> POST /api/resume-export/pdf
-> API 校验 Schema、templateId、filename、snapshotHash 和 overflow
-> 同源 renderer 生成 HTML
-> Playwright 输出 A4 PDF buffer
-> 客户端校验 application/pdf 和 %PDF 文件头
-> 写入 direct_pdf_success ExportRecord
-> 触发浏览器下载
```

成功语义：

- 服务端已成功生成 PDF。
- 客户端已收到有效 PDF bytes。
- 客户端已触发浏览器下载。
- 浏览器无法确认用户最终保存到磁盘，因此 UI 不声称已确认保存。

## 4. 导出快照

快照结构：

- `branchId`
- `branchRevision`
- `currentRevisionId`
- `presentationRevision`
- `templateId`
- `generatedAt`
- `filename`
- `overflowStatus`
- `presentation.sectionOrder`
- `presentation.itemOrderBySection`
- `presentation.hiddenItemIds`
- `presentation.typography`
- `presentation.spacing`
- `presentation.theme`
- `presentation.sectionStyleOverrides`
- `renderModel`
- `snapshotHash`

快照不包含：

- 模板中心打开状态。
- 属性面板打开状态。
- 预览编辑器状态。
- 未保存正文草稿。
- API Key、日志、路径或外部服务信息。

## 5. ExportRecord

旧字段继续兼容：

- `operationId`
- `branchId`
- `revisionId`
- `branchRevision`
- `templateId`
- `format`
- `fileName`
- `displayName`
- `exportStatus`
- `overflowStatus`
- `exportedAt`
- `errorCode`
- `presentationRevision`
- `presentationSnapshot`

G3a 新增可选字段：

- `exportMethod`: `direct_pdf | browser_print`
- `mimeType`
- `fileSize`
- `startedAt`
- `completedAt`
- `failureCode`
- `snapshotHash`
- `pdfContentHash`

新增状态：

- `direct_pdf_success`

失败仍使用 `failed` 或 `blocked_overflow`，不会写成成功记录。

## 6. 文件名规则

格式：

```text
姓名_岗位名称_模板显示名_YYYYMMDD.pdf
```

规则：

- 去除 Windows 非法字符。
- 去除重复 `.pdf`。
- 空姓名使用 `CareerAdapt`。
- 空岗位使用 `Resume`。
- 空模板名使用 `Template`。
- 最大长度 120 字符。
- 不写入内部 templateId、branchId、revisionId 或数据库 ID。
- `Content-Disposition` 同时提供 ASCII fallback 与 `filename*=UTF-8''...`。

## 7. Fallback

- 旧按钮 `打印 / 保存 PDF` 保留。
- fallback 继续调用 `window.print()`，使用现有 `@media print` 和 `.no-print`。
- fallback ExportRecord 使用 `exportMethod=browser_print` 和 `exportStatus=print_invoked`。
- direct 失败不会被记录为 direct 成功。
- 不自动无限重试。

## 8. 并发和一致性

- 直接下载按钮在 `validating/generating/downloading` 状态禁用，防止重复点击启动多个任务。
- direct PDF 每次点击使用新的 `exportId`；相同 `exportId` 的 ExportRecord 仍由 Repository 幂等保护。
- PDF 生成期间正文、样式或模板变化不会污染当前请求，因为 API 只使用点击时冻结的快照。
- direct PDF 成功记录允许绑定启动时的历史 `ResumeRevision`，避免生成期间用户保存新正文后误把旧 PDF 记录成当前 revision。

## 9. 隐私和日志

- PDF 生成不调用外部 SaaS，不上传第三方。
- API 不接收任意文件路径。
- API 错误日志只记录 `exportId`、`branchId`、`branchRevision`、`templateId`、可见条目数量和固定错误码。
- 不记录完整简历正文、API Key、堆栈或本地路径。
- 不写临时 HTML 或 PDF 文件。

## 10. 测试

新增永久测试：

- `tests/unit/export.test.ts`
- `tests/e2e/v2-g3a-direct-pdf.spec.ts`

覆盖：

- 文件名生成、Windows 非法字符、fallback、长度限制。
- ExportRequest Schema、templateId 校验、路径遍历阻断。
- 快照生成、hash 稳定性、配置变化后 hash 变化。
- 旧 ExportRecord 兼容、新字段解析、direct 成功、failed 和 overflow 阻断。
- direct PDF 下载按钮、状态、HTTP PDF 响应、Content-Type、文件名。
- 四模板 direct PDF。
- 中文和英文文本可抽取。
- A4 一页。
- hidden 内容不进入 PDF。
- 模板中心、编辑控件和属性面板不进入 PDF。
- 生成期间模板切换不污染冻结快照。
- direct 失败后可重试，并可使用浏览器打印 fallback。
- G2/G1b/G0a/D2 组合回归。

## 11. 停止条件

本轮未触发停止条件：

- 未建立第二套模板布局。
- 未生成截图型 PDF。
- 未上传第三方。
- 未新增 Dexie 表。
- 未升级 Dexie。
- 未持久化 ResumeDocument。
- 未进入 G3b、DOCX 或 OCR。
- 未修改 Fact Guard。

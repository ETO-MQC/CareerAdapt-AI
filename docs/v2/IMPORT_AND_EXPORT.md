# Import And Export

## V1导入复用

V2复用V1的文本导入和文本型PDF导入：`RawInputDocument`、`PdfImportSession`、`PdfPageText`、`ProfileImportDraft`、sourceQuote定位和隐私确认。PDF仍不持久化原始Blob，AI输入继续绑定 `aiInputHash`。

## 导入到ResumeDocument

P0路径：

```text
PDF/粘贴文本
-> ProfileImportDraft
-> CareerProfile
-> verified ResumeBranch
-> ResumeDocument Mapper
```

PDF来源字段：

- `pdf_import`：sourceQuote在页文本中唯一定位。
- `user_input`：用户新增或改写内容。
- `unlocated/ambiguous`：不得默认进入正式事实层。

## 原版式识别边界

Level 1 内容导入为P0：提取文本和结构，使用系统模板重新排版。

Level 2 样式近似映射为P1/P2：识别标题、栏目、单栏/双栏、基础字号、基础颜色、基础对齐，并映射到模板配置。

Level 3 任意PDF原版式高还原后置：不承诺可移动文字块、图形、图标、边框、任意字体和坐标编辑。

## 可用库评估

- PDF.js：继续用于浏览器文本提取和页文本定位。
- pdf-lib：可用于测试fixture和轻量PDF处理，不适合作为复杂HTML排版引擎。
- Tiptap/Lexical/Slate：用于富文本编辑需评估事实引用和结构化block绑定；G0可先不用。
- dnd-kit：适合G1有约束拖拽，不适合自由画布。
- Paged.js/Headless Chromium：适合HTML到PDF的一致性验证。
- React PDF：需评估中文字体、CSS兼容和模板复用成本。
- DOCX库：Mammoth适合导入文本；docx等库可用于导出，进入G4/G3后评估。

## 文件隐私

- 不默认持久化原始PDF Blob。
- 不记录本地绝对路径。
- AI日志不保存完整简历文本、堆栈、API Key。
- 用户可删除PDF import session和page texts。

## 导出目标

V2-G3必须提升：

- PDF直接下载。
- 浏览器打印fallback。
- 预览和PDF一致。
- 中文文本可复制。
- 字体不丢失。
- 一页和两页可控。
- overflow明确。
- 文件名规则。
- 导出记录。
- 导出失败可恢复。

## PDF直接生成方案

建议优先评估本地/服务端 Headless Chromium 对现有HTML模板打印为PDF：

- 优点：最大程度复用当前模板HTML/CSS，预览导出一致性最好。
- 风险：运行环境、字体、沙箱和部署复杂度。
- fallback：保留浏览器打印，继续记录 `print_invoked`。

客户端纯库生成PDF作为备选，但需验证中文字体、文本可复制、双栏裁切和CSS兼容。

### V2-G3a实际实现

G3a 采用本地 Next API + Playwright Headless Chromium/Edge：

```text
客户端冻结 ResumeRenderModel + ResumePresentationConfig
-> POST /api/resume-export/pdf
-> API 校验 ExportRequest Schema、filename、templateId 和 snapshotHash
-> 复用正式模板 Registry、renderer 和 globals.css
-> Playwright page.pdf 生成 A4 文本 PDF
-> 客户端校验 application/pdf 和 %PDF
-> 写 direct_pdf_success ExportRecord
-> 触发浏览器下载
```

本实现不新增依赖、不新增 Dexie 表、不升级 Dexie、不保存临时 HTML/PDF 文件。浏览器打印保留为 fallback，记录为 `exportMethod=browser_print`。

因为用户数据位于浏览器 IndexedDB，API 不直接读取本地 Dexie；导出请求必须携带点击时冻结的脱离编辑器状态的快照。快照包含 `branchRevision`、`currentRevisionId`、`presentationRevision`、模板、排序、隐藏、样式、生成时间、文件名和 `snapshotHash`。

## 多页和文件名

- 一页为默认，二页作为模板能力和用户配置，不自动无限分页。
- 文件名建议：`姓名_岗位_公司_模板_YYYYMMDD.pdf`，敏感字段缺失时降级为 `CareerAdapt_Resume_YYYYMMDD.pdf`。

## ExportRecord

保留V1字段并扩展：

- `operationId`幂等。
- `branchRevision`、`templateId`、`overflowStatus`。
- `exportStatus`：`direct_pdf_success`、`print_invoked`、`blocked_overflow`、`failed`。
- `exportMethod`：`direct_pdf`、`browser_print`。
- `mimeType`、`fileSize`、`startedAt`、`completedAt`、`snapshotHash`、`pdfContentHash` 可用于 direct PDF 审计。
- `errorCode`不保存原始堆栈。

## PDF Golden Tests

- 每套模板保留HTML截图、PDF页数、A4尺寸、中文文本抽取、无导航按钮、无裁切检查。
- 对fits、near_limit、overflow分别测试。
- 对系统字体差异保留最小字体包或明确字体fallback。

## DOCX和PNG

DOCX导入/导出均后置，不与G0/G1混做。PNG导出可作为分享图后置；批量导出后置。

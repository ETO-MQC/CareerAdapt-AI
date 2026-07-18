# Resume Presentation Contract（P3.8b）

## 1. 目的与边界

正式简历链路固定为：

```text
ResumeItemV2
→ projectResumePresentationItem（纯派生）
→ ResumePresentationItem
→ 四套 Template Renderer
→ A4 Preview / PDF
```

`ResumePresentationItem` 不持久化、不反向写回 Domain、不重新解析正文。Studio、导入核对和 JSON 继续使用 Resume Schema v2 的 canonical key；Repository、ResumeRevision、Fact Guard 与通用/岗位分支语义不变。

## 2. Contract

Schema 位于 `src/domain/schemas/resumePresentation.ts`，核心字段包括：

- `id`、`sectionType`：正式渲染身份和栏目类型；`id` 由 render mapper 绑定外层 `ResumeContentItemV2.id`，不得覆盖 `ResumeItemV2.data.id`。
- `primaryTitle`、`secondaryTitle`、`tertiaryTitle`：标题层级。
- `dateRange`、`location`、`groupLabel`：日期、地点和技能分组。
- `inlineMeta`、`secondaryMeta`：无调试前缀的紧凑元数据。
- `description`、`highlights`：正文和独立项目符号。
- `links`：保留的可点击链接。
- `customRows`：白名单 canonical 标签与 customFields fallback。
- `warnings`：合法扩展字段需要提示时的派生信息。

`ResumeRenderStructuredItemV2` 继续保留 `data` 和只读兼容 `plainText`，但正式模板只消费 `presentation`。`plainText` 仅供导入兼容、诊断或调试，不得进入 Preview/PDF。

## 3. 专用 projector

`src/domain/resumePresentation/projector.ts` 对以下栏目逐类投影：

- summary、education；
- work、internship、campus、volunteer；
- project、research；
- awards、skills、languages、certificates；
- publications、patents、portfolio；
- other、custom。

标准栏目不会回退到字段目录驱动的 `label: value`。`other/custom` 和 customFields 使用紧凑 fallback，值不静默删除。

## 4. 日期与标签规则

统一 formatter 仅输出年份或年月：

- `YYYY` → `YYYY`
- `YYYY-MM` / `YYYY-MM-DD` → `YYYY.MM`
- 起止年月 → `YYYY.MM–YYYY.MM`
- `current=true` → `YYYY.MM–至今`

正式输出不自动读取 field catalog label。集中白名单只有：

- GPA
- 专业排名
- 核心课程
- 技术栈
- DOI
- 专利号
- 证书编号

customFields 保留用户提供的 label；它们不是 canonical label 自动泄漏。

## 5. 模板与分页约束

四套模板统一复用 `RenderPresentationItems`，只在字体、色彩、单双栏、间距和对齐上存在差异。栏目语义、日期、highlights、标签白名单与去重规则一致。

分页测量必须使用外层 render item ID。导入数据允许 `ResumeItemV2.data.id` 与 `ResumeContentItemV2.id` 不同；二者混用会使分页计划无法匹配条目，造成 Preview/PDF 空页。mapper 因此只改派生 DTO 的 `id`，不修改 Domain ID。

## 6. 回归门槛

- 四模板中标准栏目不读取 `plainText` 或 canonical field catalog label。
- 调试标签节点为 0，generic experience heading 为 0。
- 每个 enabled section/item 只出现一次。
- description 为空时不渲染；highlights 使用独立 `li` 并去重。
- Preview/PDF 保留日期、链接、customFields 和全部 canonical 值。
- Studio 字段 label、JSON canonical key、Repository/Revision 内容不变。

# P3.6e 条目级结构化与经历分组修复

## 范围

本轮只修复真实 CareerAdapt PDF 导入暴露的 section → item → field 精度问题。未改变 OCR、PDF 路由、WorkspaceRepository、Fact Guard、ResumeRevision、分支边界、PDF 导出语义或 Dexie 表。

## 根因与修复

- 外层“经历”此前不属于标题 catalog，因而被附加到相邻正文；现在识别为 `presentation_group`，不创建正式 section、不进入 residual。
- basics 旧规则排除单个拉丁字母，并以第一个短文本作为姓名；现在结合顶部字号、位置、联系方式与地点字符区间仲裁，姓名和地点不能复用同一范围。
- 日期旧实现把日精度直接写入 canonical，且 token 顺序可能把年月截断为年份；现在保留 `rawText/sourcePrecision`，业务值统一到 `YYYY-MM`。
- `consumedRanges/residualSegments` 原先停留在候选计算结果中；现在 draft 的 unclassified 只接收最终 residual 字符区间。
- parser 原先每个栏目只生成一个长文本 item；现在由独立纯函数完成 canonical section、item 分段和字段提取，并保留 source block/range。
- 字段候选原先没有 item 上下文；现在日期和状态候选带 `sectionId/itemId/itemLabel/sourceRanges`，核对 UI 按条目显示。
- 简历经历日期输入由日控件改为月控件，来源证据仍显示原始日精度。

## 真实附件验证摘要

- 正式栏目：summary、education、work、project、awards、skills、languages。
- 条目数：1 / 1 / 2 / 4 / 2 / 6 / 1。
- generic experience section：0。
- presentation heading 泄漏：0。
- mapped contact residual：0。
- canonical 日补 `01`：0。
- 日期/状态待确认候选：14，均绑定具体 item。
- 生成侧 JSON 的“英语六级备考中”与 PDF 可见“英语四级备考中”冲突；PDF 导入以 PDF 可见内容为准。

真实隐私正文、PDF、JSON、截图和本机路径未提交。

# P3.6a 脱敏导入样本矩阵

- 标准 JSON：`structured-standard.json`
- 外部网站 JSON：`external-aliases.json`
- 普通 / 表格 / PDF 转 Word 碎片 DOCX：`ordinary.docx`、`table.docx`、`fragmented-pdf-conversion.docx`（均为最小化脱敏 fixture）。
- 单栏 / 双栏 / 乱码文本 PDF：复用 `tests/fixtures/pdf/single-page-en.pdf`、`two-column-*.pdf`、`chinese-resume-*.pdf`，乱码路由由 normalizer 的损坏文本层用例覆盖。
- 部分字段缺失与中英文混合：`external-aliases.json`。

扫描 PDF 本阶段只验证进入 `ocr_ai` 推荐状态，不代表正式 OCR 支持。

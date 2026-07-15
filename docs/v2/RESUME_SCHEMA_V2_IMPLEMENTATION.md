# Resume Schema v2 实施记录

## 结论

本轮建立了独立 `CareerProfile` 事实层、结构化 `ResumeBranch` 表达伴随数据、派生 `ResumeRenderModel v2` 与单一字段 catalog。没有新增 Dexie 表，没有持久化 `ResumeDocument`，没有修改 Fact Guard 阈值、Revision 语义、通用/岗位分支边界或 PDF 的人工确认边界。

## 版本

- 字段目录：`resume-field-catalog-v2.0.0`
- Domain item：`resume-content-item-v2`
- CareerProfile：`career-profile-v2`
- ResumeBranch：`resume-branch-v2`
- JSON DTO：`careeradapt-resume-v2`
- 导入草稿：`resume-import-v2`（v1 继续兼容）
- 渲染模型：`resume-render-v2`
- AI prompt：`resume-json-mapper.v2`

## 主要文件

- `src/domain/resumeFields/types.ts`：栏目、canonical id、字段定义类型与 catalog 版本。
- `src/domain/resumeFields/sectionCatalog.ts`：18 个正式栏目及稳定顺序。
- `src/domain/resumeFields/fieldCatalog.ts`：字段标签、别名、类型、UI、导入、AI、敏感性和顺序。
- `src/domain/schemas/resumeV2.ts`：专业 item discriminated union、customFields、FlexibleSection。
- `src/domain/schemas/resumeJsonV2.ts`：strict JSON v2 DTO 与 mapping trace。
- `src/domain/resumeImport/jsonV2Adapter.ts`：v1、v2、外部 JSON adapter 与示例生成器。
- `src/domain/migrations/resumeV2.ts`：Profile/Branch 纯函数、幂等渐进迁移和唯一 plain-text projector。
- `src/domain/resumeImport/mappingValidation.ts`：catalog、来源块、原文定位与低置信确认校验。
- `src/domain/resumeRender/mapper.ts`：结构化栏目与旧模板兼容 projection 的同源渲染模型。

## 兼容与迁移

1. 数据库仍使用现有表与版本；不批量重写用户数据。
2. Repository 读取 Profile/Branch 后返回运行时 v2；显式保存或新建 Branch 时写回 v2。
3. 历史 `ResumeRevision.snapshot` 不重写；恢复后在当前 Branch 读取/保存边界重新生成 v2 伴随数据。
4. 旧正文不猜测 GPA、排名、作者身份或成果字段，原文逐字保存在 `legacyTextProjection`。
5. v2 伴随数据与当前正文、顺序、可见性、来源引用或 Guard 状态不一致时自动从当前 Branch snapshot 重建，避免陈旧投影进入预览/PDF。
6. UI 的显示/隐藏仍只修改 presentation；正文增删改仍创建原有 `ResumeRevision`。

## JSON 与导入

- 声称 `careeradapt-resume-v2` 的 payload 必须通过 strict Schema；未知字段不会降级到宽松外部映射。
- `structured-resume-draft-v1` 经 `v1ToJsonV2()` 保守转换；外部 JSON 先经 alias adapter。
- 无有效内容与未知内容完整进入 `unclassifiedBlocks`，保留原路径和原对象。
- mapper 决策只有 `canonical_field`、`custom_field`、`custom_section`、`unclassified`。
- 低置信、待确认和一源多映射不能被批量静默选中。
- 当前核对 UI 继续使用兼容 projection，但统一 projector 会把所有 canonical/custom 字段逐项投影，不静默丢字段；原始 JSON 与来源块继续保留。

## Studio、模板和 PDF

- Studio 默认显示基本信息、自我评价、教育、工作/实习、项目、技能和“添加栏目”。
- 可选栏目在有导入/资料库内容时自动启用；显式移除只隐藏导航，不删除内容。
- 自定义栏目保存稳定 ID、标题与顺序；支持重名提示、Enter、Escape、焦点恢复和 aria 状态。
- 每个模板声明 `supportedSections`、`supportedFields`、照片/自定义栏目能力和 fallback。
- 现有模板继续消费同一兼容 projection，结构化栏目不会因模板不支持而从数据层删除。
- Export snapshot 新增 `renderSchemaVersion`、`catalogVersion`、`templateVersion`。

## 已知限制

- Studio 已有教育/经历表单继续可用；本轮没有为科研、论文、专利等每个专业字段制作独立视觉表单，它们先通过统一文本编辑与 v2 数据安全落点工作。后续可由 catalog 驱动逐栏目表单，不需要改变 Domain/JSON。
- 当前模板视觉仍是原有四类兼容布局；v2 结构化栏目已保留在 RenderModel，模板视觉扩充后可直接消费。
- 正式 OCR、复杂 PDF 视觉阅读顺序、真实授权简历 precision/recall 不在本轮；接口继续使用 source block、confidence、mapping decision 和核对草稿。
- 全量历史 Playwright 四分片因本地长进程编排超时未取得完整退出码，已按用户指示停止；复测清单见 `RESUME_SCHEMA_V2_MIMO_TEST_PLAN.md`。

## 验证摘要

- `pnpm typecheck`：通过。
- `pnpm lint`：通过，0 warning。
- `pnpm test`：38 files / 199 tests 通过。
- `pnpm build`：通过。
- `pnpm test:c1:eval`、`pnpm test:c2:eval`：各 1/1 通过。
- Resume Schema v2 新增/专项：catalog、Domain Schema、JSON round-trip、迁移、mapping decision、Render/PDF 共 20+ 项通过。
- Studio 1024×768 新 E2E：通过；默认栏目、可选栏目、自定义栏目、重名、Escape、焦点恢复、持久化均覆盖。


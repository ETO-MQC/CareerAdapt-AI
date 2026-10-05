# V4 前置修复计划：简历改写目标、编辑协议与预览/导出一致性

- 状态：P-1A 至 P-1F 已完成，允许进入 V4-P0
- 计划版本：P1.0
- 建立日期：2026-10-04
- 完成日期：2026-10-05
- 适用项目：CareerAdapt AI
- 执行对象：独立开发 AI 或后续开发者
- 前置关系：本计划全部完成后，才能开始 docs/architecture/v4-plan.md 的 V4-P0

> 这是 V4 的强制前置修复，不是 V4 的一个可选子功能。它只收口当前简历改写、结构化目标解析、差异可见性、文本格式和预览/打印/PDF 一致性问题，不实现岗位采集、Hermes 自治、定时任务或网申功能。
>
> **验收结论（2026-10-05）**：P-1A 至 P-1F 六个阶段均已实现并通过完整门禁，V4-Pre-P1 门禁解除。提交记录、门禁退出码与未完成项见文末「执行记录」。

## 0. 执行门禁

执行顺序必须是：

    V4-Pre-P1A
      → V4-Pre-P1B
      → V4-Pre-P1C
      → V4-Pre-P1D
      → V4-Pre-P1E
      → V4-Pre-P1F
      → 前置修复验收通过
      → V4-P0

在 P1F 完成并取得完整验收记录前：

- 不得开始 V4-P0 的 Hermes、浏览器、岗位来源或权限实现；
- 不得以“全量测试通过”替代本计划的定向验收；
- 不得把本计划中的未完成项标记为已修复；
- 不得通过修改 V4 计划来绕过本计划。

## 1. 权威资料与工作区基线

开发 AI 必须遵守当前项目 AGENTS.md。本计划仅补充 V4 前置修复的范围和验收要求。

开始每个子阶段前必须记录：

- git rev-parse HEAD；
- git status --short --untracked-files=all；
- 当前用户已有修改；
- 本阶段允许修改的文件；
- pnpm typecheck；
- 本阶段直接相关的最小测试集。

本计划中的文件行号只是审计线索，不是稳定 API。实施时必须按符号名、Schema 名、方法名和测试名重新定位。

主要代码入口：

- src/domain/jobOptimization/tailoringEngine.ts
- src/domain/jobOptimization/tailoringDiff.ts
- src/domain/schemas/branch.ts
- src/domain/schemas/resumeJsonV2.ts
- src/services/storage/repositories.ts
- src/services/agent/agentToolService.ts
- src/agent/runtime/AgentTaskStateReducer.ts
- src/components/agent/artifacts/AgentArtifactContent.tsx
- src/services/export/snapshot.ts
- src/services/export/pdfHtml.tsx
- src/services/export/browserPrint.ts
- src/app/globals.css
- src/components/resume/templates/shared/canonical.tsx

## 2. 已核实的问题边界

### 2.1 M1 必须拆成两类，不能再笼统写成“7 个栏目被标成 project”

tailoringEngine 当前先根据 structured.sectionType、itemType 和 sourceSectionId 推导栏目，再限制在少量白名单中；对 itemType === "experience" 存在回退到 project 的逻辑。

按当前 profileBranch.ts 枚举核对，M1 分为：

| 类别 | 栏目 | 当前表现 | 修复要求 |
|---|---|---|---|
| 误标 project | education、research、campus、volunteer | itemType === "experience" 触发 project 兜底，随后与真实 sectionType 不匹配，通常形成 target_not_found | 保留真实 sectionType，由统一 target resolver 解析 |
| 未进入 AI 目标集合 | awards、languages、publications、patents、portfolio、other、custom | itemType === "custom" 等路径可能得到 undefined 并提前退出，根本没有生成目标 | 对有明确可编辑字段的栏目加入目标目录；没有可编辑字段时返回显式 unsupported_section 诊断，不得静默丢弃 |

最终数量必须以实施时读取到的 ResumeSectionTypeV2 和实际 profileBranch.ts 枚举为准。若枚举发生变化，交付报告必须重新列出误标集合、未进入集合和对应测试。

### 2.2 M2：技能的逻辑原文和目标字段不一致

当前技能目标可能使用：

    before = description || name
    fieldPath = description

当 description 为空时，生成阶段认为原文是 name，解析阶段却只按 description 读取，导致 original_mismatch。

修复必须明确目标语义：

- 如果逻辑目标是“补充或改写技能说明”，目标字段仍然是 description，读取原文和回读校验都必须使用同一套 fallback 规则；应用后写入 description，不能把技能名称误改掉。
- 如果产品明确要允许修改技能名称，必须使用独立的 name 目标，不得用 description fallback 冒充名称编辑。
- 两种目标不能共用一个模糊的 fieldPath。

### 2.3 M3：Agent artifact 的定位信息不足

Agent artifact 当前可以显示粗粒度字段标签，但不能稳定告诉用户具体是哪一个栏目、哪一个条目、哪一个组织或哪一个字段。

本计划要求至少显示：

- sectionType；
- itemId；
- 可读的条目标题，例如公司、学校、项目或技能名称；
- fieldPath 的用户可读名称；
- before/after；
- 当前状态：已应用、已拒绝、被阻断、待确认。

如果条目没有可读标题，必须显示稳定 ID 的缩短形式或明确的“未命名条目”，不能只显示“简历内容”。

### 2.4 M4：userPreferences 不能继续在链路中丢失

如果 compose_resume schema 接受 userPreferences，它必须完整经过：

    workflow schema
    → tool input
    → agentToolService
    → composition blueprint/writer
    → prompt/context
    → 生成结果和审计记录

userPreferences 是用户对表达、重点和目标受众的指令，不是用户事实证据，不得借此绕过 Fact Guard，也不得写入个人资料库。

本计划默认选择“接通它”。如果产品决定暂不支持该字段，必须删除 schema、JSON schema、类型和文档中的公开入口，并增加测试；不能保留一个实际无效的输入字段。

### 2.5 S1：拒绝和诊断必须可见

内部已经有 rejectedDiffs、generationDiagnostics 或等价诊断信息时，不能只把成功的 diffs 放到 UI。

用户必须能区分：

- AI 没有生成；
- AI 生成但目标不存在；
- 原文已变化导致冲突；
- Fact Guard 阻断；
- 用户未确认；
- 已成功应用。

不要求展示内部堆栈，但必须保留可操作的 reason code、目标位置和下一步建议。

### 2.6 GroundedResumeOutputGate 的语义校正

本计划不接受“正则会把原句静默替换成固定话术”的表述作为事实。当前 Gate 的主要语义是检测到不支持的硬事实后阻断本次正式输出并返回恢复提示，而不是修改并保存一段被替换的简历正文。

需要修复的是：

- 对过宽规则增加正例、负例和误报测试；
- 将阻断原因和触发规则以诊断形式展示；
- 保持现有事实安全边界和阈值，不能通过降低阈值让测试变绿；
- 不把 Gate 退化成静默放行，也不把它改成不可解释的全局文本清洗器。

### 2.7 格式一致性问题

当前审计确认或高度怀疑：

- presentation snapshot 反向恢复可能硬编码 highlightListStyle 和 itemHeaderMiddleAlignment；
- 浏览器打印可能继承预览画布的 zoom，默认画布缩放为 0.8；
- 普通经历描述的换行规则与 summary 不一致；
- PDF HTML 的基础 reset 与浏览器预览不一定一致。

其中 PDF 与预览之间的具体像素、毫米或分页差异，必须通过真实固定 fixture 渲染后确定，不能仅凭代码审查宣称“必然多出 3.3mm”。

## 3. 目标架构：统一编辑协议，不建立第二套数据真相

### 3.1 现有数据模型继续作为真相

本计划不新增“每份简历一个独立物理文件”的内部主存储，也不新增 Dexie 表。

现有结构继续承担职责：

- ResumeBranch：通用简历分支和岗位定制分支；
- ResumeBranchSnapshot：某一 revision 的结构化快照；
- ResumeRevision：不可变 revision 记录；
- CareerAdaptResumeJsonV2：可验证、可导入导出的结构化 JSON 投影；
- WorkspaceRepository：唯一业务写入入口；
- ResumeDocument：只由内容和 presentation config 派生，不持久化。

如果未来需要“每份简历一个 JSON 文件”，它只能作为导出、备份或迁移格式，不能成为绕过 Repository 的第二个可写真相。

### 3.2 统一编辑命令

AI、页面编辑器和导入适配器都应归一到同一个编辑命令边界。可以复用现有 tailoring diff 字段，但不得为 AI、UI、导入各自发明目标定位规则。

概念形状如下，实际字段必须优先复用当前 Schema 和 Repository 已有字段：

    type ResumeEditCommand = {
      operationId: string;
      branchId: string;
      baseRevisionId: string;
      source: "user" | "ai" | "import";
      target: {
        itemId: string;
        sectionType: ResumeSectionTypeV2;
        fieldPath: string;
      };
      operation: "set" | "insert" | "remove" | "reorder" | "setVisibility";
      beforeHash: string;
      before?: unknown;
      value?: unknown;
      evidenceRefs?: string[];
      userConfirmation?: "not_required" | "pending" | "confirmed";
    };

该命令是写入边界，不是新表，也不是允许 Agent 直接修改任意 JSON 的授权。所有命令必须经过：

    Schema 校验
    → section/field target resolver
    → beforeHash/CAS
    → Fact/Evidence/确认检查
    → WorkspaceRepository
    → 新 revision 或现有 revision 语义
    → ResumeDocument projector

本计划只要求建立必要的统一目标和命令适配，不要求在 P-1 中实现新的实时协同编辑系统，也不要求重写所有编辑器状态管理。

### 3.3 内容和排版分离

简历内容 JSON 与 presentation config 保持两个明确层次：

- 内容：栏目、条目、文本、列表、来源、证据、可见性；
- 排版：模板、顺序、字体、间距、bullet 样式、标题对齐、页边距。

Preview、browser print 和 PDF export 必须从同一份内容 revision 和同一份 presentation config 派生，不能各自重新猜默认值。

## 4. 明确不属于本计划的内容

以下内容不得借本计划顺便实现：

- 实时保存 debounce、离线队列、冲突合并产品化；
- 多用户协同编辑或 Yjs；
- 将整份简历改成 Tiptap JSON；
- JSON Resume 替换 Resume Schema v2；
- 新增 Dexie 表或物理 JSON 文件存储；
- Hermes API server、浏览器自动化、岗位抓取、ATS、cron 或网申；
- 修改 Fact Guard 阈值或删除安全门；
- 重建 Native Agent runtime；
- 与本次问题无关的 UI 重设计或技术债清理。

“页面编辑后立即显示新内容”属于现有编辑器状态行为；“将编辑以 debounce 方式持久化并处理冲突”属于后续独立功能，不能混入 P-1。

## 5. 分阶段执行计划

每个阶段必须独立提交、独立验收。后续阶段不得掩盖前一阶段的失败。

### P-1A：统一 ResumeSectionTypeV2 目标目录与 resolver

#### 目标

修复 M1、M2 的共同根因：目标栏目和目标字段的推导规则不唯一、存在错误兜底、生成和回读使用不同语义。

#### 必做工作

1. 从当前 Schema 和 profileBranch.ts 读取完整 ResumeSectionTypeV2 枚举，不手写一个缩小版白名单。
2. 建立单一目标目录，至少记录：
   - section type；
   - item type；
   - 可编辑字段；
   - 字段类型；
   - 生成时读取方法；
   - 应用时写入方法；
   - 回读校验方法；
   - 用户可读标签。
3. 删除或改造 experience → project 的兜底，使 education、research、campus、volunteer 保留真实栏目。
4. 为 awards、languages、publications、patents、portfolio、other、custom 分别作出明确决定：
   - 有现成可编辑字段：加入目标目录；
   - 没有安全且有意义的可编辑字段：返回 unsupported_section，并进入诊断；
   - 不得提前退出而不留下任何记录。
5. 修复技能 description fallback：生成、resolve、apply、readback 使用同一逻辑；技能名称编辑和技能描述编辑必须是两个不同目标。
6. 让 target_not_found、original_mismatch、unsupported_section 携带真实 sectionType、itemId 和 fieldPath。
7. 不改变分支隔离、revision CAS、Fact Guard 或 Repository 所有权。

#### 必做测试

- 对 ResumeSectionTypeV2 每一个枚举值验证目标解析结果；
- 分别断言 4 个误标栏目不会再成为 project；
- 分别断言 7 个原本未进入集合的栏目不会静默消失；
- description 为空的技能可以按既定语义生成、应用并回读；
- description 非空的技能保持原有行为；
- 不支持字段返回显式诊断，而不是 undefined 后静默跳过；
- 目标 section、item、field 不一致时仍然拒绝，防止为了修 M1 而放宽完整性校验。

#### 阶段完成标准

不存在基于 itemType === "experience" 的错误栏目猜测；所有枚举值都有“可定制”或“明确不支持且可见”的结果；P-1A 新增测试通过。

### P-1B：统一编辑目标、差异状态和诊断可见性

#### 目标

让 AI 改写、页面 diff 和 Repository 应用使用同一种目标身份，并解决 M3、S1。

#### 必做工作

1. 在不新增持久化表的前提下，引入或整理内部 ResumeEditCommand/目标对象；现有 tailoring diff 可以适配到该对象。
2. 目标身份至少包含 branchId、baseRevisionId、itemId、sectionType、fieldPath 和 beforeHash。
3. Agent artifact 显示精确位置：栏目、条目标题/ID、字段、before/after。
4. UI 展示所有生成结果状态：applied、rejected、blocked、pending confirmation、conflict。
5. 每个拒绝项显示稳定 reason code 和用户可读解释。
6. 继续以 review ledger 或等价可信记录作为应用依据，不信任 UI 传回的 selectedDiffs。
7. 继续执行来源分支未改变、revision 版本、回读值和 Fact Guard 检查。

#### 明确不做

- 不在本阶段实现编辑器 debounce 持久化；
- 不把所有 UI 输入改造成新的实时协同模型；
- 不把 rejected diff 自动改写成可应用 diff；
- 不通过隐藏拒绝项保持“AI 改了 N 处”的表面数字。

#### 必做测试

- Agent artifact 能显示四类栏目和任意条目的稳定位置；
- rejected、blocked、diagnostic 在 reducer 到 UI 的链路中不丢失；
- 用户确认和 review ledger 仍然是应用必要条件；
- 错误 branch、revision、item 或 field 不能写入别的条目；
- 同一 operationId 重复处理不会产生重复写入。

#### 阶段完成标准

用户可以从每一条 AI 改写看到“改了哪一栏、哪一条、哪个字段、结果是什么”；被拒绝项不再静默消失。

### P-1C：接通 userPreferences 或明确删除无效入口

#### 目标

消除 schema 接收但业务忽略的输入。

#### 默认方案：接通

1. 将 userPreferences 加入 planResumeComposition 和相关内部类型；
2. 传递到 blueprint/writer 和实际 prompt/context；
3. 在生成审计结果中记录“使用了用户偏好”，但不把偏好伪装成事实证据；
4. 增加表达风格、重点偏好、目标受众偏好测试；
5. 验证偏好不会写入通用个人资料库，不会改变事实来源，不会绕过确认流；
6. 对缺省、空对象和未知偏好字段按现有 schema 规则处理，不能静默吞掉错误。

#### 备选方案：删除

只有产品决定暂不支持该能力时才使用。必须同步删除 workflow schema、JSON schema、TypeScript 类型、prompt 传递和文档入口，并增加回归测试确认调用方不能再传入一个“看似成功但不起作用”的字段。

#### 阶段完成标准

每一个公开接收的偏好字段都有可证明的下游效果，或者公开入口已完整删除；不存在 schema 与实现不一致。

### P-1D：建立统一文本字段 codec 与换行策略

#### 目标

修复 summary 与普通经历描述表现不一致的问题，并消除多套 whitespace、bullet 和句级去重规则之间的漂移。

#### 目标字段分类

| 字段类型 | 存储规则 | 显示规则 |
|---|---|---|
| 单行标量 | 归一化空白，不保留无意义换行 | 单行显示 |
| 段落文本 | 保留用户明确输入的换行 | pre-line 或等价统一规则 |
| 列表字段 | string[]，每项一条语义内容 | renderer 统一生成 bullet、number 或 none |
| 富文本字段 | 仅在现有字段明确需要时使用 Tiptap JSON | 由富文本 renderer 负责 |

#### 必做工作

1. 盘点 resumeFields/catalog、import normalizer、editor codec、projector、legacy serializer 和 canonical renderer 的重复规则。
2. 选择一个现有字段目录作为元数据入口，避免再创建第二个字段真源。
3. 统一 paragraph、description、background 等段落字段的换行显示；不能只给 summary 加特例。
4. 保持 highlights 等数组字段为数组，不把用户输入的 bullet 字符混入文本内容。
5. 由 presentation config 决定 bullet 样式；统一处理 bullet、numbered、none。
6. 对历史数据使用显式兼容归一化，不改变用户事实内容，不在渲染层静默删除有效文字。
7. 保留 Tiptap 对需要富文本的字段支持，但不把整份简历改成 Tiptap JSON。

#### 必做测试

- summary、work、project、education、research 等段落字段的多行文本回读和渲染；
- 单行字段不会被意外拆成多行；
- 数组字段不会出现双 bullet；
- none、numbered、bullet 三种列表样式均有真实 DOM/CSS 断言；
- import → edit → preview → export 不丢换行；
- 历史 legacy 数据仍可读取，并且兼容规则有明确测试说明。

#### 阶段完成标准

换行和列表行为由字段类型决定，而不是由页面或模板临时猜测；同一种字段在编辑器、预览、打印和 PDF 中语义一致。

### P-1E：统一 Preview、Browser Print 和 PDF 的 presentation contract

#### 目标

修复排版配置丢失、打印缩放泄漏和 PDF 基础样式不一致，并用真实渲染验证 P0-3。

#### 必做工作

1. presentationSnapshotFromConfig 和反向恢复必须保留所有参与渲染的 presentation 字段，禁止用硬编码默认值覆盖用户配置。
2. Browser print 在 @media print 中明确重置画布缩放、交互 UI 和仅预览使用的布局属性；不能依赖当前用户恰好把缩放调成 1。
3. PDF HTML 使用与 canonical preview 同源的 reset、字体、页面尺寸、边距和 section 样式；如果必须有导出专用差异，必须记录并测试。
4. 预览、打印和 PDF 都从同一内容 revision、同一 presentation config 和同一 section order 派生。
5. 不新增第二个“导出默认 section order”。

#### P0-3 强制实测协议

P0-3 在没有真实渲染证据前只能标记为“待验证”，不能标记为“已确认”或“已修复”。测试至少固定：

- 同一份 Resume Schema v2 内容快照；
- 同一份 presentation config；
- 同一模板；
- 同一字体文件和 fallback 顺序；
- A4 页面尺寸、页边距和 DPR/渲染环境；
- canvas zoom = 0.8 和 zoom = 1 两组输入；
- 包含标题、段落、长行、换行、列表和跨页内容的固定 fixture。

至少收集并比较：

- 浏览器预览截图；
- browser print 或 print preview 结果；
- PDF 文件和页面截图；
- 页面数量；
- section 顺序；
- 标题/段落的换行和位置；
- bullet 样式；
- presentation config 的实际生效值。

如果工具链不能做稳定像素比较，则使用可重复的 DOM 几何、PDF 文本坐标、页面数量和人工复核组合，并在报告中说明限制。任何“3.3mm”等精确结论都必须引用实际 fixture 的测量结果。

#### 阶段完成标准

配置 round-trip、打印 zoom、PDF reset 和实际渲染差异都有可复现证据；没有证据的项目必须标为未验证，不得用代码审查结论替代。

### P-1F：前置修复闭环验收与 V4 交接

#### 目标

验证从 AI 生成修改到最终材料输出的闭环，并给 V4 提供干净的简历数据边界。

#### 必做测试链路

    AI 生成目标
    → target resolver
    → review ledger
    → 用户确认
    → branch revision 写入
    → ResumeDocument 派生
    → 浏览器预览
    → browser print
    → PDF export

至少验证：

- 4 个误标栏目进入正确 section；
- 7 个原本未进入集合的栏目有明确支持或明确诊断；
- description 为空的技能不再出现错误 mismatch；
- rejected/blocked diagnostics 全链路可见；
- userPreferences 不再静默丢失；
- 通用分支不变，岗位分支只写目标 revision；
- 未确认事实不进入预览或 PDF；
- 多行文本、数组 bullet 和 section order 在三种输出中一致；
- presentation config 不在 export round-trip 中丢失；
- GroundedResumeOutputGate 的阻断语义保持可解释，并且没有把正文静默改写。

#### P-1F 完成门槛

只有以下条件全部满足，才能把前置计划状态改为“完成”：

- P-1A 至 P-1E 各自有独立提交和验收记录；
- pnpm typecheck 通过；
- changed-files ESLint 通过；
- 相关 Unit/Integration 测试通过；
- 涉及 UI 的阶段通过定向 Playwright 或真实浏览器验收；
- P-1E 的真实渲染 fixture 有保存的结果和结论；
- git diff --check 通过；
- 没有用 skip、删除断言、降低阈值或静默 fallback 处理失败；
- 交付报告列出未完成项、证据限制和后续风险。

## 6. 测试断言变更规则

所有测试断言变化必须在提交说明和交付报告中逐项分类。

### A. 需求变更

例如：

- 真实 education 不再被识别为 project；
- rejected diff 必须展示给用户；
- highlightListStyle 必须经过 export round-trip 保留。

必须说明旧行为、新行为、产品或架构依据，并新增回归断言。

### B. 修复错误断言

原测试断言了已确认的错误实现，例如断言所有 experience 都是 project。必须将期望值改为真实 Schema 语义，并增加边界回归测试。

### C. 兼容性断言

旧数据、legacy serializer 或迁移行为仍然是产品要求时，保留原断言，并增加新 V2 canonical 路径的断言。

### D. 禁止的“修复”

以下都不属于合法修复：

- 删除失败断言；
- 增加 skip、todo 或条件跳过；
- 把精确断言改成宽泛 truthy；
- 降低 Fact Guard 或结构完整性阈值；
- 捕获错误后返回空 diff；
- 只让测试通过但让用户看不到 rejected/blocked 原因。

## 7. 每阶段验收命令与提交规则

每个子阶段至少运行：

    pnpm typecheck
    pnpm lint -- <changed-files>
    pnpm test -- <direct-related-tests>
    git diff --check

实际命令以 package.json 脚本为准。如果项目没有支持按文件传给 lint 的脚本，必须使用等价的 changed-files lint 方式并在报告中写明。

额外要求：

- P-1A：tailoring、repository、branch isolation 相关 Unit/Integration；
- P-1B：Agent artifact/reducer 和定向 Playwright；
- P-1C：compose workflow、tool service 和 schema 测试；
- P-1D：import、canonical renderer、presentation 和 export 测试；
- P-1E：export 测试、定向浏览器打印/PDF fixture；必要时运行 pnpm build；
- P-1F：跨模块闭环测试，必要时运行 pnpm build。

提交建议：

    fix(resume): unify section target resolution
    fix(agent): expose tailoring diagnostics and target locations
    fix(agent): wire compose user preferences
    fix(resume): unify text codec and newline rendering
    fix(export): preserve presentation parity across print and PDF
    test(resume): close pre-v4 remediation gate

提交只能包含当前阶段相关文件，不能纳入用户已有修改或顺便清理无关技术债。

## 8. V4 交接条件

前置计划完成后，交付报告必须明确写出：

- P-1A 至 P-1F 的提交 ID；
- 修改的 Schema、Repository、Agent、renderer 和 export 文件；
- ResumeEditCommand 或等价目标协议的最终落点；
- 所有 section 的目标支持矩阵；
- rejected/blocked diagnostics 的 UI 入口；
- presentation config 的唯一真源；
- 真实 PDF/print fixture 的结果；
- 测试命令、完整退出码和未完成项。

之后才允许进入 V4-P0。V4-P0 仍必须重新核对当前源码和测试，不能假设本计划完成就意味着 V4 功能已经存在。

## 9. 参考决策

- 保留当前 Resume Schema v2、Branch Snapshot、Revision 和 WorkspaceRepository；
- JSON 文件只作为导出/备份/迁移边界，不作为第二数据真相；
- JSON Resume 只考虑后续 adapter，不替换内部模型；
- Tiptap 只用于明确需要富文本的字段，不把整份简历变成 Tiptap JSON；
- Yjs 和多人协同编辑不属于本计划；
- 实时保存 debounce 和冲突合并另立功能计划；
- Hermes 能力开放不能绕过简历写入、事实确认、分支隔离和 Repository 边界。

## 10. 执行记录（2026-10-05）

### 10.1 提交记录

| 阶段 | 提交 | 内容 |
| --- | --- | --- |
| P-1A | `d38993e` | 统一 ResumeSectionTypeV2 目标目录与 resolver；删除 experience→project 兜底，栏目由 5 个扩展到 17 个；修复技能 before 与 fieldPath 语义不一致 |
| P-1B | `5f81fe7` | 扩展现有 AgentSession/AgentTaskState 的诊断字段（knownSlots.tailoringDiagnostics）；界面新增可展开的未应用/需关注区域；diff 补齐栏目·条目·字段定位 |
| P-1C | `26056eb` | 接通 compose 的 userPreferences，收紧为受控枚举并经 writingPreferenceDirectives 进入 prompt，prompt 升至 v5 |
| P-1D | `38a91ec` | 拆分 projector 的去重与换行制造两个语义，只按作者已有换行去重；块级叙事 description 补 pre-line |
| P-1E | `4217fba` | 修复导出快照丢弃排版设置、打印继承画布缩放、投递页重建 config 的 sectionOrder 缺省值 |
| P-1E | `dc7f773` | 修复 PDF 打印样式表缺失 preflight reset；入库渲染对照脚本与基线数据 |
| P-1F | `269e983` | 忽略渲染对照输出目录；补导出快照往返与旧快照兼容测试 |
| P-1F | `18632d4` | 修掉全量 lint 下的未使用解构变量，断言内容未变 |
| P-1F | `41838bd` | 新增确定性简历 fixture（全程走 WorkspaceRepository，含 setActiveCareerContext）与 Node 侧 smoke |
| P-1F | `d0753c8` | 纠正测量对象：正式页面与分页测量页分离，诊断字段转为断言 |
| P-1F | `119aebe` | 经样式「页面」标签抵达应用内 PDF 导出控件，抽出共享注入 helper |
| P-1F | `b82aed5` | 忽略 tmp/pdfs 测试输出 |

### 10.2 完整门禁结果

| 命令 | 退出码 |
| --- | --- |
| `pnpm typecheck` | 0 |
| `pnpm lint`（全量，`--max-warnings=0`） | 0 |
| `pnpm test` | 0（189 files / 1316 tests） |
| `pnpm build` | 0 |
| `pnpm electron:build:dir` | 0 |
| `git diff --check` | 0 |

打包产物：`release/win-unpacked/`（exe 225MB、app.asar、hermes-runtime 14732 files / 323MB、next-standalone 8114 files / 1309MB，next/react/@playwright 均在位）。打包途中两次因访问 GitHub 超时失败（`Timeout awaiting 'request'`、`connect ETIMEDOUT 20.205.243.166:443`），确认是间歇性网络问题，重试后通过。

测试规模由 1231 增至 1316（+85），全程无回归，未使用 skip、todo 或降低断言。

### 10.3 P-1F 真实渲染验收数据

固定 fixture、同一浏览器、同一字体，对比构建产物 CSS 的 screen 渲染与源码剥离 CSS 的 print 渲染：

- 修复前：每个 `p` 的 margin-bottom 预览 `0px` / PDF `14px`（UA 的 1em），经历要点位置偏移 11.113mm，正文底部相差 10.318mm；
- 修复后：各元素位置偏移全部为 0.000mm，正文底部差降至 0.794mm；
- 0.794mm 来自紧凑技能行（`resume-skill-description` 为 `span`）的行高差异，**当前 fixture 未观察到分页影响**，不宣称所有内容下都无影响；
- 测量脚本与基线数据保留在 `scripts/verification/render-parity.mjs` 与 `render-parity-baseline.json`。

### 10.4 已知缺口与独立债务

**（1）真实 provider 链路未验证 —— 最高优先级**

现有 provider 持续返回 401，真实 Hermes/provider E2E **未执行**。mock 与 contract 测试通过**不能替代**真实 provider 验证。V4-P0 必须首先执行 Provider Health Smoke 子任务，查明 401 属于代码/适配器问题还是无效、过期或缺失的外部凭据；凭据不可用时明确记录为外部环境阻塞，不得宣称真实 AI 链路通过。凭据不得写入源码、仓库或前端。

**（2）JSON 导入最终未创建分支 —— 高优先级**

JSON 导入走到确认流程但未在 `resumeBranches` 留下记录，原因尚未查明。必须在 V4 使用该导入链路之前修复。**不要回溯修改已完成的 P-1F。**

**（3）`v2-g4a` 定位器与当前 UI 不一致 —— 测试维护债务**

既有导入用例查找 `name: "导入"`，当前 UI 可见控件为「导入简历」与「选择或拖放文件」。该不一致早于本轮改动，不阻塞 V4-P0，但应单独修复，**不得通过 skip 或降低断言处理**。

### 10.5 交接说明

P-1F 只覆盖不依赖 provider 的确定性渲染与导出路径：已有测试数据 → ResumeWorkspace → 浏览器预览 → browser print/PDF → 比对内容、换行、栏目顺序与排版配置。真实 AI 对话链路仍由既有 mock 用例覆盖。

进入 V4-P0 后仍必须重新核对当前源码与测试，不能假设本计划完成即意味着 V4 功能已经存在。


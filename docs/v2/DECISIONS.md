# Decisions

## ADR-001 V1/V2文档分离

- 状态：Accepted
- 背景：V1 `Plan.md` 和 `history.md` 已很长，继续追加会拖慢上下文。
- 决策：V1保留为历史档案，V2使用 `plan2.md` 和 `history2.md`。
- 理由：降低上下文成本，防止旧状态误导。
- 替代方案：继续维护同一Plan。
- 后果：V2必须维护新入口。
- 日期：2026-07-03

## ADR-002 冻结Plan.md/history.md

- 状态：Accepted
- 背景：V1已完成MVP纵向闭环。
- 决策：除严重Bug修复和交付补记，不再向V1文档追加V2内容。
- 理由：明确历史和当前计划边界。
- 替代方案：在旧文档中增加V2章节。
- 后果：需要交接文档承接V1信息。
- 日期：2026-07-03

## ADR-003 plan2/history2为V2权威文档

- 状态：Accepted
- 背景：V2需要独立里程碑。
- 决策：`plan2.md` 是V2唯一权威计划，`history2.md` 记录V2变更。
- 理由：避免计划分裂。
- 替代方案：只用docs/v2。
- 后果：每轮V2开发必须更新两份文档。
- 日期：2026-07-03

## ADR-004 优先Resume Studio

- 状态：Accepted
- 背景：用户最直接感知的是简历编辑、模板和导出。
- 决策：第二代主线优先Resume Studio，不优先Application看板。
- 理由：先提升可投递成品体验。
- 替代方案：先做求职流程管理。
- 后果：多Profile和Application后置到G6。
- 日期：2026-07-03

## ADR-005 增量演进而非完全重写

- 状态：Accepted
- 背景：V1已有可用闭环和安全机制。
- 决策：复用V1稳定模块，围绕ResumeDocument增量演进。
- 理由：降低风险，保留Fact Guard和导出基础。
- 替代方案：重写编辑器和数据层。
- 后果：需要兼容V1 Branch/Revision。
- 日期：2026-07-03

## ADR-006 内容与样式分离

- 状态：Accepted
- 背景：样式修改不应污染事实历史。
- 决策：内容Revision与展示配置/PresentationRevision分离。
- 理由：保护事实审计和撤销语义。
- 替代方案：所有编辑共用一个Revision。
- 后果：Repository需要区分写操作类型。
- 日期：2026-07-03

## ADR-007 第一阶段不做自由画布

- 状态：Accepted
- 背景：完全自由坐标编辑复杂且难导出。
- 决策：采用结构化区块编辑器和有约束布局。
- 理由：保留factRefs，导出可测试。
- 替代方案：类似设计软件的自由画布。
- 后果：版式自由度较低，但稳定性更高。
- 日期：2026-07-03

## ADR-008 模板层不得生成事实

- 状态：Accepted
- 背景：模板切换应是视觉行为。
- 决策：模板只渲染ResumeDocument，不写事实。
- 理由：防止模板引入虚构内容。
- 替代方案：模板附带自动文案。
- 后果：模板推荐与内容建议必须分离。
- 日期：2026-07-03

## ADR-009 不承诺任意PDF一比一还原

- 状态：Accepted
- 背景：复杂PDF版式还原成本高。
- 决策：P0做内容导入和系统模板重排，样式近似后置。
- 理由：避免虚假承诺。
- 替代方案：从第一阶段做坐标级PDF编辑。
- 后果：复杂设计型PDF提示用户使用系统模板编辑。
- 日期：2026-07-03

## ADR-010 不做自动投递

- 状态：Accepted
- 背景：自动投递和平台操作有合规风险。
- 决策：不做自动批量投递，不绕过招聘平台规则。
- 理由：合规优先。
- 替代方案：浏览器自动化投递。
- 后果：产品聚焦材料质量和人工确认。
- 日期：2026-07-03

## ADR-011 第一阶段不做复杂云同步

- 状态：Accepted
- 背景：当前MVP是本地优先。
- 决策：V2早期继续本地优先，云同步后置。
- 理由：隐私和实现风险更可控。
- 替代方案：先做账号和云端。
- 后果：跨设备能力暂缓。
- 日期：2026-07-03

## ADR-012 多Profile/Application后置

- 状态：Accepted
- 背景：页面存在隐式profiles[0]，但用户首要痛点是简历工作台。
- 决策：多Profile和Application进入G6，不抢G0-G3。
- 理由：先建立可编辑可导出的核心体验。
- 替代方案：先做Workspace重构。
- 后果：G0需避免扩大隐式上下文问题。
- 日期：2026-07-03

## ADR-013 模板中心使用静态类型化Registry

- 状态：Accepted
- 背景：G2需要从两套模板升级到正式模板中心，但当前只需要第一批四套本地模板。
- 决策：模板元数据、capabilities、默认样式、renderer和thumbnail renderer 全部放在单一静态类型化 Registry；不新增 Dexie 表，不新增模板数据库，不接入远程模板下载。
- 理由：模板是展示层能力，静态 Registry 可覆盖当前浏览、筛选、缩略图和应用模板需求，风险低于引入模板市场或数据迁移。
- 替代方案：新增模板表、远程模板清单或第二套模板注册系统。
- 后果：G2第一阶段模板数量有限；后续若进入模板市场或远程模板，需要单独设计迁移、签名、缓存和安全边界。
- 日期：2026-07-04

## ADR-014 模板缩略图复用正式Renderer

- 状态：Accepted
- 背景：模板中心需要缩略预览，但复制一套假模板DOM会造成展示不一致。
- 决策：缩略图复用当前 `ResumeRenderModel`、正式模板 renderer 和同一套样式 token，仅通过缩放容器显示。
- 理由：保证缩略图、A4预览和PDF同源；避免模板卡片生成事实、写配置或进入导出。
- 替代方案：为每套模板单独维护静态 SVG/HTML 缩略图。
- 后果：模板中心会多渲染少量当前简历DOM；当前四套模板规模可接受，后续模板数量扩大时再评估静态脱敏 fixture 缩略图。
- 日期：2026-07-04

## ADR-015 直接 PDF 使用冻结快照和本地 Headless Chromium

- 状态：Accepted
- 背景：用户数据存储在浏览器 IndexedDB，Next API 不能直接读取本地 Dexie；同时直接 PDF 必须复用正式模板 renderer，保持预览、PDF 和 ExportRecord 一致。
- 决策：G3a 由客户端在点击时冻结 `ResumeRenderModel` 与 `ResumePresentationConfig`，通过 Schema 校验后 POST 到本地 Next API；API 使用现有 Playwright Chromium/Edge、正式模板 Registry 和打印 CSS 生成 A4 PDF。
- 理由：避免第二套排版系统；避免截图型 PDF；不上传第三方；不新增依赖；保证生成过程中用户继续编辑不会污染当前 PDF。
- 替代方案：浏览器端 HTML 转 PDF 库、pdf-lib 重新绘制、仅保留浏览器打印。
- 后果：本地运行需要 Playwright 可启动 Chromium/Edge；生产云部署若裁剪 devDependencies，需要单独把运行时浏览器能力产品化。浏览器打印继续保留为 fallback。
- 日期：2026-07-04

## ADR-016 分页计划由正式Renderer的DOM测量生成

- 状态：Accepted
- 背景：G3b 需要支持严格一页和最多两页，同时保证 A4 预览、直接 PDF、浏览器打印 fallback 和 ExportRecord 对同一份内容给出一致页数判断。
- 决策：分页计划由正式模板 renderer 渲染出的隐藏测量 DOM 生成；客户端用于预览和导出前阻断，服务端 Headless Chromium 在生成 PDF 前再次测量并重算 `PaginationPlan`。`paginationHash` 记录策略、页数和 section/block 分页归属，不记录原始像素测量。
- 理由：复用正式 renderer，避免维护第二套排版估算；服务端二次测量能防止客户端状态或浏览器差异污染最终 PDF；hash 排除像素值可降低微小字体/渲染差异带来的误报。
- 替代方案：按字符数估算页数、CSS columns 自动分页、Paged.js、或直接允许无限页。
- 后果：分页能力受当前模板 DOM 结构约束，模板必须保留 `data-render-section` 和 `data-source-item-id`；三页策略、自动压缩和续页页眉需要后续单独设计。
- 日期：2026-07-05

## ADR-017 文本型PDF导入创建通用ResumeBranch

- 状态：Accepted
- 背景：用户已有简历导入后需要立即进入 Resume Studio 套模板和导出，但此时未必有目标岗位；若强行复用岗位分支模型，会诱导伪造 Job、JD 或 RequirementMatch。
- 决策：G4a 文本型 PDF 导入先生成 `ImportedResumeDraft` 供用户审阅，确认后创建 `branchPurpose=general` 的 verified `ResumeBranch`。通用分支绑定 `sourceImportId`，不要求 `jobId`，不创建虚假 Job，不生成岗位匹配结果。
- 理由：保持“已有简历 -> 通用简历工作台”的真实闭环，同时不破坏岗位定制分支的事实和匹配语义。
- 替代方案：导入时自动创建空 Job；只写 CareerProfile 不创建分支；直接持久化 ResumeDocument；新增 Dexie 导入表。
- 后果：Mapper、RenderModel 和 Repository 必须允许 general 分支无 Job 渲染；后续 G5 岗位优化仍应从 general 分支显式派生 job_specific 分支，而不是复用导入分支冒充岗位简历。
- 日期：2026-07-05

## ADR-018 G5a复用ResumeBranch/AiSuggestion实现区块级岗位优化

- 状态：Accepted
- 背景：G5a 需要让用户基于通用或岗位简历生成岗位定向修改，但不能新增第二套建议、Fact Guard 或内容版本系统，也不能让 AI 静默改写正式简历。
- 决策：区块级岗位建议继续使用 `AiSuggestion` 和 `JobAdaptationDraft`，通过新增可选元数据绑定 `ResumeBranch.contentItems`；从通用简历派生岗位简历继续使用 `ResumeBranch` / `ResumeRevision`；接受建议通过单一 Repository 事务创建 `suggestion_accept` 内容 revision。
- 理由：最大化复用 C1/C2、Fact Guard、Revision、Dexie v7 和 Resume Studio 现有边界，避免引入新表、新 provider 或第二套风控。
- 替代方案：新增 job optimization draft 表；把 AI 建议直接写入分支；在前端自由文本覆盖正文；导入独立富文本编辑器。
- 后果：建议必须携带 branch revision、currentRevisionId、originalTextHash 和 requirementsHash；过期建议必须重新生成；结构建议仍走展示配置，不创建内容 revision。
- 日期：2026-07-05

## ADR-019 G5b诊断作为派生快照而非新事实源

- 状态：Accepted
- 背景：G5b 需要基于岗位覆盖、内容、排版、分页、模板和 ATS 结构风险给出可解释诊断，但不能新增第二套事实、匹配、分页或模板系统。
- 决策：诊断使用类型化 `ResumeDiagnosticSnapshot` 派生结果，默认运行时计算，忽略状态只使用现有 `appMeta`，安全动作只走展示配置队列。
- 理由：复用 G5a `RequirementBlockMatch`、G3b `PaginationPlan`、Template Registry 和既有 Repository 边界，避免新增 Dexie 表或修改 Fact Guard。
- 替代方案：新增诊断表、接入第三方 ATS、用 AI 生成诊断正文、或直接自动改正文。
- 后果：诊断不会成为正式事实来源；ExportRecord 只保存可选摘要；ATS 诊断只能表达结构风险，不能表达通过率或保证。
- 日期：2026-07-06

## ADR-020 Application只管理投递流程

- 状态：Accepted
- 背景：用户需要管理岗位机会、投递状态、跟进日期和投递历史，但已有 `JobDescription`、`ResumeBranch`、`ResumeRevision` 和 `ExportRecord` 已经承担岗位、简历和导出的正式职责。
- 决策：G6a 新增 `ApplicationRecord` 和 `applications` 表，仅保存实体引用、岗位/公司快照、状态、日期、备注、标签、选定版本、导出记录和时间线。Application 不复制完整简历正文、不保存完整 JD、不保存 PDF Blob、不作为新的事实源。
- 理由：保留现有事实审计、Fact Guard、分支隔离和导出一致性，同时补齐求职流程闭环。
- 替代方案：新增独立投递简历内容表、保存 PDF Blob、或用自由文本覆盖投递版本。
- 后果：PDF 下载需要复用既有导出快照重新生成；若没有可复用 ExportRecord，用户需要回到 Resume Studio 导出。
- 日期：2026-07-06

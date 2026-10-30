# CareerAdapt AI --- P5.1 Agent 架构优化开发计划

## 2026-10-30 P5.1-SQ1：实现落地 / 部分验收，尚未全量通过

用户授权 Guided Resume Intelligence / Skills Quality；起始HEAD与fetch后origin/main均1573e267，Git干净，Core-02冻结证据及六Skill SHA逐项核对。六Skills升级2.0.0，统一Claim Safety v2、澄清/故事挖掘/岗位表达/四视角评审；共享Writer/Intake/Guard提示词，修复通用生成丢弃familiar/learning技能，保留成熟度限定和source turn。Runtime/Repository/CAS/Fact Guard阈值未改，无新表/依赖/Planner/Profile/Resume模型或PDF renderer。

最终相关30文件270项及最后测试类型修正后13项复跑、40/40安全oracle映射、Hermes Behavior12/12（37模拟请求）、定向UI/PDF3/3、typecheck/lint/build/bundle-check/diff退出0。完整Hermes两轮均13/14、退出1：M先等待FIT回复标记90秒超时，第二轮到PDF回执15秒超时（trace有pending PDF POST，状态-1，无完成响应），按规则停止第三次重跑，不宣称14/14。

30匿名case覆盖六类/六Skills；同组before/after哈希、60记录、13维rubric和Web评测包已准备。模拟adapter64响应只证明评测管线；真实专用Provider配置缺失，命令退出2、请求0、REAL_PROVIDER_BLOCKED，文案/提问/HR质量不认证。通用编译对任意当前会话resume_only新声明的专用摄入仍未实现，保留为提案而非隐式写Profile。

后续仅按用户选择复核M直接证据或执行匿名真实质量包；原Core-02历史冻结不改写，OCR/正式包/P518结转。尚未提交、未推送、未打包，不进入P5.1.8/P5.1.9，本轮停止。详见[SQ1阶段报告](p5.1-skills-quality-v1-20261030.md)及[机器证据](p5.1-skills-quality-v1-evidence-20261030.json)。

## 2026-10-30 Core-02-FINAL：COMPLETE / hermetic functional freeze

基线/远程起始main均0079b7bd，工作区干净。L/M/N（最终确认消费与正式PDF）、B/C Hermes多轮、Behavior12/12、完整Hermes14/14（22Run/63模拟请求，0skip/0flaky）、401及来源/版本/模板不变量通过；27文件242项、UI/PDF3/3、typecheck/lint/build/bundle-check/diff全部退出0。修复旧revision对话壳、Job根目标和成功apply遗留pending确认；harness改为suite复用Runtime、独立Context/正式绑定Session、preflight与真实ID fixture，短探针关闭连接，无新增重试。

**Core-02允许冻结；允许后续由用户选择进入Skills Quality，本轮未启动Skills Quality/P5.1.8/P5.1.9。** REAL_PROVIDER_BLOCKED、OCR/安装包NOT CERTIFIED、P518 OPEN按既定边界结转。本轮成果随本次 Git 提交保存，未推送、未打包。此前失败、审计前14/14与确认消费失败全部保留；当前以专项报告第11节和evidence.latestRound=finalFreeze20261030为准，旧状态均为历史轮次。

详见[最终冻结记录](p5.1-core-02-career-intelligence-20261029.md)及同目录证据JSON。


## 2026-10-29 Core-02-CLOSEOUT：PARTIAL / 未冻结

最新基线 HEAD/origin/main 为 `229ad9db`，起始工作区干净。本轮修复材料切人物重勾创建简历、导入确认后 Session Profile 绑定缺失、JD 确认绑定补齐导致解析 operation 冲突，以及明确 Provider 401 证据被 Next 覆盖；旧 bare401 断言按现行契约更新，classifier/CAS/Fact Guard 未放宽。

L 唯一复验在创建 Run 前 ECONNRESET；M 达两次长等待后停止；D 两次失败后定位夹具严格 Schema 不符，已修未复验。B/C 服务多步骤集成通过，完整 Hermes B/C/D 与材料→PDF 仍未认证。12 项独立 Hermes 行为基线实际执行，第二轮10通过/2失败、13 Run/34模拟请求；40/40仍仅安全oracle映射。目录14 CASE不是通过数；完整 Gate 因 L/M/D 前置未过未执行，既有 C/J/I 定向1通过/1失败/1未执行。

最终相关26文件236项、lint/build/bundle-check/typecheck通过；UI3/3及最终正式PDF1/1通过。真实Provider=REAL_PROVIDER_BLOCKED（无安全配置，真实请求0），OCR/安装包未认证。不能冻结或进入Skills Quality；P518仍OPEN。用户已追加授权提交并推送，提交号与远程状态以 Git 和最新交接为准；未打包。历史失败保留，细节见[专项报告第10节](p5.1-core-02-career-intelligence-20261029.md)及 evidence 的 closeout20261029。


## 2026-10-29：P5.1-Core-02 部分交付，完整 Hermes 链未验收

本轮用户授权 A～F，基线 HEAD/远程 main 均为 `bfad45ea`、起始干净。保留 Core-01/P5.1.2 已有能力，仅补 Career Context 的版本/成熟度/来源与跨 Run ID checkpoint、版本绑定 Evidence Matrix、Fit→TailoringSession/Composition→Writer/Reviewer 接线、Profile/Job 原子 CAS 和目标切换拒绝，以及三个独立诊断维度。固定 40 个匿名场景映射基线与六个 Skills 哈希已记录；没有新表、生产依赖、第二运行时或 PDF renderer，没有修改 Fact Guard 阈值。

最终相关 22 文件 192 项 Unit/Integration、typecheck、lint、独立生产 build、bundle-check、diff 通过；固定场景映射 40/40 不代表 40 次独立模型评测。既有 Hermes 中途回归 11/11（23 次模拟 Provider 请求），最终代码另有 C/I/J 三条既有 Hermes 定向回归 3/3（7 次模拟请求），独立业务 UI/正式 PDF 1/1。新增 Core-02 CASE L 两次 90 秒超时后按 AGENTS 停止重跑；已修跨 Run fixture 的旧工具回执依赖并以 HTTP 单测验证，但最终全链 E2E、四个多轮场景与最后 checkpoint 传输的 Hermes 复验仍未完成。旧 HTTP 401 分类断言失败单独保留；真实 Provider/OCR、复杂材料质量未认证。不能宣称 Core-02 完成或全量通过。

详情：[Core-02 报告](p5.1-core-02-career-intelligence-20261029.md)及[evidence JSON](p5.1-core-02-evidence-20261029.json)。用户已追加授权提交并推送本轮部分成果；提交号与远程状态以 Git 和最新交接为准，未打包；P518-RUNTIME-MODEL-READBACK-01 保持 OPEN。后续仅继续本阶段未验收项，不自动开始 Skills Quality、P5.1.8 或 P5.1.9。


## 2026-10-29：P5.1.2 多模态职业材料摄取交付

基线 HEAD/远程 main 均为 `b7a691af7b597ea3dc561d31c7648c8dbd7f39f7`，起始干净。按用户授权完成 A→F：沿用 SourceDocument v2 与原解析/字段映射/核对链路，增加持久化附件来源、provisional material_intake、Hermes 的 12 类材料分类协议、Profile/Resume/Job 目的地复用，以及简历中心第 5 个“导入资料”入口。附件支持整区拖放、缩略图/预览、刷新恢复、发送失败回到原 Session、忙时进入下一 Hermes Turn；没有新增第二个 Composer、解析器、Planner、Runtime、Dexie 表或生产依赖。

当前为 A→F 实现与定向验收完成。已取得 11/11 锁定 Hermes 场景退出 0（23 次模拟 Provider 请求，包含同 Run 材料链、忙时附件下一 Turn、既有岗位确认和正式 PDF）；15 文件 130 项相关测试、UI 2/2、lint、typecheck、生产 build、diff 均退出 0；详细证据见[专项交付报告](p5.1.2-material-intake-20261029.md)。所有正式事实继续经 review/confirmation/WorkspaceRepository；通用简历与岗位分支隔离，Fact Guard 未改。

本机 OCR 未配置，实际 health 已确认降级；OCR/复杂材料采用固定匿名响应验证协议，不代表真实 OCR 质量通过。真实 Provider/用户原件、替代引擎 benchmark 和安装包未验。Hermes 锁定版本及 bundle 不变，P518-RUNTIME-MODEL-READBACK-01 继续 OPEN。用户已追加授权本轮提交并推送；具体提交号与远程状态以 Git 和最新交接为准。未打包，不进入 P5.1.3。

## 2026-10-29 FINAL：职业核心冻结，PARTIAL + CARRY FORWARD

基线HEAD/远程main均0a978ba，起始工作区干净。同一Hermes Run确认后自主续跑已获真实锁定Runtime/MCP证据：确认前1次/确认后新增1次模拟Provider请求，原Tool Call ID及正式Job ID返回，同Run terminal/completed；CASE I定向1/1退出0，完整Hermes9/9退出0（16次模拟Provider请求），岗位简历/正式PDF断言保留。Host只管理确认/状态，Gateway正式写入，Hermes继续语义循环，无第二个Run或新续跑协议。

数字23已直接证明为model/options读回10秒后TimeoutError的DOM异常code，经旧配置客户端原样传播、Supervisor safeReason转字符串进入回滚回执。已最小修复为hermes_model_config_timeout，保留回滚/无重试；端点迟延原因仍OPEN，移交P518-RUNTIME-MODEL-READBACK-01（P5.1.8），不再阻塞P5.1.2。恢复READY/secure_store/配置指纹一致证据保留，实际热切换仍失败且恢复后模型请求未执行，不宣称全部Runtime问题已修复。

最终14文件143项相关测试+1条超时回滚定向测试、typecheck、lint、build、bundle-check及diff均退出0；被名称过滤的20项未执行、不计PASS。真实Provider未认证/真实请求0，正式包未构建。旧失败和本轮5次过程失败保留，当前结果见[Core-01报告](p5.1-core-01-20261028.md)及JSON的finalRounds。职业Agent核心可冻结，可正式进入P5.1.2；本轮未实施P5.1.2/P5.1.8，未提交、推送或打包。


## 2026-10-28 CLOSEOUT最新交接：仍未冻结

起始HEAD/远程main均9bd0d80、工作区干净。Web当前无429为用户观察，不等同Electron/真实Provider通过。CASE I聊天会话确认后缺少workflow导致投影异常，最小修复后定向1/1、完整Hermes9/9通过（分别2/16次模拟Provider请求）。现有CASE I的确认后执行属于Host+业务UI，尚未证明已终态Hermes收到保存结果并自主继续，不扩写成完整链已通过。

R2-RDY-01直接证据为控制鉴权200/401正常、Next503+ZodError；RuntimeHealthSchema遗漏secure_store已对齐，实际路由/Supervisor回归通过。修复后一次复验恢复READY、凭据secure_store、applied/verified及活动/期望指纹一致；随后单次模型切换rolled_back/reasonCode=23、底层原因未证实，请求未执行，停止重启/重试。整体原生harness仍退出1，真实Provider/正式包BLOCKED。四个诊断产品进程均退出0，PID及端口清理检查通过。

最终12文件148项相关测试、typecheck、全量lint、build、bundle-check、diff退出0。未删除文件、提交、推送或打包。Core-01保持PARTIAL_NOT_FROZEN；完整命令/历史失败/限制见[Core-01报告](p5.1-core-01-20261028.md)与证据JSON的closeoutRounds。下一步仅采集失败模型读回的直接证据及明确续跑契约，不自动扩展阶段。


## 2026-10-28：P5.1-Core-01 当前执行覆盖

用户本轮授权 A～D 顺序实施核心链路，覆盖本计划部分 P5.1.1/3/4/5/6；不自动提交推送打包，不恢复全部 V4。当前为部分交付/未冻结：JD 高层录入、确认消息透传、证据矩阵返回、A01/A02 与版本事务约束已实施；R2-RDY-01、恢复后完整请求和真实 JD 确认端到端仍有未验收项。最终范围、门禁与阻塞以 [Core-01 报告](p5.1-core-01-20261028.md) 和 [安全证据](p5.1-core-01-evidence-20261028.json) 为准；不能把这些跨阶段局部交付记为 P5.1.1～P5.1.9 全部完成。原逐阶段路线保留。

-   版本：P5.1-Plan v1.0
-   日期：2026-10-28
-   仓库：[ETO-MQC/CareerAdapt-AI](https://github.com/ETO-MQC/CareerAdapt-AI)
-   阶段：P5.0 已归档；P5.1 为内部 Hermes Agent 与职业智能工作流优化阶段
-   执行原则：Codex
    每次只执行一个阶段，先审计、再修改、再验收；通过后进入下一阶段。

------------------------------------------------------------------------

## 1. 目标与当前判断

### 1.1 P5.1 的目标

CareerAdapt
的竞争力不是单纯生成简历，而是把职业资料积累、岗位理解、证据映射、定向简历修改和质量评审整合为一个低摩擦的
Agent 工作流。

P5.1 目标：

1.  Hermes
    能正确判断用户意图，尽量直接完成任务，减少重复提问和重复模型调用。
2.  用户从导入入口上传简历，或直接将简历附在 AI
    对话中，都能进入同一条可追溯的解析、核对与提交链路。
3.  用户粘贴 JD 后，系统能提炼岗位要求、识别重复、保存岗位并保留版本。
4.  AI 只修改选定的简历、分支、Revision
    和允许字段，不误改模板、格式或其他内容。
5.  岗位分析、候选人证据和岗位简历共用一致的要求分析结果。
6.  评分可解释、可复核；真实性是硬约束，不能被其他高分抵消。
7.  用实测数据降低无效工具调用、上下文体积、响应延迟和失败恢复成本。

### 1.2 当前源码中已存在的基础

P5 阶段报告已将下一阶段指向 Agent 优化。当前可复用的基础包括：

-   Hermes 生产
    Runtime：`src/agent/runtime/hermes/HermesCareerAgentRuntime.ts`、`HermesBridgeTransport.ts`、`HermesCareerToolCatalog.ts`。
-   高层业务工具：`src/agent/workflows/CareerWorkflowFacade.ts`、`src/agent/tools/CareerToolGateway.ts`。
-   对话与附件：`src/components/agent/AgentWorkspace.tsx`、`AgentComposer.tsx`、`src/services/agent/AgentAttachmentStore.ts`。
-   简历数据：Resume Schema v2、Resume JSON
    v2、ResumeBranch/Revision、Fact Guard、`WorkspaceRepository`。
-   简历表现：唯一模板
    registry、`ResumeRenderModel`、PresentationConfig、预览与 PDF 链路。
-   岗位处理：`JobRequirementGraphV4`、`candidatePipeline.ts`、岗位规范化、身份识别和去重逻辑。
-   简历智能：`ResumeEvidenceGraph`、`ResumeWriter`、`ResumeReviewer`、现有职业
    Skills。

以下不能只凭历史文档推定，必须在 P5.1.0
实测：生产模型实际可见的工具清单；直接聊天附件与导入入口是否走同一条管线；AI
写入的简历、Revision、模板和 JSON 之间的绑定；真实 Provider 性能；锁定版
Hermes 实际支持的附件、确认、停止与恢复能力。

### 1.3 核心原则

-   **一个语义 Agent：** Hermes 负责意图理解、Skill
    选择和工具规划，不新增并行 Planner 或第二套 Agent Runtime。
-   **一个职业事实来源：** Profile 与证据来源是职业事实依据；Hermes
    通用记忆不充当第二份简历数据库。
-   **一个正式简历模型：** 复用现有 Resume Schema
    v2、ResumeBranch/Revision 和 Repository，不建立平行 JSON。
-   **模板是表现层：** AI 改正文不应隐式换模板；换模板只改展示配置。
-   **高层工具优先：** Hermes 调用业务
    Facade；底层原子工具由领域工作流封装。
-   **低摩擦但不猜事实：**
    明确意图直接执行；只在目标、重复岗位、关键事实或写入边界确实有歧义时提问。
-   **先测量再优化：** 不凭"感觉慢"重构系统。
-   **只加必要复杂度：**
    外部输入、模型输出和持久化边界做必要校验；不在每层重复相同校验、不吞错误、不为未发生的问题堆叠
    fallback。

------------------------------------------------------------------------

## 2. 目标架构与关键数据边界

``` text
用户文字 / 文件 / 当前会话
          |
          v
现有 AI 工作台 + Hermes 对话交互
          |
          v
Hermes Run：理解意图、按需加载 Skill、选择高层工具
          |
          v
CareerWorkflowFacade
          |
          v
CareerToolGateway：契约、权限、会话绑定、确认与结果
          |
          v
职业领域逻辑：导入 / Profile 证据 / JD 分析 / 去重 / Writer / Reviewer
          |
          v
WorkspaceRepository / Job / ResumeBranch / ResumeRevision
          |
          v
结构化结果、必要确认与清晰回执
```

简历数据链路：

``` text
CareerProfile + 来源证据
        -> ResumeBranch / ResumeRevision
        -> Resume Schema v2 / canonical Resume JSON v2
        -> ResumeRenderModel
        -> 唯一 Template Registry + PresentationConfig
        -> Preview / Pagination / PDF
```

AI 修改简历时，必须明确目标 `resumeId`、`profileId`、`branchId`、基准
Revision、允许修改的字段和当前模板配置。未经用户要求，不得改变
TemplateId 或
PresentationConfig。切换模板不得重写正文、Profile、板块顺序或 Resume
Revision。预览与 PDF 必须使用同一 render model、renderer 和分页快照。

当前 `AgentAttachmentStore` 使用内存 `Map` 保存浏览器
`File`。必须实测刷新、会话切换与运行恢复后附件是否仍有效；不能假设浏览器
File 会自动变成 Hermes 可读的本地路径或模型原生附件。

------------------------------------------------------------------------

## 3. 参考项目：学什么、怎么用

  ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  参考项目                                                                     借鉴内容                                                   在 CareerAdapt 的用法
  ---------------------------------------------------------------------------- ---------------------------------------------------------- -----------------------------------------------------------------------
  [Hermes Agent](https://github.com/NousResearch/hermes-agent)                 Run 生命周期、工具注册/分发、Skill                         以仓库锁定版本为准，核对已有能力并对齐交互行为；不新增 Runtime
                                                                               按需加载、记忆与上下文压缩、桌面对话交互

  [career-ops](https://github.com/career-ops-hq/career-ops)                    岗位评估流水线、证据优先、硬性条件与软匹配区分、校准思路   复用逐条岗位要求---候选人证据的映射；当前不做联网搜索、抓取或自动申请

  [offer-toolkit-skill](https://github.com/yanliudesign/offer-toolkit-skill)   顶层意图路由、独立子 Skills、JD                            优化 Skills 职责和工作流顺序；不复制它的模板和评分权重
                                                                               解码、结构化后再生成、只问影响结果的问题

  [ASu-resume-skills](https://github.com/Claycui828/ASu-resume-skills)         简历主张级审计、来源核验、unsupported/contradicted         强化现有 Fact Guard、EvidenceGraph 和 Reviewer；不建第二套事实库
                                                                               等证据状态

  [resume-builder](https://github.com/StoneLL1/resume-builder)                 经历采访、claim/source map、分阶段写作                     参考来源追踪和阶段交接；不引入平行 Markdown 简历库

  [ai-job-search](https://github.com/ai-job-search-dev/ai-job-search)          岗位筛选与完整任务分层、草稿审查、任务状态和恢复           减少重复步骤；当前不做联网搜索、浏览器自动申请或多 Agent

  [Reactive Resume](https://github.com/AmruthPillai/Reactive-Resume)           Schema、模板注册、预览与 PDF 分层                          只参考数据/渲染边界和模板覆盖测试

  [JSON Resume](https://github.com/jsonresume/jsonresume.org)                  标准化 Resume 数据与纯展示主题分离                         参考契约和主题 QA，不替换内部 Resume Schema v2
  ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

代码、模板、字体、截图和第三方资源的许可证要逐项核实；顶层 MIT
不代表所有附带资源均可无条件复制。

Hermes 当前仓库锁定文件为
[`scripts/hermes-runtime-lock.json`](https://github.com/ETO-MQC/CareerAdapt-AI/blob/main/scripts/hermes-runtime-lock.json)，记录版本
`0.19.0`、commit `eb52760564dbba2e5971fa54bd67384e281cd3b8`。上游 `main`
文档只能用于学习，新增功能必须先确认锁定版本支持；不得为了套用上游前端直接升级或替换
Runtime。

------------------------------------------------------------------------

## 4. 阶段顺序与依赖

  -----------------------------------------------------------------------------------------------
  阶段                    名称                       交付结果
  ----------------------- -------------------------- --------------------------------------------
  P5.1.0                  现状审计与基线             真实工具面、数据流、测试与性能基线

  P5.1.1                  Hermes                     复用 Hermes Run/UI 机制，收敛高层工具契约
                          交互、意图与工具边界

  P5.1.2                  多模态职业材料摄取与交互     对话附件和导入入口共用同一解析/核对链路

  P5.1.3                  简历修改与模板数据一致性   正确绑定简历、Branch、Revision、JSON 和模板

  P5.1.4                  岗位录入、去重与版本保存   JD → 结构化 → 去重 → 保存/更新

  P5.1.5                  资料库检索与上下文记忆     只读取当前任务相关且可追溯的事实

  P5.1.6                  岗位匹配与定向简历         要求、证据、缺口和简历修改共用同一分析版本

  P5.1.7                  评分、审查与评测集         统一评分口径，建立可复现的质量基线

  P5.1.8                  性能与运行可靠性           根据实测瓶颈降低延迟、重复调用和恢复失败

  P5.1.9                  集成验收与冻结             端到端验收并更新 P5 阶段报告
  -----------------------------------------------------------------------------------------------

每阶段单独提交、单独验收。某阶段未通过时先修复该阶段，不将失败结果带入下一阶段。

------------------------------------------------------------------------

# 5. 分阶段 Codex 开发任务

## P5.1.0 --- 现状审计与真实基线

**目标：** 先证明系统真实做了什么，避免根据旧文档或猜测重写。

**阅读入口：** - `docs/P5_STAGE_REPORT.md`、`docs/P5.0_OUTCOMES.md` -
`scripts/hermes-runtime-lock.json` - `src/agent/runtime/hermes/` -
`src/agent/workflows/CareerWorkflowFacade.ts` -
`src/agent/tools/CareerToolGateway.ts` -
`src/services/agent/AgentAttachmentStore.ts` -
`src/domain/schemas/resumeV2.ts`、`resumeJsonV2.ts` -
`src/components/resume/templates/registry.tsx` -
`src/domain/jobDiscovery/`、`jobOptimization/`、`resumeComposition/` -
现有 Agent Eval、E2E、导入与模板测试

**实施步骤：**

1.  检查当前分支、HEAD、工作区和未提交改动；不覆盖用户改动。
2.  读取 P5 报告，标记过时的历史状态。
3.  对照 Hermes lock、实际 bundle 与启动路径，列出生产模型可见工具和真实
    Runtime 能力。
4.  追踪 8 条链路：普通问答、简历导入、对话附件、修改简历、粘贴
    JD、岗位去重保存、岗位匹配/定向简历、确认/取消/失败恢复。
5.  核对
    Schema、Branch/Revision、TemplateId、PresentationConfig、ResumeRenderModel、预览和
    PDF 的真实绑定。
6.  运行相关单元测试、类型检查、lint、build 和可用的 Hermes
    集成测试。真实 Provider 不可用时标为
    BLOCKED，不能将模拟结果记为真实通过。
7.  对普通问答、上下文检索、岗位录入、简历导入、定向简历记录样本量、模型/Provider、阶段耗时、工具数和失败类型。
8.  输出
    `docs/architecture/p5.1-baseline-audit.md`：已证实问题、待证实问题、复用资产、测试基线和建议顺序。

**验收：** 核心链路均有源码入口和数据落点；生产工具清单有证据；真实/模拟
Provider 区分明确；本阶段不做功能重构。

## P5.1.1 --- Hermes 交互、意图路由与工具调用边界

**目标：** 复用 Hermes 成熟的对话与 Run 机制，让 Agent
用尽可能少的高层工具完成任务。

**阅读入口：** -
`AgentWorkspace.tsx`、`AgentComposer.tsx`、`AgentConversation.tsx` -
`HermesCareerAgentRuntime.ts`、`HermesBridgeTransport.ts`、`HermesCareerToolCatalog.ts` -
`CareerWorkflowFacade.ts`、`workflowRegistry.ts` -
`AgentTaskStateReducer.ts`、`AgentTurnIntent.ts`、`careerSessionBinding.ts` -
Hermes 锁定版本源码及官方交互实现

**实施步骤：**

1.  在精确锁定的 Hermes commit 上检查流式回复、Run
    状态、工具活动、确认、停止、恢复和错误提示。
2.  对比现有工作台，优先复用已有组件和状态；只修复可复现的交互问题，不做全站重设计。
3.  审计生产模型可见工具：描述应简洁、输入 Schema
    明确、返回值精炼；底层原子工具继续由领域工作流封装。
4.  用用户文本、当前任务状态、选定实体和附件类型判断意图；不要再增加一次独立
    LLM 分类调用。
5.  明确每个高层工作流的输入、输出、持久化行为、确认边界和失败恢复方式。
6.  检查同一条用户消息不会意外启动多个语义 Run；恢复操作必须绑定同一 Run
    身份。
7.  建立固定路由用例：上传简历、优化现有简历、按当前岗位修改、粘贴
    JD、只分析不保存、换模板、含糊指令、多目标冲突。

**验收：**
模型可见工具清单与文档一致；明确意图不触发重复确认或第二次分类调用；歧义时只问一个必要问题；运行、停止、失败状态清楚；不新增第二套
Agent Runtime。

## P5.1.2 --- Hermes 多模态职业材料摄取与统一交互

2026-10-29 用户授权将原阶段扩展为 A→F 连续实施：A 附件交互与持久化，B 通用来源兼容包装，C 原生解析/OCR/已验证 Vision/人工核对，D Hermes 分类与 material_intake，E Profile/Resume/Job 正式工作流复用，F 两个产品入口。实施与实际证据以[专项报告](p5.1.2-material-intake-20261029.md)为准；下列原步骤作为兼容验收约束保留。不自动进入 P5.1.3。

**目标：**
从导入入口上传与直接在聊天中附上文件，都进入同一条可追溯管线。

**阅读入口：** - `AgentComposer.tsx`、`AgentWorkspace.tsx` -
`src/services/agent/AgentAttachmentStore.ts` -
`src/domain/resumeImport/` -
`src/services/resumeImport/ResumeImportOrchestrator.ts` -
`src/domain/schemas/resumeImport.ts` -
`AgentProductCapabilityManifest.ts`

**实施步骤：**

1.  追踪附件注册、引用、会话所有权、释放与消费位置。当前附件 Store
    使用内存 `Map`，实测刷新、会话切换和 Run 恢复后的有效性。
2.  明确附件如何到达领域解析器；不能假设浏览器 `File` 自动成为 Hermes
    可读路径或模型原生附件。
3.  让聊天附件和"导入简历"入口复用 `ResumeImportOrchestrator`
    或现有规范管线；交互可以不同，正式数据结果和来源映射必须一致。
4.  保留文件名、MIME、大小、内容哈希、所属会话和来源；不能仅凭文件名判断身份。
5.  为同一附件建立任务级幂等规则，避免不同入口造成重复导入。
6.  复用当前支持格式与解析器，不无依据扩展格式。
7.  解析后形成草稿和来源映射，继续走现有核对、Fact Guard
    和正式提交边界。
8.  测试空文件、错误 MIME、文件失效、会话不匹配、重复附件、解析/OCR
    失败、取消与恢复。

**验收：**
两个入口结果语义一致；相同文件不会重复写入；附件失败有清晰恢复提示；来源可追溯；未经确认的新事实不会进入正式
Profile/简历/PDF；不建立第二套解析器。

## P5.1.3 --- 简历修改与模板数据一致性

**目标：** 保证 AI 修改正确简历、正确 Revision
和正确字段，且不会意外修改模板或格式。

**阅读入口：** - `src/domain/schemas/resumeV2.ts`、`resumeJsonV2.ts` -
`src/domain/resumeDocument/mapper.ts` -
`src/domain/resumeRender/mapper.ts` -
`src/components/resume/templates/registry.tsx`、`types.ts` -
`src/components/resume/A4ResumePreview.tsx` - `src/services/export/` -
`src/services/storage/repositories.ts` - `ResumeEvidenceGraph.ts` 与当前
AI 写入/Artifact Action/Fact Guard 链路

**实施步骤：**

1.  从用户指令追踪 `resumeId`、`profileId`、`branchId`、基准
    Revision、TemplateId 和 PresentationConfig，输出真实数据流。
2.  查明 AI 实际写入入口：结构化字段、候选 Revision、Artifact
    Action，或旧 JSON 投影。不能仅凭 UI 判断写入目标。
3.  使用现有 Resume Schema v2 和 canonical Resume JSON v2；不增加平行"AI
    专用简历 JSON"。
4.  核对 TemplateId Schema 与唯一 registry 的 ID
    集合是否双向一致；若历史文档与当前源码不一致，以当前源码和可复现测试为准，并更新文档。
5.  AI 修改必须绑定目标和基准 Revision。用户未要求换模板时，TemplateId
    与 PresentationConfig 保持不变。
6.  复用现有字段级修改契约；模型不得输出完整 JSON
    后直接覆盖整份简历。仅当当前契约确实缺少安全字段级写入能力时，才补最小契约。
7.  校验字段类型、canonical field ID、section/item
    类型、未修改字段保留、证据来源和 Fact Guard。
8.  检测并发修改：基准 Revision
    过期时不得静默覆盖；应基于最新版本重算差异或请求用户选择。
9.  正式写入走 Repository/事务并生成可追踪
    Revision；失败不能留下半份数据。
10. 添加不变量测试：只改指定字段；模板不变；换模板只改展示配置；模板切换前后正文哈希一致；预览/PDF
    内容一致；非法字段与过期 Revision 写入被拒绝。

**验收：** 能证明 AI 写入的目标、版本和
Schema；未要求时不换模板；不丢失未修改字段；不会产生非法字段/错位板块；Fact
Guard、Repository 和 Revision 约束全部生效。

## P5.1.4 --- 岗位录入、去重、保存与版本更新

**目标：** 打通"粘贴 JD → 提炼 → 去重 →
保存/更新"，而不是只有底层解析工具。

**阅读入口：** - `src/domain/jobOptimization/v4/analyze.ts` -
`src/domain/schemas/jobOptimizationV4.ts` -
`src/domain/jobDiscovery/candidatePipeline.ts` -
`src/domain/jobAssets/jobDeduplication.ts`、`jdNormalization.ts` -
`src/services/jobs/jobWorkflow.ts` -
`CareerToolGateway.ts`、`CareerWorkflowFacade.ts`、`HermesCareerToolCatalog.ts`

**实施步骤：**

1.  核实现有
    `career.job.parse`、`career.job.commit`、身份识别、三级去重和事务提交的契约。
2.  检查生产 Hermes 是否已有一个可独立完成岗位录入的高层
    Facade。底层工具存在不等于模型能完成完整工作流。
3.  若缺失，新增最小的
    `career.workflow.job_intake`（按现有命名规范调整），封装现有解析、去重、核对和保存逻辑；不要将底层原子工具全部暴露给模型。
4.  保留原始
    JD、来源消息/附件、内容哈希和原文定位。结构化提取公司、岗位、地点、职责、必备/优先要求、年限、证书等字段。
5.  保留每条要求的来源、AND/OR 逻辑和必备/优先类型；缺失信息标记
    unknown，不自行补造。
6.  复用现有三级去重和
    `manualCandidateIdentity`。精确重复复用已有岗位；相似但身份不明时只问一个问题；同一岗位更新应保留版本。
7.  复用现有工作流状态与事务，明确解析、重复判断、待确认、已保存和失败状态。
8.  对明显的 JD
    粘贴默认识别为岗位录入意图；如果现有写入策略允许，在一次工作流中完成解析、去重和保存并回执。只有重复/版本歧义或既有契约要求确认时才提问。
9.  用户明确说"只分析、不保存"时不持久化；明确要求保存时遵循现有写入边界，不增加重复确认。
10. 成功回执只返回岗位 ID、版本、重复/更新结果和简短摘要，不把整份 JD
    或工具日志再次塞进上下文。

**验收：** Hermes
能通过高层入口完成闭环；重复提交幂等；不同岗位不被错误合并；更新有版本；要求逻辑与原文可追溯；不接入联网搜索或自动申请。

## P5.1.5 --- 资料库检索与上下文记忆

**目标：**
给当前任务提供足够且正确的职业事实，而不是每次读取全部资料或依赖模型回忆。

**阅读入口：** -
`career.context.retrieve`、`career.profile.get`、`career.resume.list`、`career.job.list` -
`careerContextBindingResolver.ts`、`careerSessionBinding.ts`、`activeBranchContext.ts` -
Profile 事实来源、成熟度、确认状态和 `ResumeEvidenceGraph.ts`

**实施步骤：**

1.  明确四种数据：职业事实存于
    Profile/来源证据；任务状态存于会话/工作流检查点；程序性知识存于按需加载的
    Skills；通用偏好只保存短小稳定的信息。
2.  不把完整简历、未确认推断、岗位分析草稿写进 Hermes
    通用长期记忆充当事实库。
3.  优化 `career.context.retrieve`，按当前任务返回相关事实、来源
    ID、确认状态和关联实体。
4.  优先使用会话已绑定的 Profile、Resume Branch/Revision 和
    Job；多个合理目标冲突时再问用户。
5.  按任务加载 Skills；普通简历润色不加载岗位搜索或面试流程。
6.  上下文结果应包含相关事实、来源、状态、目标实体和关键缺口，不重复注入全部原文、历史工具输出或无关资料。
7.  只有当结构化检索被真实评测证明存在语义召回缺口时，才单独提案向量检索/重排序；P5.1
    默认不增加向量数据库、Redis 或外部记忆服务。
8.  确定性结果可按源实体
    ID、Revision/版本和规则版本评估复用；源数据或规则变化时必须失效。

**验收：**
关键事实可追溯；不串用旧版本或其他会话；未确认推断不会升级成正式事实；不引入第二套职业事实存储。

## P5.1.6 --- 岗位匹配与定向简历协同

**目标：** 岗位要求、候选人证据和简历修改共享一致的分析结果。

**阅读入口：** - 六个现有
Skills：`candidate-profile-interview`、`career-story-mining`、`job-fit-analysis`、`resume-composition`、`resume-review`、`resume-tailoring` -
`JobRequirementGraphV4`、`ResumeEvidenceGraph.ts`、`ResumeWriter.ts`、`ResumeReviewer.ts` -
`CareerResumeQualityPolicyV1`、`tailoringWorkflowDriver.ts`、`tailorExistingResumeWorkflow.ts`

**实施步骤：**

1.  逐个审查 Skills
    的职责、输入、输出和重复内容；保留有效方法，不重写成巨型 Skill。
2.  岗位分析生成有版本的
    `JobRequirementGraphV4`；匹配和定向简历共用该版本，除非 JD
    更新，不重复完整解析。
3.  每条要求映射到候选人证据，并区分直接支持、可迁移、部分支持、未知、矛盾或不匹配；每项判断能追溯原文与
    Profile 来源。
4.  区分硬性条件、优先条件和可迁移能力；未提及不能直接等同于不具备。
5.  定向简历只修改选定 Job 与 Resume Branch；不得覆盖通用简历或自动反写
    Profile。
6.  复用 Writer + Reviewer + Fact Guard，不强制引入第二个完整
    Agent。只有评测证明额外模型审查能减少重要错误时才考虑增加。
7.  修改优先重组真实经历中的职责、行动、方法和结果；没有证据的数字、职位、工具熟练度和个人贡献不得生成。
8.  只对会实质改变结论的缺失信息提问；其余保留 unknown
    或使用证据支持的稳妥表述。
9.  输出字段级修改差异：改了什么、对应哪条岗位要求、使用哪条证据、哪些内容因证据不足未写入。
10. 用户切换 Job/Resume 后，旧提案不能提交到新目标。

**验收：**
岗位匹配与简历共用分析版本；关键简历主张有证据；不虚构事实；分支隔离正确；用户可以从岗位分析继续完成定向简历，不需重复提供已有信息。

## P5.1.7 --- 评分、审查与固定评测集

**目标：** 让质量可比较、可复现，避免一个含义模糊的总分。

**实施步骤：**

1.  分开三类结果：
    -   岗位匹配：候选人证据与岗位要求的对应程度；
    -   简历内容质量：真实性、具体性、相关性、清晰度、证据密度和冗余；
    -   ATS 结构诊断：文本提取、栏目、字段完整性、阅读顺序和关键词覆盖。
2.  真实性作为独立硬约束。虚构数字、错误归因、未经确认事实或错误目标写入不能被其他高分抵消。
3.  检查当前权重来源；外部项目权重只作为待验证假设，不直接复制并宣称科学。
4.  评分规则要版本化，能追溯岗位要求、证据和规则；证据不足时显示
    unknown，不输出伪精确百分比。
5.  建立至少 40 个不含真实个人隐私的固定场景：8 个意图路由、8
    个附件/导入、8 个 JD/去重/版本、8 个简历字段/模板/事实安全、4
    个岗位匹配/评分、4 个取消/超时/恢复/重复提交。
6.  对生成质量进行结构化人工盲评，至少记录事实忠实度、岗位相关性、具体性、完整性和无关改动。
7.  同一测试集比较旧版与新版，报告通过率、事实错误数、工具轨迹、追问次数、耗时和失败类型。
8.  新增模型审查步骤前必须证明其收益大于延迟与成本；否则保留现有确定性检查。

**验收：** 评分定义与版本清晰；固定测试集未经证实事实写入为
0；错误简历/分支写入为 0；自动化测试和人工盲评分别报告；不宣称 ATS
必过或面试概率。

## P5.1.8 --- 性能与运行可靠性

### Core-01移交：P518-RUNTIME-MODEL-READBACK-01（OPEN，不阻塞P5.1.2）

恢复进程READY且secure_store/配置指纹正常；单次模型切换的managed YAML写入后，锁定model/options读回在10秒截止抛TimeoutError(code=23)，未取得HTTP响应。数字来源已修复为稳定hermes_model_config_timeout并保持回滚，但端点迟延根因未证明。只允许在P5.1.8被明确选中后，对该端点内部inventory/锁/外部目录调用取得有界安全耗时证据，再作最小adapter/lifecycle修复；不得重复无目的重启、增加重试或简单放宽超时。验收须证明成功读回/活动期望指纹一致、下一次真实Runtime请求使用目标模型，以及失败仍回滚且已有Run不被中断。真实Provider与模拟结果分开，见Core-01 FINAL证据。本轮仅移交，不实施该项。


**目标：** 按实测瓶颈减少延迟、重复工具调用和恢复失败。

**阅读入口：** - `runtimeTelemetry.ts` -
`hermesRunReliability.ts`、`hermesRunReadiness.ts`、`hermesIncidentTrace.ts` -
`HermesCareerAgentRuntime.ts`、`HermesBridgeTransport.ts`、`HermesCareerToolCatalog.ts`

**实施步骤：**

1.  使用现有 telemetry 分解 Run 启动、首次 Provider
    请求、首个可见回复、Skill 读取、工具选择、MCP/领域逻辑、工具后
    Provider 请求和最终完成时间。
2.  报告 p50、p95、失败率和样本量；样本不足时明确说明。
3.  按顺序排查重复读取、重复解析、上下文过大、无关
    Skills、冗长工具输出、重复模型调用、工具 Schema
    冗余、MCP/Provider/事件流等待。
4.  只有独立且不破坏版本一致性的读取才并行。
5.  确定性结果缓存键包含源实体
    ID、Revision/版本和规则版本；数据变化后失效。禁止跨用户、会话或简历分支混用缓存。
6.  复用锁定版 Hermes 已支持的 Skill
    按需加载、上下文压缩和提示词缓存；先验证版本能力。保持稳定提示词稳定，不为无意义的改动破坏缓存前缀。
7.  区分认证失败、Provider 超时、上下文溢出、MCP
    失败、领域校验失败和用户取消；只重试明确可重试的错误，非幂等写入复用同一
    operation identity。
8.  不静默切换模型、Provider 或数据目标。
9.  在相同模型、Provider、环境和场景下重跑基线。对确有重复工作的场景比较前后耗时与调用数；没有改善就继续定位，不改变测试口径宣称成功。

**验收：**
每项优化有前后数据；无跨会话缓存污染；写入重试不生成重复岗位/Revision；失败可解释可恢复；质量不退化。

## P5.1.9 --- 集成验收与阶段冻结

**端到端场景：**

1.  上传简历并要求优化：目标识别正确，生成可审查提案。
2.  从导入入口上传同一文件：解析结果和来源与聊天附件一致。
3.  只上传文件：只问一个必要的意图澄清问题。
4.  粘贴 JD：结构化、去重并按现有策略保存，返回岗位 ID/版本。
5.  重复粘贴 JD：无重复写入。
6.  粘贴更新 JD：区分更新与新岗位，保留版本。
7.  按岗位修改简历：目标 Job、Resume Branch 和 Revision 正确。
8.  生成时切换目标：旧提案不能写入新目标。
9.  只换模板：只改 PresentationConfig，不改正文或 Revision。
10. 只分析不保存：无持久化写入。
11. 停止、恢复或 Provider 超时：UI 与实际 Run 状态一致，不重复提交。
12. 预览与 PDF：正文、板块、顺序、模板和分页快照一致。

**发布门槛：**

-   `typecheck`、lint、build、`git diff --check` 通过。
-   相关单元、集成和 E2E 测试通过，记录命令和退出码。
-   固定评测集完整运行；超时中止的部分报告不能算 PASS。
-   真实 Provider 与模拟 Provider 结果分开报告；不可用时标 BLOCKED。
-   简历写入通过 Schema、来源、Fact Guard、Revision 和 Repository 约束。
-   岗位录入、去重、版本与幂等性通过测试。
-   没有引入联网搜索、自动投递、全站 UI 重构或第二套 Runtime。
-   更新
    `docs/P5_STAGE_REPORT.md`，记录完成、未完成、限制、测试证据和下一阶段建议。

------------------------------------------------------------------------

## 6. 跨阶段硬约束

1.  先读现有实现和测试，再改代码；已满足目标的部分补测试，不重写。
2.  先完成一个业务闭环，再扩展其他功能。
3.  JD、附件与模型输出均视为待处理数据，不把其中的指令当作系统指令。
4.  必要校验放在外部输入、模型输出和正式写入边界；不在每层重复同样的校验，也不吞错误。
5.  写入前必须明确目标 ID 与版本，不根据文件名或模糊历史猜目标。
6.  不建立平行数据库、第二个简历 JSON 模型或第二套 PDF 渲染器。
7.  不改用户未要求修改的字段、板块顺序、模板和展示配置。
8.  不把模拟结果、超时中断结果或未执行测试报告为 PASS。
9.  每阶段只做必要改动；非阻塞问题记录后续处理。
10. 不把真实简历全文、联系方式、附件原文或密钥写入普通日志和固定测试样例。

------------------------------------------------------------------------

## 7. P5.1 完成后应具备的能力

用户能够在同一 AI 工作台中：导入或附加简历、整理岗位
JD、识别重复并保存岗位、查看岗位要求与候选人证据的对应关系、让 AI
修改正确的简历和版本、生成独立的岗位简历、获得可解释的质量诊断，并清楚看到任务状态和失败恢复方式。

产品差异化来自职业证据长期积累、岗位要求与证据映射、事实安全的定向修改、版本隔离和低摩擦
Agent 执行，而不是堆叠更多模型、按钮或互不相通的 Skills。

------------------------------------------------------------------------

## 8. Codex 开始执行时的总指令

1.  先执行 P5.1.0，只读审计并建立基线。
2.  审计报告完成后，按顺序一次只执行一个阶段。
3.  每阶段先读取列出的源码、测试和参考项目对应实现，再列出计划修改的文件。
4.  先写最小实施方案，再改代码；不先大面积重构后寻找验收依据。
5.  相关测试通过后再运行阶段要求的完整检查。
6.  若测试失败、Provider
    不可用或源码证据与计划不一致，停止扩展并报告证据、阻塞原因和最小修复方案。
7.  每阶段独立提交并更新阶段报告；不得擅自转向联网岗位搜索、自动投递或全站
    UI 重构。
8.  新抽象、新依赖、新缓存或新记忆存储必须说明现有组件为何不足，以及收益如何验证。

------------------------------------------------------------------------

## 9. 参考资料与代码入口

### CareerAdapt

-   [P5
    阶段报告](https://github.com/ETO-MQC/CareerAdapt-AI/blob/main/docs/P5_STAGE_REPORT.md)
-   [P5.0
    成果总结](https://github.com/ETO-MQC/CareerAdapt-AI/blob/main/docs/P5.0_OUTCOMES.md)
-   [Hermes Runtime
    锁定](https://github.com/ETO-MQC/CareerAdapt-AI/blob/main/scripts/hermes-runtime-lock.json)
-   [HermesCareerAgentRuntime](https://github.com/ETO-MQC/CareerAdapt-AI/blob/main/src/agent/runtime/hermes/HermesCareerAgentRuntime.ts)
-   [HermesCareerToolCatalog](https://github.com/ETO-MQC/CareerAdapt-AI/blob/main/src/agent/runtime/hermes/HermesCareerToolCatalog.ts)
-   [CareerWorkflowFacade](https://github.com/ETO-MQC/CareerAdapt-AI/blob/main/src/agent/workflows/CareerWorkflowFacade.ts)
-   [CareerToolGateway](https://github.com/ETO-MQC/CareerAdapt-AI/blob/main/src/agent/tools/CareerToolGateway.ts)
-   [Resume Schema
    v2](https://github.com/ETO-MQC/CareerAdapt-AI/blob/main/src/domain/schemas/resumeV2.ts)
-   [Resume JSON
    v2](https://github.com/ETO-MQC/CareerAdapt-AI/blob/main/src/domain/schemas/resumeJsonV2.ts)
-   [模板
    Registry](https://github.com/ETO-MQC/CareerAdapt-AI/blob/main/src/components/resume/templates/registry.tsx)
-   [模板表现系统审计](https://github.com/ETO-MQC/CareerAdapt-AI/blob/main/docs/architecture/p4.8b-template-presentation-system.md)
-   [岗位解析
    v4](https://github.com/ETO-MQC/CareerAdapt-AI/blob/main/src/domain/jobOptimization/v4/analyze.ts)
-   [岗位摄取
    Pipeline](https://github.com/ETO-MQC/CareerAdapt-AI/blob/main/src/domain/jobDiscovery/candidatePipeline.ts)
-   [Agent
    评测基线](https://github.com/ETO-MQC/CareerAdapt-AI/blob/main/docs/quality/p4.7b-career-agent-baseline.md)
-   [P4.8c
    验收门槛](https://github.com/ETO-MQC/CareerAdapt-AI/blob/main/docs/testing/p48c-gates.json)

### Hermes 官方资料

-   [Hermes Agent](https://github.com/NousResearch/hermes-agent)
-   [架构概览](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/architecture.md)
-   [Tools
    Runtime](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/tools-runtime.md)
-   [Skills
    指南](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/guides/work-with-skills.md)
-   [Memory
    功能](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md)
-   [上下文压缩与缓存](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/context-compression-and-caching.md)

### 职业 Agent / Skills

-   [career-ops](https://github.com/career-ops-hq/career-ops)
-   [offer-toolkit-skill](https://github.com/yanliudesign/offer-toolkit-skill)
-   [ASu-resume-skills](https://github.com/Claycui828/ASu-resume-skills)
-   [resume-builder](https://github.com/StoneLL1/resume-builder)
-   [ai-job-search](https://github.com/ai-job-search-dev/ai-job-search)

### 数据与人机交互

-   [Reactive Resume](https://github.com/AmruthPillai/Reactive-Resume)
-   [JSON Resume](https://github.com/jsonresume/jsonresume.org)
-   [Microsoft Guidelines for Human-AI
    Interaction](https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/)
-   [Designing Conversational Agents to Support
    Self-Determination](https://selfdeterminationtheory.org/wp-content/uploads/2021/05/2021_YangAurisicchio_DesigningConversational.pdf)

**最终判断：** P5.1 不是把 Hermes 重写得更复杂，而是把 Hermes
的能力正确连接到 CareerAdapt 的职业数据与工作流，让一个 Agent
用更少重复操作完成更完整的任务，同时证明它修改的是正确内容、正确版本和正确目标。

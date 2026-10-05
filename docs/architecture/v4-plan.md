# V4 计划：高自治求职 Agent 的岗位发现、匹配、简历、投递与 Hermes 编排

- 状态：待执行
- 计划版本：V4.1
- 建立日期：2026-10-03
- 适用项目：CareerAdapt AI
- 执行对象：独立开发 AI 或后续开发者

> **强制前置门禁：** 开始本计划的 V4-P0 之前，必须先完成 [v4-preflight-remediation-plan.md](v4-preflight-remediation-plan.md) 的 P-1A 至 P-1F，并取得该计划规定的完整验收记录。前置计划未完成时，不得实现本文件中的任何 V4 阶段。
>
> **前置状态（2026-10-05）：已解除。** P-1A 至 P-1F 均已实现，完整门禁退出码全部为 0，记录见前置计划 §10。V4-P0 现在可以开始。
>
> **V4-P0 范围限制：** V4-P0 只做 Hermes/runtime、MCP、权限、Browser Domain Host、密钥边界、依赖与工具能力的审计，**不直接实现岗位采集或任何其他 V4 功能**。
>
> **V4-P0 首要子任务 —— Provider Health Smoke：** 现有 provider 持续返回 401，真实 AI 链路从未验证。V4-P0 必须先查明 401 属于代码/适配器问题还是无效、过期或缺失的外部凭据；不得把 API Key 写入源码、仓库或前端；凭据可用时执行一次最小真实 smoke，不可用时明确记录为外部环境阻塞。**mock 与 contract 测试通过不能替代真实 provider 验证。**

> 本文是 V4 的唯一执行入口。它建立在当前 CareerAdapt 的 Resume Schema v2、WorkspaceRepository、Fact Guard、Job Optimization、ApplicationReadiness、Hermes MCP Bridge 和 Electron 运行时之上。
>
> 本版本保留高自治产品目标，不把 V4 收缩成单来源岗位导入；同时将模型能力、网络来源权限、业务数据写入权和高影响外部操作拆成不同边界，避免把“Agent 可以规划”错误实现成“Agent 可以无条件执行所有副作用”。

### 0.0 前置修复遗留的独立债务（2026-10-05 登记）

以下三项来自 [v4-preflight-remediation-plan.md](v4-preflight-remediation-plan.md) 的验收记录，**不因前置门禁解除而视为已完成**：

| # | 债务 | 优先级 | 约束 |
| --- | --- | --- | --- |
| 1 | **真实 provider 链路未验证**：持续 401，真实 Hermes/provider E2E 未执行 | 最高 | 由 V4-P0 的 Provider Health Smoke 处置；凭据不得写入源码、仓库或前端；不可用时只能记录为外部环境阻塞 |
| 2 | **JSON 导入最终未创建分支**：走到确认流程但 `resumeBranches` 无记录，原因未查明 | 高 | 必须在 V4 使用该导入链路之前修复；**不要回溯修改已完成的 P-1F** |
| 3 | **`v2-g4a` 定位器与当前 UI 不一致**：用例查找 `name: "导入"`，当前可见控件为「导入简历」/「选择或拖放文件」 | 中（测试维护） | 不阻塞 V4-P0，但需单独修复，**不得通过 skip 或降低断言处理** |

---

## 0. 执行前提与不可违反的项目边界

### 0.1 权威顺序

开发 AI 必须按以下顺序理解任务：

1. AGENTS.md。
2. 用户本轮明确需求。
3. 本文件。
4. 与当前 Phase 直接相关的源码、Schema、Repository 和测试。
5. Plan3.md 当前阶段对应内容。
6. history3.md 最近相关记录。

除非本 Phase 明确需要，不读取和修改旧版 Plan.md、history.md、plan2.md、history2.md、MVP_V1_HANDOFF.md、V2_START_HERE.md。

### 0.2 工作区基线

开始任何修改前必须记录：

- git rev-parse HEAD；
- git status --short；
- 当前用户已有修改；
- 当前 Phase 的允许修改文件；
- typecheck 和直接相关测试结果。

当前工作区可能存在用户已有未提交修改。禁止使用 reset、clean、checkout、批量删除或其他破坏性 Git 操作。不要覆盖与当前 Phase 无关的用户修改。

本计划中的文件行号不是稳定 API。实施时按符号名、Schema 名、方法名和测试名定位。

### 0.3 项目不可破坏边界

- Domain 继续使用 Resume Schema v2。
- 所有业务写入必须经过 WorkspaceRepository。
- ResumeDocument 只派生，不持久化。
- 通用简历、岗位分支和个人资料库保持隔离。
- 岗位分支不能隐式反向写入个人资料库。
- 新事实必须保留 provenance，并经过用户确认后才能进入预览、PDF 或正式材料。
- Fact Guard 的现有阈值和基本安全语义不因 V4 被删除或降低。
- 不以 JD 内容作为用户个人事实证据。
- 不把 API Key 写入前端、源码、仓库或可读的 renderer 持久化存储。
- 不通过 skip、删除断言、降低阈值或吞错处理失败。
- 不新增 Dexie 表，除非本文件或用户明确批准。本版本批准 5 张 V4 采集/辅助表；模拟面试 4 张表延后到 V4-P8。
- 不新增生产依赖，除非完成必要性报告、版本兼容性验证和 Electron 打包验证。

### 0.4 用户已经确认的 V4 产品目标

- 要接入找岗位、看匹配、改简历、练面试、管投递五条主线。
- Hermes 可以发挥通用 Agent 能力，不仅限于固定的聊天式工作流。
- 需要定时任务、浏览器、搜索、岗位来源编排和半自动网申。
- 新增五张岗位采集/网申辅助 Dexie 表可以进入 V4。
- 模拟面试后置。
- 最终网申提交由用户完成。
- 不自动代持第三方账号密码、验证码、身份证、学籍等证件信息。

---

## 1. 调研结论与 V4 产品判断

### 1.1 MyCareer 的真正可借鉴部分

MyCareer 是本地个人版求职 Agent，数据保存在本机，匹配结论带简历证据，外部操作需要用户确认。它的 BOSS 岗位采集是用户打开岗位详情页并主动点击保存，不是后台自动搜索和批量爬取；项目当前也明确没有后台定时任务。

参考：

- MyCareer 仓库与 README：https://github.com/low-hands/MyCareer
- 许可证：MIT。移植代码或文档资产时保留来源和许可证说明。

值得移植的资产：

- JD 归一化、hash、快照和多级去重；
- overall fit 派生判定；
- hard gate 识别；
- coverage ratio；
- follow-up cadence；
- application 状态机；
- 简历 patch 结构和引用表；
- Markdown 安全转义；
- 后续模拟面试的六节点拓扑、题目预写、延后并行评分和公司风格库。

不直接复制为当前系统事实来源的部分：

- MyCareer 的三层证据硬闸；
- 与当前 ApplicationStatus 不一致的状态名称；
- 与当前 Job Optimization v4 和 coverage v2 重复的第二套匹配真相；
- 依赖 Python/LangGraph/SQLite 的存储与状态实现。

迁移原则：

> 当前 CareerAdapt Schema、Repository、Fact Guard 和 Job Optimization 是唯一领域真相；MyCareer 逻辑只能作为派生指标、质量诊断、工作流实现或 UI 投影。

### 1.2 Hermes 的正确定位

CareerAdapt 当前是 Hermes 的 MCP server，Hermes 反向调用 CareerAdapt 工具。当前 MCP Bridge 会将需要浏览器域能力和 IndexedDB 的请求转回浏览器侧 Domain Host。

Hermes 官方工具集文档显示，hermes-api-server 可以包含 web、file、terminal、browser、process、code execution、delegation、cronjob 等能力；browser_cdp 取决于运行时是否存在可用 CDP endpoint。

参考：

- Hermes Toolsets Reference：https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/toolsets-reference.md
- Hermes Browser Automation：https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/browser.md

但是本项目打包的是固定 Hermes 运行时，不能直接按 Hermes main 分支文档开发。V4-P0 必须先对本项目实际 Hermes 版本生成工具和 toolset 清单，并记录差异。

### 1.3 招聘平台的来源策略不能一刀切

官方 ATS 和企业招聘接口具有最高工程价值，应优先于页面逆向：

- Greenhouse Job Board API：https://docs.greenhouse.io/job-board.html
- Lever Postings API：https://github.com/lever/postings-api
- SmartRecruiters Posting API：https://developers.smartrecruiters.com/docs/endpoints

BOSS 用户协议明确限制未经许可使用插件、第三方工具、蜘蛛、爬虫、拟人程序和规避技术措施。LinkedIn 也明确禁止 crawler、bot、浏览器扩展和自动化软件。

参考：

- BOSS 用户协议：https://www.zhipin.com/web/common/protocol/protocol-2019-09-30.html
- LinkedIn Prohibited Software：https://www.linkedin.com/help/linkedin/answer/a1341387/prohibited-software-and-extensions

因此，“覆盖所有平台”在产品上表示建立可扩展的来源注册与适配器体系，不表示对每个平台都承诺无人值守自动抓取。来源必须有 automationLevel：

- scheduled；
- user_present；
- user_capture；
- manual_only；
- blocked。

### 1.4 合规与数据边界

本计划不是法律意见。工程上采用来源政策矩阵，不能用“公开页面”四个字推导出任何自动化行为都被允许。

《网络数据安全管理条例》第十八条要求使用自动化工具访问、收集网络数据时评估对网络服务的影响，不得非法侵入或干扰网络服务。《网络反不正当竞争暂行规定》第十九条限制以技术手段非法获取、使用其他经营者合法持有的数据并妨碍服务正常运行。

参考：

- 《网络数据安全管理条例》：https://xzfg.moj.gov.cn/front/law/detail?LawID=1734
- 《网络反不正当竞争暂行规定》：https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2024/art_80019fe59e464196bef173dc56678a42.html

V4 禁止：

- 代理池、IP 轮换、伪造身份规避封禁；
- 验证码绕过；
- 指纹伪装和 stealth 注入作为生产要求；
- 破解 VMP 或安全检测；
- 高并发、短时间批量请求；
- 自动发消息或自动投递；
- 抓取 HR、求职者姓名、头像、手机、微信、邮箱等个人信息；
- 对外批量导出和再分发岗位数据。

遇到登录墙、验证码、security check、robots 拒绝、401、403、429 或平台明确拒绝自动化时，必须停止、记录原因并交给用户。

### 1.5 浏览器登录态的现实约束

Playwright 官方不支持让多个实例共用同一个 User Data Directory，也不建议直接自动化默认 Chrome profile。Chrome 136 起，默认 Chrome 数据目录不再接受普通 remote debugging port，自动化应使用独立数据目录；Chrome 官方建议自动化场景使用 Chrome for Testing。

参考：

- Playwright launchPersistentContext：https://playwright.dev/docs/api/class-browsertype
- Playwright Authentication：https://playwright.dev/docs/auth
- Chrome Remote Debugging Changes：https://developer.chrome.com/blog/remote-debugging-port

V4 默认使用 CareerAdapt 管理的独立 profile。用户日常浏览器通过扩展或用户明确启动的专用 CDP 会话接入，不复制 Cookie，不接管默认 profile。

### 1.6 豆包等模型服务

消费者端会员不等于可供本地 Agent 调用的 API 权限。若用户拥有火山方舟 API 或 Agent Plan 权限，使用官方 Ark API Key 和官方工具接口接入，不通过模拟登录豆包网页或复用消费者端会话。

参考：https://docs.volcengine.com/docs/ark/api-key?lang=zh

---

## 2. V4 产品目标与非目标

### 2.1 产品目标

CareerAdapt V4 是一个本地运行的高自治求职 Agent：

1. Agent 根据用户目标发现和整理多个来源的岗位。
2. 系统保留来源、原文、快照、抓取批次和解析版本。
3. 系统将外部候选岗位转换为现有 JobDescription 和 JobAnalysisDraft。
4. 系统使用现有匹配、简历分支、Fact Guard 和 ApplicationReadiness。
5. Hermes 可以搜索、浏览、编排、定时、委托和调用 CareerAdapt 工作流。
6. 用户可以在明确设置后打开更高自治级别。
7. 投递辅助停在用户提交之前。
8. 所有正式业务写入可审计、可恢复、可回滚到工作流层。

### 2.2 V4 不做

- 不做公网多用户招聘平台。
- 不对外提供岗位数据库或批量导出。
- 不将抓取结果同步到中心服务器。
- 不替用户提交网申。
- 不替用户处理验证码、密码、短信 OTP、身份证、学籍号和银行卡。
- 不自动发送 BOSS、LinkedIn 或其他平台消息。
- 不默认开启代理池、stealth、反检测或验证码解决服务。
- 不让 JD 直接成为用户简历事实。
- 不新增第二套通用简历或 Application 主数据。
- 不在本阶段实现模拟面试；模拟面试进入 V4-P8。

---

## 3. V4 不可擅自改变的产品决策

### D1：Hermes 能力分级开放

Hermes 的相关能力可以开放，不通过 CareerAdapt 静默隐藏，但分为三个自治级别：

| 级别 | 主要能力 | 默认 |
|---|---|---|
| Career Mode | CareerAdapt 工作流、搜索、技能、记忆、受控浏览器 | 是 |
| Autonomous Job Search | 定时、来源编排、浏览器、委托、候选岗位写入 | 用户开启 |
| Power Agent | terminal、file、process、execute_code、browser、cron、delegate 和用户配置 MCP | 用户明确开启 |

Level 3 的本地工具权限不能自动赋予网申、岗位正式提交或个人资料同步权限。模型能力开放与业务副作用确认是两套独立机制。

如果当前 Hermes 运行时支持 hermes-api-server 这一完整平台 toolset，Power Agent 可以显式启用它；如果当前打包版本只支持拆分的 core toolset，则按实际能力等价组合。CareerAdapt 不得因为自己的默认模式而偷偷把用户已经明确开启的 Hermes 工具改回受限集合。

### D2：网申半自动

允许：

- 打开页面；
- 识别表单；
- 填普通字段；
- 按用户选择上传简历；
- 生成和展示申请材料；
- 把页面交给用户。

禁止：

- 自动点击最终提交；
- 自动填写密码、验证码、OTP、身份证、学籍、银行卡和签名；
- 自动发消息；
- 自动批量投递。

### D3：浏览器四路径

按优先级使用：

1. 官方 API 和公开 HTTP/SSR；
2. CareerAdapt 独立 persistent profile；
3. 用户主动浏览器扩展采集；
4. Hermes browser/CDP 用户接管。

Patchright 不是默认抓取路径，仅在经过独立验证后作为实验性驱动。

### D4：Fact Guard 与“多写不漏写”

不移植 MyCareer 三闸作为新的硬阻断层，也不因为用户希望更完整就降低 Fact Guard 现有阈值。

新增事实必须通过：

~~~text
AI 发现可能遗漏
→ 向用户澄清
→ 用户明确确认
→ 生成 confirmed provenance
→ 写入岗位分支
→ 用户可选同步个人资料库
~~~

岗位描述只能说明岗位要求，不能证明用户负责过、主导过或精通过某项工作。

### D5：面试后置

模拟面试不进入岗位采集和网申第一轮开发。V4-P8 才新增四张面试表。

### D6：五张 Dexie 表

本版本批准：

- crawlSources；
- jobListings；
- jobSnapshots；
- crawlRuns；
- applicationDrafts。

所有五张表仍必须通过 WorkspaceRepository 写入。

### D7：生产依赖

先验证现有 PDF 导出和服务端浏览器依赖。若生产代码需要浏览器运行时：

- 直接依赖 playwright 运行时包；
- @playwright/test 保留在 devDependencies；
- 不把测试运行器作为生产运行时；
- 使用系统 Chrome、Edge 或 Chrome for Testing 时关闭不必要的浏览器下载；
- 通过 standalone 和 Electron 目录构建验证；
- Patchright 不作为 P0 默认依赖。

### D8：唯一业务数据所有者

Browser Domain Host 和 WorkspaceRepository 是唯一业务写入入口。Node crawler、Hermes plugin、Next route 和 renderer 都不能直接绕过它们修改 Dexie。

### D9：候选岗位和正式岗位分离

抓取结果可以自动保存为候选岗位；转换为正式 JobDescription 必须经过现有岗位草稿和确认流程。

### D10：定时任务边界

定时任务可以自动发现、解析、去重、匹配和生成报告。默认不能自动正式提交岗位、生成正式简历 PDF 或启动网申填写。

### D11：用户日常浏览器

默认不接管用户日常 Chrome profile。需要真实登录态时优先使用浏览器扩展；需要 CDP 时由用户明确启动专用 profile。

### D12：模型服务

模型 Provider 由用户配置。OpenAI、DeepSeek、Qwen、Doubao Ark 和本地模型可以通过统一 Provider Adapter 接入。API Key 只保存在主进程安全配置、环境或系统安全存储中。

---

## 4. 目标架构

~~~text
Hermes
  ├─ web / browser / cron / terminal / delegate
  ├─ CareerAdapt MCP
  └─ CareerAdapt Plugin
          ↓ loopback + auth
CareerAdapt Host / Next API
  ├─ Hermes capability policy
  ├─ Source policy evaluator
  ├─ Crawl orchestrator
  ├─ Browser session manager
  ├─ Confirmation manager
  └─ Application assist manager
          ↓
Crawl and Browser Drivers
  ├─ official API fetcher
  ├─ public HTTP/SSR fetcher
  ├─ managed persistent browser
  ├─ user-assisted browser
  └─ browser extension capture
          ↓
Browser Domain Host
          ↓
WorkspaceRepository
          ↓
Dexie / IndexedDB
~~~

### 4.1 Hermes Companion

electron/hermesCompanion.js 负责：

- 启动和监督 Hermes；
- 注入 provider 绑定；
- 注入 CareerAdapt MCP server 地址；
- 管理 API_SERVER_KEY；
- 写入受控的 managed config；
- 保留用户自有配置；
- 根据 autonomy level 生成 toolset；
- 不把 API_SERVER_KEY 暴露给 renderer；
- 不因自动重写 managed config 而静默移除用户开启的 Power Agent 能力。

renderer 只能通过受控 IPC 请求：

- 读取 Hermes 状态；
- 查询当前工具能力；
- 请求创建或修改定时任务；
- 请求用户确认；
- 请求启动或停止浏览器会话。

renderer 不直接读取：

- API_SERVER_KEY；
- Provider API key；
- 浏览器 Cookie；
- profile 目录中的原始凭据。

### 4.2 CareerAdapt MCP Bridge

保留当前 Bridge 的 session binding、heartbeat、queue、inflight、operation ID 和 failure diagnostics。

新增：

- surface: internal；
- surface: career-production；
- surface: career-autonomous；
- surface: career-power。

普通生产模型主要看到工作流 facade。原子工具继续注册给内部恢复和浏览器域，不作为模型默认组合入口。

### 4.3 CareerAdapt Plugin

Hermes plugin 只调用 CareerAdapt 本地 loopback API，不直接访问 Dexie，不直接读取 browser profile。

必须满足：

- 只绑定 127.0.0.1；
- 使用一次性或短期令牌；
- 请求体大小有限制；
- URL 只允许注册来源；
- 禁止任意 URL 代理；
- SSRF 守卫；
- 健康检查失败时工具不出现在 Hermes tools/list；
- 不 override Hermes 内置工具；
- 不使用 npx 运行时自动下载依赖；
- plugin 中不保存 API Key 和 Cookie。

### 4.4 外部页面是不可信输入

岗位页面、搜索摘要、招聘公告和表单字段均视为 untrusted external content。

要求：

- 外部文本进入模型上下文时使用明确的 untrusted 标签；
- 页面文本不能被当作系统指令；
- 外部文本不能授权 terminal、file、process、MCP 写入或提交操作；
- 定时抓取尽量采用确定性 fetcher 和解析器，不把整页 HTML 交给通用 Agent；
- 网申页面中的隐藏文本、字段描述和脚本内容不能自动改变操作策略；
- 高影响操作必须由 CareerAdapt side-effect policy 再次检查。

## 5. Hermes 能力与确认协议

### 5.1 Toolset 配置

V4-P0 先从当前打包 Hermes 运行时实际生成以下信息：

- Hermes commit/version；
- 所有可用 toolset；
- 每个 toolset 的工具；
- check_fn 依赖；
- 需要的环境变量和外部凭据；
- 是否支持 API server；
- 是否支持插件；
- 是否支持 per-job toolset；
- 是否支持 cron toolset；
- 是否支持 browser CDP；
- 是否支持 user-visible confirmation。

不要仅依赖 Hermes main 的文档或用户提供的旧文件行号。

### 5.2 推荐能力配置

Career Mode：

~~~yaml
platform_toolsets:
  api_server:
    - skills
    - web
    - todo
    - memory
    - careeradapt
~~~

Autonomous Job Search：

~~~yaml
platform_toolsets:
  api_server:
    - skills
    - web
    - browser
    - todo
    - memory
    - delegation
    - cronjob
    - careeradapt
    - careeradapt-crawl
~~~

Power Agent：

~~~yaml
platform_toolsets:
  api_server:
    - skills
    - web
    - browser
    - file
    - terminal
    - todo
    - memory
    - delegation
    - code_execution
    - cronjob
    - careeradapt
    - careeradapt-crawl
~~~

实际名称必须以 V4-P0 的当前 Hermes 能力审计为准。

### 5.3 CareerAdapt 工作流工具

建议新增或整理为以下工作流 facade：

| 工具 | 作用 | 默认确认 |
|---|---|---|
| career.workflow.search_jobs | 按来源和目标运行岗位发现 | 否 |
| career.workflow.get_job_candidates | 查询候选岗位 | 否 |
| career.workflow.capture_current_job | 保存用户当前页面岗位 | 是 |
| career.workflow.preview_job | 解析并展示岗位预览 | 否 |
| career.workflow.request_job_commit | 请求转换为正式岗位 | 是 |
| career.workflow.confirm_job_commit | 执行已确认的岗位提交 | 是 |
| career.workflow.analyze_fit | 执行岗位匹配 | 否 |
| career.workflow.propose_fact_clarification | 生成用户澄清问题 | 否 |
| career.workflow.confirm_fact | 写入用户确认事实 | 是 |
| career.workflow.prepare_application | 生成投递材料准备状态 | 是 |
| career.workflow.assist_application | 执行受控网申辅助 | 每个高影响步骤 |
| career.workflow.record_application | 更新用户确认的投递记录 | 是 |

原子工具：

- career.job.parse；
- career.job.commit；
- application field operations；
- repository mutation。

可以继续注册到 internal surface，但不应成为普通模型默认规划的首选。

### 5.4 待确认操作协议

因为 hermes-api-server 不一定拥有交互式 clarify 工具，CareerAdapt 必须有自己的 pending action 协议。

操作返回：

~~~text
status: pending_confirmation
confirmationId
actionType
preview
affectedRecords
affectedDomain
expiresAt
requiredUserChoice
~~~

用户在 UI 确认后，CareerAdapt 使用 confirmationId 执行一次性操作。confirmationId 必须：

- 与 session、user message、operationId 绑定；
- 一次性消费；
- 有过期时间；
- 不能被另一个 session 重放；
- 确认内容发生变化时失效。

Cron 任务不能伪造用户确认。

---

## 6. 五张 Dexie 表与 Repository 设计

### 6.1 crawlSources

字段至少包括：

~~~text
id
key
displayName
channelType
atsVendor
complianceStatus
mode
automationLevel
permissionBasis
termsUrl
termsReviewedAt
robotsPolicy
dataPolicy
authMode
profileRef
adapterId
adapterVersion
rateLimit
supportsSchedule
supportsDetail
supportsApplicationAssist
retentionPolicy
enabled
lastRunAt
lastErrorCode
~~~

约束：

- key 唯一；
- profileRef 不是任意路径；
- blocked 来源在运行前拒绝；
- review_required 来源不能进入 scheduled；
- 来源政策修改后新建 policy version，不覆盖历史 crawlRun 的政策记录。

### 6.2 jobListings

字段至少包括：

~~~text
id
sourceKey
externalId
canonicalSourceUrl
applyUrl
contentFingerprint
companyTitleFingerprint
listingKind
title
company
location
salaryText
education
experience
publishedAt
applicationDeadline
recruitmentBatch
crawlState
policyStatus
blockedReason
firstSeenAt
lastSeenAt
latestSnapshotId
jobDescriptionId
convertedAt
~~~

jobListings 是外部候选层。jobDescriptionId 为空时不能假设它已经是正式岗位。

### 6.3 jobSnapshots

字段至少包括：

~~~text
id
jobListingId
version
contentHash
rawText
sourceLocator
normalizerVersion
capturedBy
provenance
redactionStatus
contentSize
capturedAt
~~~

索引：

- id；
- jobListingId + contentHash 唯一；
- jobListingId + version 唯一；
- jobListingId + capturedAt；
- contentHash。

version 必须由 Repository 在事务中计算，不能依赖业务层先读后写。

### 6.4 crawlRuns

字段至少包括：

~~~text
id
sourceKey
trigger
autonomyLevel
status
startedAt
finishedAt
listPagesFetched
detailsFetched
itemsDiscovered
itemsNew
itemsChanged
requestsSpent
blockedCount
errorCode
diagnostics
policySnapshot
~~~

diagnostics 需要限制数量、长度和敏感内容。不得保存 Cookie、Authorization、完整页面或个人信息。

### 6.5 applicationDrafts

字段至少包括：

~~~text
id
jobListingId
applicationId
platform
step
fieldPlans
sensitiveFieldsPending
resumeAttachmentRecordId
materialPackId
blockers
handoffUrl
createdAt
updatedAt
~~~

推荐 step：

~~~text
created
login_required
running
awaiting_user_review
ready_for_user_submit
handed_off
user_marked_submitted
abandoned
~~~

禁止把密码、验证码、OTP、身份证、学籍号、银行卡和签名值写入表中。

### 6.6 WorkspaceRepository 方法

新增方法应集中在 WorkspaceRepository：

- createCrawlSource；
- updateCrawlSourcePolicy；
- createCrawlRun；
- finishCrawlRun；
- upsertJobListing；
- appendJobSnapshot；
- markJobListingParsed；
- markJobListingConverted；
- createApplicationAssistDraft；
- updateApplicationAssistStep；
- createPendingConfirmation；
- consumePendingConfirmation。

岗位转换必须使用一个事务完成：

~~~text
validate candidate
→ create or reuse JobAnalysisDraft
→ parse/normalize
→ create or reuse JobDescription
→ create DraftCommit
→ update jobListing.jobDescriptionId
→ write timeline/audit
~~~

如果任一步失败，候选岗位可以保留，但不能产生半完成的正式岗位。

---

## 7. MyCareer 逻辑迁移方案

### 7.1 JD normalize、hash 和去重

可以直接移植为纯逻辑，但必须保持：

- rawText 不被覆盖；
- sourceSpan 能回到原文；
- HTML 实体、换行、软连字符处理可测试；
- normalizerVersion 持久化；
- URL canonicalization 可解释；
- hash 算法版本化。

### 7.2 Overall fit

deriveOverallFit 作为派生摘要，不新增第二个匹配主模型。

输入应来自现有 RequirementMatch 和 Job Optimization 结果。S/A/B/C 如果保留，只作为展示层或派生分类，不取代现有：

- strong；
- partial；
- weak；
- none；
- needs_confirmation。

### 7.3 Hard gate

双语硬门槛词表可以用于提高现有 requirementGraph 的分类质量，但必须映射到现有 hardConstraint 和 requirement ID。

不得另建独立 hard gate 表，也不得只靠正则把岗位直接判定为不可投。

### 7.4 Coverage

MyCareer 的 matched + 0.5 partial 公式可以作为补充指标。现有 weighted coverage、hard gap 和 requirement priority 继续作为正式匹配基础。

所有派生输出必须带算法版本：

~~~text
algorithmId
algorithmVersion
generatedAt
inputJobVersion
inputResumeRevision
~~~

### 7.5 Fact Proposal

岗位匹配发现缺口时，允许生成：

~~~text
proposalType
question
relatedRequirementId
candidateAnswer
userConfirmed
provenance
scope: job_specific | profile_sync_candidate
~~~

只有 userConfirmed 为 true 的内容可以进入岗位分支预览。同步个人资料库必须另有明确操作。

### 7.6 投递状态和跟进

MyCareer 的邻接表和 follow-up cadence 可以移植，但必须映射到当前 ApplicationStatus：

~~~text
discovered
preparing
ready
applied
interviewing
offer
rejected
withdrawn
archived
~~~

不要直接引入 submitted、acknowledged 等新状态。网申辅助状态放在 applicationDrafts，正式投递状态仍由 ApplicationRecord 管理。

---

## 8. 岗位来源与抓取服务

### 8.1 Fetcher 类型

定义统一接口：

~~~text
official_api
public_http
public_ssr
managed_browser
user_capture
manual_only
~~~

每个 adapter 必须声明：

- sourceKey；
- adapterVersion；
- fetcherType；
- supportsList；
- supportsDetail；
- supportsSchedule；
- requiresLogin；
- requiresUserPresent；
- allowedFields；
- policyLevel；
- maxRequestBudget；
- stopConditions。

### 8.2 Orchestrator 流程

~~~text
load source policy
→ validate autonomy and permission
→ create crawlRun
→ plan keywords/cities/companies
→ fetch list
→ normalize list candidates
→ dedupe
→ compare existing fingerprint
→ fetch changed details only
→ redact disallowed data
→ append snapshot
→ upsert listing
→ optionally parse to draft
→ report candidates and blockers
→ finish crawlRun
~~~

### 8.3 限频和停止

限频必须按域名和 source 独立：

- 列表、详情、登录检查分别计数；
- 429、403、challenge 连续出现时指数退避；
- 任何 security check 触发后停止当前来源；
- 不通过增加随机行为来规避检测；
- 不自动重试会造成风控升级的请求；
- 单源日预算可由用户配置；
- 全局预算和模型预算单独统计。

### 8.4 来源优先级

V4-P3 首批来源建议：

1. 一个官方 API；
2. 一个 ATS；
3. 一个官方企业或校园来源；
4. 一个经审核的校园或政府来源。

V4-P4 再加入：

- 用户主动浏览器采集；
- BOSS 等来源的 manual/user_capture 实验路径；
- 企业自有登录招聘系统；
- 其他 ATS adapter。

不要把“腾讯返回多少岗位”“某个选择器命中多少次”“覆盖多少央企”写成永久验收条件。真实来源结构会变化，验收必须依赖 fixture、adapter contract 和非阻塞 live smoke。

### 8.5 ATS 探测

ATS 探测器可以识别：

- Greenhouse；
- Lever；
- SmartRecruiters；
- Workday；
- Eightfold；
- Moka；
- zhiye；
- 飞书 ATS；
- ncss；
- sasac；
- custom。

探测结果只决定 adapter 候选，不代表该来源已经取得自动化权限。

---

## 9. 浏览器、登录态与浏览器扩展

### 9.1 Managed profile

目录逻辑：

~~~text
<electron userData>/browser-profiles/<sourceKey>
~~~

要求：

- 只能由主进程创建和解析；
- sourceKey 到 profileRef 一一映射；
- 同一 profile 只能有一个 active session；
- 启动前加锁；
- 关闭后释放锁；
- 用户可以在设置中清除单个来源 session；
- 清除前显示来源和影响；
- 不把绝对路径写入业务数据；
- 不把 storageState JSON 放入仓库；
- 不把 Cookie 放进 Hermes prompt。

Playwright 的认证状态文件可能包含能够冒用账户的 Cookie 和 headers，任何导出都必须加密、短期使用或避免持久化。优先使用 persistent browser context，不导出 storageState。

### 9.2 Browser extension

扩展是日常浏览器登录态的首选兜底方案：

- 用户主动点击；
- 只读取当前页面的岗位内容；
- 只发送到本机 loopback；
- 使用一次性配对 token；
- 不读取 Cookie；
- 不读取密码；
- 不后台搜索；
- 不自动滚动；
- 不自动投递；
- 页面来源必须匹配允许来源；
- DOM/HTML 大小有限制；
- 发送前显示当前页面域名和岗位标题。

### 9.3 CDP

CDP 只接入：

- CareerAdapt 创建的专用 profile；
- 用户明确启动的非默认 Chrome profile；
- 127.0.0.1 随机端口；
- 具有短期访问令牌的 endpoint。

禁止自动连接默认日常 Chrome User Data Directory。

### 9.4 Patchright

Patchright 仅作为实验驱动：

- 默认关闭；
- 单独 feature flag；
- 只用于经过来源政策审核的来源；
- 不使用 stealth 注入；
- 不使用验证码绕过；
- 不把 webdriver 隐藏作为成功条件；
- 记录版本、浏览器版本和失败原因；
- 独立测试，不影响 Playwright 主路径。

---

## 10. 半自动网申

### 10.1 申请前流程

必须先通过现有 ApplicationReadiness：

- 岗位存在；
- profile 正确；
- job-specific branch 正确；
- revision 存在；
- Fact Guard 没有正式高风险阻断；
- PDF/export 状态满足要求；
- 材料包已经用户确认；
- 来源允许 application assist；
- 当前 session 是用户主动启动或已授权的自治任务。

### 10.2 字段策略

| 字段类别 | 处理 |
|---|---|
| 姓名、教育、项目、技能 | 可准备，预览后填写 |
| 手机、邮箱、地址 | 用户开启后可填，每次会话预览 |
| 求职信、自我介绍、开放问答 | 生成草稿，用户确认后填写 |
| 期望薪资、工作地点、调剂选项 | 每次明确确认 |
| 密码、OTP、验证码 | 永远手动 |
| 身份证、学籍号、银行卡、签名 | 永远手动 |
| 最终提交 | 永远用户点击 |

### 10.3 平台顺序

第一版只实现一个结构稳定且政策清晰的企业 ATS 或企业官网申请表。

优先：

- Greenhouse；
- Lever；
- SmartRecruiters；
- 一个企业自有 ATS。

后续再评估 Moka、zhiye、Workday 等。BOSS/LinkedIn 不是第一版网申自动化目标。

### 10.4 用户交接

handoff 页面必须展示：

- 当前域名；
- 公司和岗位；
- 使用的简历版本；
- 上传文件；
- 已填写字段；
- 未填写字段；
- 需要用户处理的敏感字段；
- 提交按钮所在位置；
- “CareerAdapt 不会替你提交”的说明。

用户点击提交后，由用户在 CareerAdapt 中标记已提交，系统才更新 ApplicationRecord。

## 11. V4 分阶段实施计划

每个 Phase 独立验收，未通过不得进入下一阶段。不要把后续 Phase 的目录、表、依赖提前加入当前提交。

### V4-P0：基线、Hermes 能力与安全审计

目标：不实现用户功能，先把运行时事实确认清楚。

任务：

- 记录 Git 基线和已有修改；
- 读取当前 Hermes 打包版本；
- 生成实际 toolset/tool 清单；
- 验证 API server、MCP、plugin、cron、browser CDP；
- 确认 renderer 不持有 API_SERVER_KEY；
- 确认 Browser Domain Host 生命周期；
- 确认 Dexie 唯一写入路径；
- 评估 playwright 运行时依赖；
- 评估 Patchright 是否暂缓；
- 定义来源政策 Schema；
- 定义 pending confirmation 协议；
- 定义 untrusted external content 标记。

验收：

- typecheck 通过；
- 相关 Hermes contract tests 通过；
- 有一份实际工具能力报告；
- 没有修改无关源码；
- 没有新增 Dexie 表；
- 没有新增默认生产依赖；
- API key 不出 renderer；
- git diff --check 通过。

### V4-P1：纯逻辑资产迁移

目标：迁移 MyCareer 中与模型和 Hermes 无关的纯逻辑。

任务：

- normalizeJd；
- content hash；
- 三级去重；
- overall fit 派生；
- hard gate 映射；
- coverage 派生；
- follow-up cadence；
- application transition projection；
- Markdown 安全转义；
- 简历 patch 结构；
- Fact Proposal 类型和确认流程；
- 证据定位诊断。

验收：

- 所有纯函数有正反边界测试；
- 原文 sourceSpan 保持稳定；
- 现有 Job Optimization 结果没有被替换；
- 现有 Fact Guard 阈值没有改变；
- 未确认事实不能进入预览和 PDF；
- 新增用例只增不减；
- 保留 MIT 来源说明。

### V4-P2：五张表、Repository 与候选岗位管道

目标：建立外部候选岗位的本地持久化层。

任务：

- 增加一次 Dexie version migration；
- 增加五张表；
- 增加 Schema；
- 增加 Repository；
- 实现 upsert 和双唯一；
- 实现 crawlRun 状态恢复；
- 实现 snapshot version；
- 实现 candidate 到 JobAnalysisDraft 的转换；
- 接入现有 DraftCommit；
- 编写 candidate → formal job 的确认流程。

验收：

- Schema 正反例完整；
- 重复抓取幂等；
- 同内容不产生重复版本；
- 事务失败无半提交；
- 重启后运行记录可恢复；
- 所有写入都经过 Repository；
- 服务器不能直接操作浏览器 IndexedDB；
- 无真实网站依赖。

### V4-P3：官方 API、ATS 和公开来源

目标：完成第一条可定时运行的公开来源链路。

任务：

- 实现 official_api fetcher；
- 实现 public_http/public_ssr fetcher；
- 接入一个官方 API；
- 接入一个 ATS；
- 接入一个官方企业或校园来源；
- 实现来源政策评估；
- 实现增量抓取；
- 实现分域名限频；
- 实现源页面和详情页面 fixture；
- 实现 live smoke，但设为非阻塞。

验收：

- 三类来源 fixture 通过；
- 真实 smoke 不高频、不批量；
- 429/403/challenge 能停止；
- 来源 URL 始终保留；
- 采集数据不包含 HR/求职者个人信息；
- 只有 scheduled 来源可以被 cron 使用；
- 候选岗位能进入本地列表；
- 正式 JobDescription 仍需要确认。

### V4-P4：Managed Browser、Extension 与用户接管

目标：支持需要登录或动态渲染的来源，但不做反检测平台工程。

任务：

- source profile manager；
- profile lock；
- 登录检测；
- headed browser；
- 用户 QR/手动登录；
- extension capture；
- 专用 CDP；
- challenge detector；
- user handoff；
- profile 清理和 revoke；
- 失败恢复。

验收：

- 一个本地 fixture 登录站点能完成登录态复用；
- 两个并发任务不能抢同一 profile；
- extension 只能在用户点击后采集；
- CDP 只绑定 loopback；
- 默认 Chrome profile 不被接管；
- challenge 后能安全停止；
- Cookie 不进入日志和模型上下文。

### V4-P5：Hermes 高自治和定时任务

目标：让 Hermes 能自主编排岗位发现，同时把正式业务副作用留在确认协议中。

任务：

- careeradapt-crawl plugin；
- loopback API；
- toolset profiles；
- Hermes capability UI；
- cron CRUD；
- cron pause/resume/run；
- 每个 cron 绑定来源、预算和 autonomy level；
- 每次运行创建 crawlRun；
- 自动保存候选岗位；
- 生成每日摘要；
- pending confirmation 卡片；
- 用户确认后提交正式岗位；
- plugin health check；
- 禁止 npx 自动拉包；
- Prompt Injection 防护。

验收：

- Career Mode、Autonomous、Power 三种配置可切换；
- 当前工具列表可见；
- Hermes 能创建并触发每日任务；
- 定时任务能保存候选岗位；
- 定时任务不能伪造用户确认；
- confirmationId 不能重放；
- plugin 未启动时不暴露假工具；
- API key 不暴露给 renderer；
- 全部配置可恢复。

### V4-P6：匹配、简历分支和材料包整合

目标：把候选岗位接入现有求职主流程。

任务：

- 候选岗位转 JobDescription；
- 调用 Job Optimization；
- 派生 fit 和 coverage；
- 生成岗位分析；
- 连接现有 Resume Branch；
- 生成简历 patch；
- 生成材料包；
- 接入 ApplicationReadiness；
- Fact Proposal 用户澄清；
- follow-up next action；
- 用户确认后创建 ApplicationRecord。

验收：

- canonical JobDescription 只有一套；
- JobDescription 与 jobListing 可追踪；
- 简历分支、revision、export 正确绑定；
- 未确认事实被阻断；
- 用户确认事实不会隐式污染通用资料库；
- Application readiness 可解释；
- 派生算法带版本。

### V4-P7：一个 ATS 的半自动网申

目标：完成一个用户可见、可暂停、可交接的网申辅助闭环。

任务：

- 选择一个 ATS；
- 生成表单 fixture；
- 表单字段分类；
- 选定 ResumeRevision；
- 选定 material pack；
- 普通字段预览；
- 联系方式开关；
- 普通字段填写；
- 简历上传；
- 敏感字段 handoff；
- 用户提交后记录；
- Application timeline 写入。

验收：

- 所有敏感字段永远不由程序填写；
- 最后一步必然 handoff；
- 没有自动 submit；
- 上传材料来自用户选定的 ExportRecord；
- 应用会话可暂停恢复；
- fixture 和定向 E2E 通过；
- 真实平台测试只由用户手工触发，不进入 CI。

### V4-P8：模拟面试

目标：复用 MyCareer 面试逻辑，建立 CareerAdapt 面试中心。

任务：

- 新增四张面试表；
- 六节点状态机；
- 题目预写；
- 每题追问上限；
- 评分延后并行；
- 公司风格库；
- 面试报告；
- 与 ApplicationRecord 关联；
- 支持中断和恢复。

本阶段不得反向改变岗位、简历和投递主数据语义。

---

## 12. 测试与验收策略

### 12.1 单元测试

覆盖：

- JD normalize；
- hash；
- URL canonicalization；
- 多级去重；
- coverage；
- fit；
- hard gate；
- follow-up；
- 状态机；
- Fact Proposal；
- confirmationId；
- source policy；
- sensitive field blocking；
- profile lock；
- rate limiter；
- challenge stop；
- SSRF guard；
- prompt injection boundary。

### 12.2 Schema 和 Repository

覆盖：

- 五张表正反解析；
- 索引和唯一键；
- Dexie migration；
- upsert 幂等；
- snapshot version；
- transaction rollback；
- candidate 到 formal job；
- application assist state；
- confirmation 一次性消费。

### 12.3 集成测试

使用本地 fixture：

~~~text
fixture source
→ fetcher
→ normalize
→ dedupe
→ snapshot
→ jobListing
→ JobAnalysisDraft
→ user confirmation
→ JobDescription
~~~

不得在 CI 中高频访问真实招聘网站。

### 12.4 Hermes 测试

覆盖：

- MCP tool name mapping；
- production/autonomous/internal surface；
- toolset audit；
- plugin health；
- cron create/run/pause；
- pending confirmation；
- API key 不出 renderer；
- untrusted page 不可调用本地副作用工具；
- Power Agent 明确开启后能力完整可见。

### 12.5 Electron 测试

涉及生产依赖、Hermes runtime、Browser Host 或 standalone 时运行：

- pnpm typecheck；
- changed-files ESLint；
- 相关 Vitest；
- pnpm build；
- pnpm electron:build:dir；
- 免安装目录启动；
- userData 保留；
- profile 和 Dexie migration 验证；
- git diff --check。

没有完整退出码时，不得宣称通过。

---

## 13. 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| 来源平台政策变化 | 高 | source policy version、manual_only、blocked、人工复核 |
| BOSS/LinkedIn 自动化限制 | 高 | 不做默认 scheduled adapter，采用用户主动采集或手动来源 |
| 反爬和账号风控 | 高 | 低频、增量、停止条件、用户接管，不做绕过 |
| Prompt Injection | 高 | 外部内容标记、确定性解析、side-effect policy、工具隔离 |
| 浏览器 profile 冲突 | 高 | source 专属 profile、锁、单实例 |
| Cookie 泄露 | 高 | 不导出、不进 prompt、不进日志、主进程管理 |
| Hermes 版本漂移 | 高 | 固定 commit、能力审计、bundle check |
| Electron standalone 缺少运行时依赖 | 高 | 直接 runtime dependency、standalone 构建和启动验收 |
| IndexedDB 写入者分裂 | 高 | Browser Domain Host + WorkspaceRepository 唯一写入 |
| 定时任务无人值守 | 中 | 每源预算、暂停、失败状态、候选层自动写入、正式岗位确认 |
| 新事实误写入简历 | 高 | Fact Proposal、用户确认、provenance、分支隔离 |
| 多平台重复岗位 | 中 | 多级 fingerprint、canonical URL、人工合并 |
| ATS 表单改版 | 高 | adapterVersion、fixture、selector_miss、user handoff |
| 网申误提交 | 高 | 技术上不提供 submit capability，状态只能 handoff/user_marked_submitted |
| Doubao 会员与 API 不一致 | 中 | 只支持官方 Ark API 配置，不模拟消费端登录 |
| Patchright 维护和兼容性 | 中 | 默认关闭，独立 spike，不作为主链路 |

---

## 14. 开发 AI 的执行纪律

1. 先完成 V4-P0，不得直接开始多平台抓取。
2. 每个 Phase 只修改本 Phase 必需文件。
3. 不使用文件行号作为唯一依据。
4. 不重写当前 WorkspaceRepository 语义来绕过确认。
5. 不把候选岗位直接写成正式 JobDescription。
6. 不把岗位 JD 证据塞进用户事实证据。
7. 不用“更智能的模型”替代 Schema、Repository、Confirmation 和 Fact Guard。
8. 不因为真实站点不稳定而增加 stealth、验证码绕过、代理池或 IP 轮换。
9. 不在测试中使用真实账号、真实密码、真实验证码或真实网申提交。
10. 不把 API Key、Cookie、用户 profile 原始路径或敏感字段写入日志。
11. 发现需要新增生产依赖时，先提交必要性、版本兼容性和打包影响报告。
12. 发现需要新增 Dexie 表时，先停止当前实现并确认是否属于已批准表清单。
13. 发现现有架构与本计划冲突时，先报告冲突，不通过复制第二套数据模型绕开。
14. 同一长测试连续两次超时后停止重跑并记录。
15. 只修复当前 Phase 引入的问题，不顺便修复无关历史技术债。

每个 Phase 的交付报告必须包含：

- 修改文件；
- 数据语义变化；
- 工具面变化；
- 新增依赖；
- 测试命令和完整退出码；
- 未完成项；
- 风险；
- 下一 Phase 的前置条件。

---

## 15. 与旧版 V4 计划相比的核心修订

保留：

- 岗位聚合目标；
- 五张采集/网申辅助表；
- Hermes plugin；
- Cron；
- 多来源 adapter；
- 低频、增量、可恢复抓取；
- 半自动网申；
- MyCareer 纯逻辑；
- 面试后置。

调整：

- 原子 parse/commit 不直接成为普通模型主入口；
- Hermes 完整能力改为 Career、Autonomous、Power 三档；
- Next 不直接写 Dexie；
- 候选岗位和正式 JobDescription 分离；
- Fact Guard 不通过 JD 证据放宽，而通过用户确认事实扩展；
- BOSS/LinkedIn 等平台默认改为 manual/user_capture；
- Patchright 改为实验性依赖；
- 删除 stealth 注入和 webdriver 隐藏验收；
- applicationDraft 不保存敏感字段值；
- submitted 改为 handoff/user_marked_submitted；
- cron 默认只自动产生候选岗位和报告；
- 真实平台 smoke 不作为 CI 和 Phase 通过的唯一条件；
- 新增 Prompt Injection、profile、Cookie、Hermes 版本和 Domain Host 风险。

---

## 16. 参考资料

- MyCareer：https://github.com/low-hands/MyCareer
- Hermes Toolsets：https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/toolsets-reference.md
- Hermes Browser：https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/browser.md
- Chrome Remote Debugging：https://developer.chrome.com/blog/remote-debugging-port
- Playwright BrowserType：https://playwright.dev/docs/api/class-browsertype
- Playwright Authentication：https://playwright.dev/docs/auth
- BOSS 用户协议：https://www.zhipin.com/web/common/protocol/protocol-2019-09-30.html
- LinkedIn Prohibited Software：https://www.linkedin.com/help/linkedin/answer/a1341387/prohibited-software-and-extensions
- 网络数据安全管理条例：https://xzfg.moj.gov.cn/front/law/detail?LawID=1734
- 网络反不正当竞争暂行规定：https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2024/art_80019fe59e464196bef173dc56678a42.html
- Greenhouse Job Board API：https://docs.greenhouse.io/job-board.html
- Lever Postings API：https://github.com/lever/postings-api
- SmartRecruiters Posting API：https://developers.smartrecruiters.com/docs/endpoints
- 火山方舟 API Key：https://docs.volcengine.com/docs/ark/api-key?lang=zh

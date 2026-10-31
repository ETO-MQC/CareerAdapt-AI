# AMD Qwen Reasoning Timeout Root-Cause Fix — 2026-10-31

最终裁决：**AMD_QWEN_LOW_REASONING_STILL_BLOCKED**。唯一真实请求HTTP200/72.464秒，finish_reason=length，2048 tokens全部用于reasoning、content为空；失败分类 **QUALITY_OUTPUT_BUDGET_EXHAUSTED**，本次不是TimeoutError。SQ1仍为 **SQ1 QUALITY COLLECTION BLOCKED**，不宣告SQ1 COMPLETE。

## 基线与本轮范围

git fetch origin退出0；branch=main，Starting HEAD与origin/main均为 7d5e9f44c73066ed94320095856fdac3627ec987。开始时两项tracked修改（.env.example与evaluator，76 insertions/9 deletions）及全部未提交SQ1 scripts/evidence保留；无reset/checkout/clean或批量删除。当前diff已检查并留在.tmp/amd-reasoning-final.patch，最终文件/哈希见evidence。

本轮修复evaluation generation policy、managed Hermes reasoning config、锁定Hermes custom-provider wire和自有structured Provider。六个Skill、Fact Guard、Writer/Reviewer/Clarification policy及原fixture均未修改；未提交、推送、打包。

## 十项问题的回答

1. **为什么before 86s、after >120s？** 原请求没有reasoning_effort/max_tokens，落入AMD默认xhigh且无客户端显式输出上限；after从4532字符增至6960字符，新增Claim Safety v2的原子声明、来源/成熟度/确认范围和Fit Summary v2的澄清价值/多类匹配状态。复杂约束叠加最长思考档是有协议依据的原因方向；历史超时没有headers或reasoning计数，不能把全部时间认定为纯模型思考，也不能推断为网络、限流、context overflow或Skill质量失败。本次已显式low仍未达成功门禁，因此缺参问题已修、但它不是已证实的唯一延迟根因。
2. **实际默认档位？** AMD Radeon官方文档确认省略为xhigh，可用low/medium/xhigh，thinking与visible answer共享max_tokens；reasoning正文在message.reasoning。来源：[AMD Radeon Qwen3.8-27B](https://amd-aim.github.io/radeon-cloud-docs/models/qwen3-8-27b/)，2026-10-31核对。仅使用公开文档，不消耗Provider推理额度。
3. **原evaluator发什么、漏什么？** model/messages/temperature=0；遗漏reasoning_effort和max_tokens。120秒预算未改变。
4. **after增加什么复杂度？** 上述新增2430附近字节的Claim Safety/Fit Summary约束；Skill正文4532→6972 bytes，具体SHA与文本长度见evidence。没有为帮助测试通过而修改Skill。
5. **最终eval body是否low？** 是。集中resolveQualityGenerationPolicy按AMD hostname+精确模型返回low/2048/temp0，两臂一致；唯一真实请求journal记录reasoning_effort=low、max_tokens=2048、temperature=0，request size=7601 bytes。reasoning仅保存boolean/长度与usage计数，评分只读content。length或空content且预算耗尽记录QUALITY_OUTPUT_BUDGET_EXHAUSTED并停止，不自动增加到4096。
6. **Hermes production wire是否low？** 是，离线实际SDK→本地HTTP捕获证明。unpatched时managed YAML/原生resolver已是low，wire却无该字段；patched后AMD Qwen顶层low/medium/xhigh分别正确，不发送extra_body.reasoning替代。非AMD同名模型、AMD其他模型不注入Qwen字段；none/high快速失败。该证据覆盖managed-config→锁定Hermes transport→SDK→loopback，不冒充本轮真实自然语言Hermes sentinel。
7. **是否修改生产max_tokens？** 没有。离线capture的既有生产上限7777仍为7777；2048仅属于SQ1评测/本次probe。未改Runtime timeout、调用次数或多轮Agent output ceiling。
8. **唯一真实after结果？** AMD_QWEN_LOW_REASONING_STILL_BLOCKED；requestsAttempted=1，HTTP=200，finish_reason=length，headers=72461.5999ms，body end=72463.4166ms，总计=72463.5656ms，reasoningChars=8554，contentChars=0，usage={"prompt_tokens":1586,"completion_tokens":2048,"completion_tokens_details":{"reasoning_tokens":2048}}。只有一条真实请求；详情含实际content（如有）见[probe证据](./amd-qwen-low-reasoning-after-probe-20261031.json)，无reasoning正文。
9. **是否继续消耗额度？** 没有。未重发before；未跑59arm、未第二次真实probe。probe输出文件独占创建，跨进程再次执行会在请求前拒绝，保留请求journal和错误证据。
10. **SQ1能否安全resume？** 同一generation policy的批次可续跑，成功arm跳过，失败不自动重试。旧86.451s before属于默认档位，不能与low after合成正式A/B；本轮保留它但只做单after transport验证。CLI已测试拒绝旧批次的参数漂移且不发请求、不改证据。额度恢复后需用户明确开启双方均low/2048的新policy cohort，再在该批次--resume；本轮没有补跑before，也不伪造已完成pair。

## 生产修复与锁定

- electron/providerGenerationPolicy.js集中识别AMD Qwen；managed config使用agent.reasoning_overrides而非全局强制low，语义merge保留其他agent字段、其他模型和已有显式override。
- OpenAiCompatibleProvider对AMD Qwen的invoke、streamText和工具请求使用顶层low；resume-document-mapper经structured route落入此分支。其他自部署Qwen的显式提取继续使用chat_template_kwargs.enable_thinking=false；其他Provider保持原协议。
- 新Hermes补丁只在hostname=developer.amd.com.cn且model=Qwen3.8-27B时，把已解析reasoning_config映射到顶层reasoning_effort，正常/profile/summary路径共用helper，不改max_tokens。
- prepare flow应用源补丁，runtime-manifest记录两份Python补丁SHA，bundle-check核验SHA及marker。锁定仍为Hermes 0.19.0 @ eb52760564dbba2e5971fa54bd67384e281cd3b8，CareerAdapt patch升级为careeradapt-api-toolsets-selection-amd-reasoning-v3；未改上游checkout或升级依赖。已重新prepare本地bundle，release/已有安装包未重打。

## 验证与限制

修改前typecheck及3文件11项通过。最终7文件70项Unit/Integration、9项Node脚本测试、unpatched1条/patched5条SDK本地wire、prepare、bundle-check、build、typecheck、changed-files lint、diff check均退出0。预算耗尽、reasoning不落盘、两臂同参数/他Provider不注入、成功before跳过与旧policy混跑拒绝均有离线回归。

实际bundled Runtime模型读回与下一Run切换回归PASS，两次readback约5.81/4.83ms、无restart；模拟Provider两条请求。Supervisor Unit覆盖active Run与rollback。受控cleanup childExitCode=1原样保留，不宣称graceful shutdown通过；未重跑无关全量UI/历史门禁。

初次offline launcher调用非导出helper失败，无Provider请求；改显式bundle路径后通过，过程失败未删除。Next生成的next-env.d.ts仅恢复本轮开始时干净的HEAD内容，不覆盖用户修改。

交付：[结构化报告](./amd-qwen-reasoning-timeout-fix-20261031-evidence.json)、[补丁前wire](./amd-qwen-reasoning-unpatched-wire-20261031.json)、[补丁后wire](./amd-qwen-reasoning-patched-wire-20261031.json)。历史1/60arm、0/30pair及其失败证据hash保持不变。没有真实Hermes sentinel或主观质量认证结论。

本轮停止。low请求的2048预算已全部被思考用尽；按用户要求不自动增加。后续若需要调整评测token预算，必须另行授权并对两臂使用同一新policy；streaming或其他延迟诊断也须单独选择。不进入P518-B/P519/SQ2，不发送更多真实请求。

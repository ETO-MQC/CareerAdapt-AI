# AMD Qwen 最后一次长超时验证 — 2026-10-31

最终状态：**FINAL_LONG_TIMEOUT_PROBE_PASSED**。

用户明确授权最后一次将超时延至5–8分钟。本轮选择 **8分钟 / 480000ms**，保持此前相同原始after案例、AMD / Qwen3.8-27B、reasoning_effort=low、temperature=0、max_tokens=16384。只发 **1次** 真实请求，结束后停止。

| 项目 | 实际结果 |
| --- | --- |
| 案例 | jd_understanding-01 / after |
| 请求大小 | 7602 bytes |
| HTTP | 200 |
| 耗时 | 299.984秒 |
| headers elapsed | 299961.93679999997ms |
| body end elapsed | 299984.1814ms |
| finish_reason | stop |
| content字符 | 3261 |
| reasoning字符 | 16228 |
| usage | {"prompt_tokens":1586,"completion_tokens":5104,"completion_tokens_details":{"reasoning_tokens":3758}} |
| 错误分类 | 无 |

本次已取得HTTP200、非空content和finish_reason=stop，满足延长等待后的完整响应条件。实际可评分答案保存在原始probe的results[].anonymizedResult；没有保存reasoning正文。

证据：[本次请求原始记录](./amd-qwen-low-reasoning-after-probe-16384-480000ms-20261031.json)、[结构化报告](./amd-qwen-final-long-timeout-20261031-evidence.json)。没有覆盖此前2048、8192、16384/120秒记录。

实现仅为evaluation/probe增加显式timeout override和独立480000ms证据文件。默认评测仍120秒，生产timeout/max_tokens及Hermes补丁不变；六个Skills和fixture未改。独占创建输出文件保证本命令重复执行会在请求前拒绝。

11项Node脚本测试、typecheck、changed-files lint、diff检查、六个Skill双臂SHA校验通过。离线测试确认AbortSignal使用480000ms、记录相同deadline，默认仍120000ms，超出授权范围拒绝。未重复build/无关回归，未提交推送打包。

SQ1仍为 **SQ1 QUALITY COLLECTION BLOCKED**。本次只是after传输验证，不是同policy完整A/B，不是实际Hermes sentinel或主观质量认证；未重发before，也未跑其他arms。plan4/history4已同步，用户再决定后续办法，本轮停止。

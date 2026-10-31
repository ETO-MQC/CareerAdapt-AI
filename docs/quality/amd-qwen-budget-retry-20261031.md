# AMD Qwen after 预算重试 — 2026-10-31

结果：**AFTER_PROBE_STILL_BLOCKED**。用户授权先8192，失败后仅再试16384；本轮实际请求 **2次**，两档均未达到成功条件，已停止。

固定原jd_understanding-01 after、AMD/Qwen3.8-27B、reasoning_effort=low、temperature=0、120秒超时。六个Skill SHA与原fixture保持。密钥从合法本地服务端环境读取；无reasoning正文落盘，只有长度/token计数。

| max_tokens | 结果 | HTTP | 完整耗时 | finish_reason | completion / reasoning tokens | content字符 |
| ---: | --- | --- | ---: | --- | --- | ---: |
| 8192 | TIMEOUT | 未获headers | 120.003s | null | null / null | null |
| 16384 | TIMEOUT | 未获headers | 120.004s | null | null / null | null |

实际参数、request size、timestamps、headers/body timing、usage与错误分类见[结构化报告](./amd-qwen-budget-retry-20261031-evidence.json)。[8192原始证据](./amd-qwen-low-reasoning-after-probe-8192-20261031.json)、[16384原始证据](./amd-qwen-low-reasoning-after-probe-16384-20261031.json)。未取得成功完整答案，不能将本轮结果当作Skill质量失败；没有第三次调用或继续提高预算。

仅为本轮probe新增显式预算override（允许2048/8192/16384）和独立、独占创建的证据文件。原2048默认、生产max_tokens、Hermes补丁、模型档位与timeout未改变。未覆盖历史2048、8192/16384或原A/B结果。

验证：10项Node脚本测试（含两档实际body/metadata一致与默认不变）、typecheck、changed-files lint、diff检查及6个Skill双臂SHA校验退出0。未重复build或无关回归，未提交/推送/打包。

SQ1仍为 **SQ1 QUALITY COLLECTION BLOCKED**。旧默认档位before与新low/更大预算after不属于同一policy，不能合并成已认证pair；未重发before、未跑剩余59arms。plan4/history4已同步。本轮按授权重试范围停止。

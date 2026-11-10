# Hermes Provider 开发与打包统一修复（2026-11-10）

## 1. Git 基线与范围

基线 `4bf3e40`，分支 `competition/5.1.8`。保留此前 UX、对话入口移除及用户 `next.config.ts` 的未提交修改。本轮仅修 Runtime 选择、Provider/readiness 投影、探测调度及 standalone 打包兼容；未改变 Repository、Schema、确认/CAS、业务工具契约，没有新生产依赖。尚未提交或推送。

## 2. 真实根因与设计原则

详见同目录 `hermes-provider-chain-audit-20261110.md`。缺少默认项目 bundle 时，开发端静默使用了同版本但缺少 CareerAdapt toolsets 补丁的外部 Hermes。Provider `/models` 的 429 又被当作配置无效；每轮健康检查反复探测，放大等待。工具发现最长 60 秒，与 Supervisor 12 秒健康等待冲突；active 只在完整核验后提交，失败时面板因此显示未确认。

用户 Next 父级 root 解决 Junction 越界，保留。其导致 standalone 应用嵌套且保留开发 Junction，原打包脚本未适配，这是独立的打包问题。没有证据支持本次故障由 custom_providers dict、配置未落盘或 free_tier_bootstrap 引起。

## 3. 实际修改文件

- Runtime：`electron/hermesBundleIdentity.js`、`electron/hermesCompanion.js`、`electron/hermesSupervisor.js`、`electron/main.js`。
- 启动/构建：`scripts/ensure-hermes-runtime.mjs`、`scripts/dev-with-hermes.mjs`、`scripts/prepare-hermes-runtime.mjs`、`scripts/prepare-electron-standalone.mjs`、`package.json`。
- 健康与诊断：`src/app/api/agent/runtime/hermes/health/route.ts`、`src/agent/runtime/runtimeHealth.ts`、`src/server/agent/webHermesSupervisor.ts`、`src/services/agent/hermesControl.ts`、`src/app/settings/page.tsx`。
- 验证：`scripts/verify-hermes-provider-fix.mjs`；新增 `hermesBundleIdentity`、`hermesProviderReadiness`、`hermesStandalonePackaging` Unit，扩充 `hermesSupervisor` Unit，隔离 `p511-r2-observability` 的模块缓存 fixture。

`next.config.ts` 是用户已有修改；本轮没有回滚或改写。`next-env.d.ts` 的构建生成差异已由开发启动恢复。

## 4. 状态机与映射

开发首次缺少 bundle 时准备锁定版本，存在但不匹配时明确失败，不覆盖或退回外部运行时。Web/Electron 都校验锁与关键补丁哈希，安装包携带锁。

保留 staged → saving → restarting/verifying → applied 的原业务语义。401/403 为鉴权错误；429、5xx、网络失败进入独立 degraded 原因，不当作“未配置”，不继续工具同步轮询。仅完整核验才 READY/commit active；desired 尚未成功应用时界面明确说明。必需 Facade 分母取权威目录，当前为 10。

工具发现按地址、generation、控制凭证摘要隔离并合并在途请求。健康投影最多等待发现结果 250ms，pending 时返回空目录/非 READY；发现本身仍有超时和重试边界，旧代结果不能覆盖新代。Provider 按配置 HMAC 指纹及 generation 缓存，成功 30s、429 60s、其他失败 5s，最多 8 个配置身份；改 Key/模型/generation 立即失效。健康检查不是无副作用的纯本地检查，可能请求 `/models`。

## 5. 用户文案

缺少/损坏 bundle 提示运行时准备或校验失败；429 提示服务限流；5xx 提示模型服务暂时异常；网络失败提示检查服务连接；401/403 保留凭证无效。目标配置已收到但未应用时，不再暗示用户从未填写配置。开发调试信息仍可查看。

## 6. 工程与浏览器验证

证据目录：`docs/quality/hermes-provider-fix-20261110/`。

- `pnpm typecheck`、19 个修改 JS/TS 文件 ESLint、`git diff --check`：退出 0。
- 七个定向 Unit 文件：78/78，串行运行，16.11s，退出 0；覆盖缓存/鉴权/429/5xx/清 Key、慢目录、代际竞态、bundle 身份和循环 pnpm/嵌套 standalone。
- `pnpm hermes:bundle-check`：退出 0；锁定 0.19.0、项目补丁，默认 bundle 已准备。
- `pnpm build`：最终退出 0，见 `build-final.log`。保留原 PDF worker external 警告。
- 真实 bundled Hermes + 本地 Scripted OpenAI Provider：Web `web-1794283391393/summary.json` PASS；实际设置、READY 10/10、真实 `career.job.list`、下一轮使用新模型。不是 Runs/SSE mock，也不调用用户真实模型。
- 真实 `app.isPackaged` EXE：`packaged-1794284879549/summary.json` PASS；首次配置、真实工具、模型切换、关闭/重启、Windows safeStorage 恢复及重启请求全部验证。凭证不在 localStorage 或明文凭证文件；主进程恢复来源 `secure_store`，Renderer 重新应用后的投影可以是 `managed_config`，验收直接核对主进程来源与真实请求，而非要求投影标签固定。
- Electron 43.2.0 目录构建退出 0；官方下载超时后使用本机同版本 Electron distribution。最终可用目录 `release/provider-fix-20261110-verified/win-unpacked/`，其中 `职适AI.exe` 已真实启动。

保留失败证据：首轮 Web 暴露发现超时并已修；首轮 packaged 冷启动超过临时 60s 用例等待，随后沿用仓库既有 R1 90s 等待并完成请求；第二轮实际恢复 READY，但测试错误要求 secure_store 投影标签，改为更直接的主进程来源/请求校验后完整通过。不是两次相同超时后无限重跑。首次 Unit 资源争用/冷导入超时，导入移到 fixture setup 后原断言和 timeout 保留。

既有 `p511-r2-observability` 26 过、1 败：SSE 首事件期望 reject，实际先返回 progress。生产零修改审计阶段已复现，不属于本轮引入，不降低或删除断言，不宣称全量通过。

## 7. 已知限制与当前机器状态

隔离测试证明应用与 Runtime 链路，不保证外部真实 Provider 配额、网络或 API 兼容性；实际写入业务没有扩大验收。模型切换可能走已有 YAML 受控恢复/备份及重启路径，本次有验证，不承诺所有情况均热切换。

本轮没有生成 NSIS 安装包；交付已验证的完整免安装目录，不能只复制 EXE。没有签名，Windows SmartScreen 可能提示未知发布者。旧 offline 候选不是最终交付；部分复制目录仅移动归档，没有批量删除。

操作事故：确认用户服务无 active agents/runs/completions/delegations 后重启，临时启动脚本遗漏大小写不同的 Windows 系统环境变量，Node CSPRNG 初始化失败，导致原 Web 进程仅存于内存的用户 Key 丢失。已向用户说明并恢复正常启动，3000 的 Next/MCP/控制端点响应正常，等待 Renderer READY 和用户重新输入一次 Key。没有把 Key 写入临时文件、仓库或日志；用户数据未删除。不能宣称用户真实 Provider 已重新 READY。该事故是临时操作脚本错误，产品正常启动入口及打包持久化闭环已通过。

## 8. 下一步建议

可继续使用修复后的开发入口 `pnpm dev` 和 Electron 构建入口；当前浏览器重新填写 Key 后应用配置。暂不自动进入其他阶段、UX 收尾或全量发布门禁。需要分发安装器时再按正式 `pnpm electron:build` 生成并验证 NSIS。

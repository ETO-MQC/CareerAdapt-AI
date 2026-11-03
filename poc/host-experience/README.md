# P5.2.2 CareerAdapt Host Experience

隔离、完全合成、只读 Profile 切片。默认插件只有公开 route/sidebar 两项贡献。原 P5.2.1 原型和 B2-B2 文件不变，不连接正式 Repository、用户数据库、Provider、预览或 PDF。

```powershell
node scripts/p522-host-experience-build.mjs
node scripts/p522-host-experience-smoke.mjs
```

前提：已有锁定 Hermes checkout（eb527605），Desktop main/preload 已构建，原 Host Vite 在 `127.0.0.1:5174`。默认从 `%LOCALAPPDATA%/hermes/hermes-agent` 查找；可用 `HERMES_SOURCE_DIR` 指向相同版本的现有 checkout。不安装或升级任何依赖。smoke 创建时间戳隔离 home/userData/插件目录，不安装到用户真实环境；实际加载单 ESM，Host 版本为 Desktop 0.17.0、Runtime 0.19.0、Electron 40.10.2。

Host 侧栏 CareerAdapt → 个人资料库。分类搜索、七板块、五种合成响应、刷新和规范弹窗可交互。Jobs、Applications、Resume Studio 明确未接业务。明暗/System 继续通过 Host 自身设置切换。

`pane-probe.tsx` 是另一个可选测试插件，**默认不安装**。`p522-pane-probe-build.mjs` 单独构建；旧 smoke 两次超时，当前保留为失败诊断复现材料，不应直接反复重跑。没有可见并排/拖动/折叠恢复的通过证据。不要把它当作正式 Artifact 实现。

验证：`pnpm typecheck`，`pnpm exec vitest run tests/unit/p522-host-experience.test.tsx tests/unit/p520b2b2-profile-packaging.test.tsx tests/unit/p520a-profile-plugin.test.tsx`。报告及全部截图索引见 `docs/architecture/p5.2.2-hermes-host-integration-vertical-slice-20261103.md`。整体 PARTIAL；本目录不是生产迁移批准。

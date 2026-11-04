# CareerAdapt Host A-01 隔离开发入口

main主线方案A。复用锁定Hermes Desktop，保留原生Chat/Runtime；本目录不是Conversation组件库。只读合成Profile仍在原`poc/host-experience/`。

先运行：

```powershell
node scripts/p522-host-a01-renderer.mjs --careeradapt
```

它在127.0.0.1:5186启动真实Hermes Renderer开发服务器，对4个Renderer模块应用精确锚点组合补丁。启动真正Electron并运行最终有界诊断：

```powershell
node scripts/p522-host-a01-navigation-diagnostic.mjs
```

诊断使用全新的`.artifacts/p522-host-a01-diagnostic-*` home/userData，复制已有合成Profile插件，过滤凭据环境变量，配置127.0.0.1:9的离线测试Provider；不提交消息、不连接真实职业库，运行后关闭Electron。需要现有本机锁定Hermes源码、Desktop已有node_modules/dist与`.artifacts/p522-host-experience/production-like/plugin.js`；本轮复用了这些既有产物，没有安装依赖。不能用独立浏览器访问代替Electron验收。

独立Renderer构建：

```powershell
node scripts/p522-host-a01-renderer.mjs --careeradapt --build
node scripts/p522-host-a01-native-typecheck.mjs
```

产物仅在`.artifacts/p522-host-a01-renderer`，不改Hermes默认dist或原CareerAdapt release。源码上游磁盘不变，补丁快照为证据`.txt`，虚拟编译读取实际补丁，不放宽tsconfig。dev字体middleware仅提供两个已知锁定字体，修复此开发环境字体请求返回HTML的问题；生产构建沿Vite静态资产处理。

默认Shell回退入口：

```powershell
node scripts/p522-host-a01-renderer.mjs --port=5187
node scripts/p522-host-a01-fallback.mjs
```

不带`--careeradapt`不会应用Shell补丁。**本轮默认Shell强化交互检查两次超时已停；脚本选择器修正尚未复跑，不宣称该交互门禁通过。** 原生默认Shell可见截图来自失败运行，不能代替完整交互PASS。

`scripts/p522-host-a01-smoke.mjs`是保留原始失败的完整smoke runner，其中旧状态文字定位已知不适用于分离span，不是推荐通过入口；连续两次超时后不再重跑。最终诊断是另一份10秒有界、基于已核对native可访问角色的测试，结果不能抹去旧失败。

完整交付/20项回答：[集成报告](../../docs/architecture/p5.2.2-host-a01-hermes-native-shell-integration.md)。本轮不进入A02，不提交推送、不打包，不开放职业写工具。

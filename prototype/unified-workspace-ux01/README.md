# P5.2.2-UX-01 独立评审原型

运行于 `main`，不接生产数据和 Hermes Chat。所有消息、资料、岗位、申请、版本均为合成；按钮上标记未接入的操作只展示操作位置。

```powershell
node prototype/unified-workspace-ux01/build.mjs
node prototype/unified-workspace-ux01/serve.mjs
# 另一个终端
node prototype/unified-workspace-ux01/verify.mjs
```

打开 http://127.0.0.1:5183 。已有本机依赖，不安装新包。使用已有 ProductButton/Input/Select/Surface/Badge、Product tokens、只读 ProfileCareerView。入口覆盖 AI、首页、Profile、Jobs、Applications、Resume Studio、导入和设置。全局导航仅一个，页内分类为横向 Tabs；Studio 板块/画布/检查器为编辑器局部结构。

拖动分隔条或使用方向键/Home/End；折叠恢复保留宽度。切换产物任务、模拟局部错误、明暗与品牌绿/酒红均为本地演示状态。此隔离主题状态不移植进生产 Host。正式 Studio 的 TipTap、拖拽、撤销、分页和 PDF **未接入**，需完整保留原实现。

`audit.mjs` 保护旧交付并记录源码；`startup.mjs` 是本轮已停止的两个失败启动交互观测，不能反复重跑；原始输出在 evidence 的 startup-timings.json。启动卡在 Host 首次配置/准备遮罩，侧栏可见不代表可交互。测量限制和后续方案见专项启动报告。

响应式验证在三视口、两主题、八页面运行，共48张截图。原型验证与真实 Host Pane 验证是两条独立证据链。

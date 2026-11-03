# P5.2.1 独立视觉原型

推荐方向C的可运行评审稿。React 19 + 现有 Product 组件/CSS + 原合成Profile展示组件；没有生产路由、Provider、Agent工具、数据库、localStorage或业务写入。所有内容是合成示例，刷新即重置。Jobs/投递/Studio入口只展示信息架构占位，搜索/模型菜单不是正式业务服务。

从仓库根目录运行（Windows PowerShell）：

```powershell
node prototype/unified-experience/build.mjs
node prototype/unified-experience/serve.mjs
```

打开 **http://127.0.0.1:5181**。已有5181服务时直接打开，勿重复启动。服务仅绑定loopback，仅提供生成的index.html/main.js，不提供仓库或任意文件；CSP connect-src none阻止模型/工具网络。

build使用当前机器已有锁定Hermes checkout中的esbuild，不安装依赖。默认查找`%LOCALAPPDATA%/hermes/hermes-agent/apps/desktop`，其他机器可设置`HERMES_SOURCE_DIR`指向同锁定checkout。前端实际运行依赖使用本项目React/lucide；Host esbuild只是开发构建工具。产物在`.artifacts/p521-prototype/`，不混入生产业务模块。

## 评审操作

- 左下切明暗主题；导航进入个人资料库，切七类资料；展开桌面导航后可折叠并从页头恢复。
- 右栏分隔线可拖动，也可聚焦后按左右/Home/End；产物可关闭后从页头恢复，保持比例。对话与产物分别滚动。
- 新建对话→选择提示→输入/添加合成附件→发送；点击“完成演示/演示失败”显式切换状态；发送区提供停止。不会调用模型。
- 产物底部“测试预览错误”触发真实React局部ErrorBoundary；聊天仍可用。关闭并恢复右栏可重建预览。浏览器console会出现React捕获错误诊断，这是故障演示，不是无错误console认证。
- 设置对话框支持Esc/焦点恢复，仅改变原型局部外观，不写Host偏好。

主要目标1440×900、1024×768，另有1920×1080；1024自动icon rail，仍保持并排。小于760为上下分区实验降级，非本次主要验收。

## 自动验证与截图

保持serve运行，另开终端：

```powershell
node prototype/unified-experience/verify.mjs
pnpm exec eslint prototype/unified-experience/main.tsx prototype/unified-experience/build.mjs prototype/unified-experience/serve.mjs prototype/unified-experience/verify.mjs --max-warnings=0
pnpm typecheck
pnpm exec vitest run tests/unit/p520b2b2-profile-packaging.test.tsx tests/unit/p520a-profile-plugin.test.tsx
git diff --check
```

使用已有Playwright Chromium；不自动安装浏览器。截图与JSON在[docs/architecture/evidence/p521](../../docs/architecture/evidence/p521/)，[视觉方向](../../docs/architecture/p5.2.1-visual-direction.md)有可点击截图索引。verify覆盖几何/重叠/宽度、主题、拖动与键盘、折叠恢复、独立scroll、对话状态、附件、Dialog和局部错误恢复；不是Hermes真实工具端到端验收。

Host真实审计脚本`audit-host.mjs`只用于本机固定源码开发Host，需要另行运行原Host Vite 5174和已有合成plugin bundle。它创建隔离home/userData、使用offline provider，harness内部store注入仅用于截图，不得成为生产插件接口。

许可：原型新写布局，复用本项目既有组件；五个参考项目仅设计思想借鉴，无其源码/字体/纹理/Logo复制。Open WebUI当前为多许可并有品牌条件，不能当MIT整仓白标。研究来源与版本见审计与research-evidence.json。

完成视觉验收后停止；本目录不是生产实现，不自动进入P5.2.2。

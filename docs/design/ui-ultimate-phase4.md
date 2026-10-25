# UI Ultimate Phase4：右侧设置栏重构

日期：2026-10-25。分支 main，HEAD 4b3d0c0。未提交、未推送、未打包。
本阶段按用户指定 Phase4 执行，不重编号已有 MASTER 阶段。保留 Phase3 未提交成果与用户 `.gitignore` 修改。

## 实现

重新查看 01-page-settings、02-style-panel、03-typography-layout-panel；右栏重建为暖白底、独立滚动卡片、胶囊标签、统一数字步进器、滑杆与数字框、开关、色板和标题/经历样式小样。沿用应用语义 Token，并新增明暗 inspector surface Token。保留品牌绿/酒红强调色。

| 标签 | 本轮设置 | 实际路径 |
|---|---|---|
| 排版 | 全局字号、行间距、字间距、板块间距；姓名/板块标题/联系方式/正文描述/经历标题/求职意向比例；紧凑/标准/宽松密度 | 权威 presentation.precision + 既有 theme.density → 共享 renderer/CSS → A4/PDF |
| 样式 | 字体预设、英文/数字字体（含Times New Roman）、中文字体；三种颜色及自定义色；标题随色；标题纯文字/底线/浅底、经历同行/双行、链接三种样式；六种符号、符号大小、下划线宽度、标题竖杠、中性灰分隔线、个人信息图标 | 字体使用原 typography；精调沿用 precision → 快照/哈希 → A4/PDF |
| 页面 | 四边独立mm边距；多页模式；三种头部布局/三种垂直对齐；信息XY偏移、抬头最小高度、正文间距 | precision + 原 pagination → 共享测量/预览/PDF；单页关闭时严格检查溢出，保留全部事实 |
| 模板 | 原注册模板选择、模板中心、恢复当前模板默认样式 | 原 registry/Repository 路径；重置会清除精调，可撤销/重做 |

“更多页面设置”保留页数策略、一页优化/两页舒展、页眉页脚、部门位置。预设同步精调值，避免精调覆盖后预设失效。旧 style 模式链接/保存状态导向新右栏，不再以旧简化菜单作为入口。

照片：当前7个模板均声明不支持照片，XY控件禁用并说明原因。未伪造照片配置或输出能力。抬头高度0表示自动，非0为最小高度，避免裁切内容。

## 数据与导出

- 新 `presentationPrecision.ts` 只定义有界、严格校验的可选展示覆盖。未改简历事实Schema、ResumeRevision、Fact Guard、栏目排序、富文本或表结构。
- 继续通过 `WorkspaceRepository.saveResumePresentationConfig` 权威写入。样式操作队列、去重、展示撤销/重做包含 precision，没有新增竞争状态源。
- ExportSnapshot、ExportRecord展示元数据保留可选 precision；旧快照缺省兼容。沿用原哈希算法，新展示字段进入原快照哈希，篡改验证失败。
- `precisionStyleVars/precisionAttrs` 同时用于 A4测量、画布和正式 PDF HTML。未引入浏览器打印替代正式下载。
- 旧配置无精调时不注入新的字号等覆盖；系统英文字体保留旧中文优先栈，明确选择英文搭配时英文优先。

## 拖宽与折叠

宽度写入既有 `careeradapt.resumeStudioLayout` 本机UI偏好，范围280–520px并受可用空间限制；支持指针拖动和左右键16px调整。宽屏保留画布空间，1024设置占用预览区域时允许调整可用右栏宽度，手机使用可用区域。
折叠隐藏右栏但保留DOM、标签和每标签滚动位置；画布自动扩展。右侧半圆按钮立即恢复；窄屏直接设置入口/Escape/返回预览保留。未更改左栏拖宽协议。

## 实际验证

| 命令/验证 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0；最后补充截图测试后该文件ESLint另行通过 |
| `pnpm build` | exit 0，生产构建成功 |
| `pnpm exec vitest run tests/unit/presentationConfig.test.ts tests/unit/export.test.ts tests/unit/templateRegistry.test.ts tests/unit/pagination.test.ts tests/unit/renderCoverage.test.ts` | 5文件56项通过 |
| `pnpm exec playwright test tests/e2e/p38b-resume-presentation.spec.ts tests/e2e/app-accent.spec.ts --workers=1` | 5项通过，55.3秒 |
| `pnpm exec playwright test tests/e2e/p38b-resume-presentation.spec.ts --grep 'precision settings' --workers=1`（补充明暗和细节截图） | 1项通过，15.6秒 |
| `git diff --check` | exit 0 |
| Poppler pdfinfo/pdffonts/pdftotext/pdftoppm | 正式precision.pdf为2页A4，字体含Times New Roman及本机宋体回退；文本核验、首张栅格查看完成 |

新增单测验证精调持久化不改变branch/来源/内容revision；非法值与未知键拒绝；快照往返、哈希篡改拒绝、正式HTML变量/属性、渲染模型事实不变。
浏览器验证数值与颜色/页边距/抬头等实际computed样式、刷新持久化、拖宽/键盘/折叠展开/滚动/标签、主题切换纸张白底且展示style/正文不变、禁用照片、恢复默认/撤销重做、正式下载200和PDF正文、业务三表快照不变；沿用原内容/分页/草稿选择缩放测试，无跳过或降低断言。

过程中新增测试首次错误假定刷新回到排版标签，而真实应用保留页面标签，已先显式切换标签；另一次1024错误地把已打开设置关闭，停止该次运行后以可见状态判断修正。最终上述命令全部取得完整exit 0。没有把中断运行计为通过。
日志：`.tmp/ui-phase4-*.log`。本轮为相关Feature验收，没有宣称全量历史Unit/E2E Release Gate。

## 截图和PDF

实际浏览器截图位于 `artifacts/ui-phase4/`：
- 1920-排版.png、1920-样式.png、1920-页面.png、1920-模板.png、1920-collapsed.png
- 1366-排版.png、1366-样式.png、1366-页面.png、1366-模板.png、1366-collapsed.png
- 1024-排版.png、1024-样式.png、1024-页面.png、1024-模板.png、1024-collapsed.png
- 1920-style-details.png、1920-page-details.png
- 1920-dark-green.png、1920-dark-burgundy.png、1920-light-green.png
- precision.pdf、pdf-page-1.png

已实际查看三视口、折叠、样式细节、深色及PDF栅格。1366三栏同时展开时画布缩放较小，折叠右栏可立即扩展；1024沿用设置/预览互切，避免遮挡左栏。

## 修改文件（Phase4）

新增：
- src/components/resume/PrecisionInspector.tsx
- src/components/resume/templates/precisionStyles.ts
- src/domain/schemas/presentationPrecision.ts
- docs/design/ui-ultimate-phase4.md

修改：
- src/app/resume/ResumeWorkspace.tsx
- src/app/globals.css
- src/styles/product-pages.css
- src/styles/product-tokens.css
- src/components/resume/A4ResumePreview.tsx
- src/components/resume/templates/presentationStyles.ts
- src/components/resume/templates/shared/canonical.tsx
- src/components/resume/templates/types.ts
- src/domain/schemas/presentation.ts
- src/domain/schemas/export.ts
- src/domain/schemas/branch.ts
- src/services/export/pdfHtml.tsx
- src/services/export/snapshot.ts
- src/services/storage/repositories.ts（仅导出记录展示类型）
- tests/unit/presentationConfig.test.ts
- tests/unit/export.test.ts
- tests/e2e/p38b-resume-presentation.spec.ts
- tests/e2e/support/g7b2Ui.ts
- plan4.md、history4.md（依现有忽略规则维护）

其中Workspace/CSS/E2E/helper同时包含此前Phase3未提交成果，未覆盖或撤销。`.gitignore`及Phase3报告原样保留。构建生成next-env.d.ts已恢复本轮开始时内容。

## 限制与未做

- 照片偏移受当前模板能力限制而禁用，后续有照片模板时须单独实现图片布局；本轮没有假控件。
- 未打包字体，具体字体依赖本机，缺失会用同一字体栈回退；已在控件说明，PDF检查实际使用宋体回退。
- 旧版本客户端不认识新precision字段；本轮验证当前版本旧数据兼容，未进行跨旧版客户端往返认证。
- 未验收手机尺寸、Electron打包；未提交推送。排序、富文本和后续新模块未启动。

# 简历编辑器最终收尾与冻结验收（2026-10-25）

状态：**PASS — RESUME EDITOR CLOSURE: PASS**。本轮核心编辑器允许冻结；不代表 Agent 或全项目后续阶段验收。所有下列最终命令均已取得完整退出码。

后续用户截图反馈的个性化增量另见 [编辑器个性化完善](editor-reference-refinement.md)；此处记录保留为 2026-10-25 的原范围证据，不代替增量验收。

## 用户要求与基线

- 范围：模板配置保存恢复、栏目/条目排序、照片上传/保存/更换/移除、共享预览/打印/正式 PDF、旧数据兼容和回归测试。
- 补充要求：个人信息右侧可点击的添加照片框；有照片时姓名、求职意向与联系方式仍居中，照片靠右，不被照片挤偏。
- Git：`main`，HEAD `5b5cf1e53da42c1f9e9e1269dd542bdcb9258b56`；开始时工作区干净。未授权提交、推送或 Electron 打包。
- 已读 AGENTS、plan4/history4 当前交接和相关源码/测试。排序此前已经实现，本轮复用，不另建排序源或模板目录；不进入 Agent 架构优化。

## 实际缺口与修复

1. V2 有 `basics.photo`，分支、版本快照和 candidate 尚无该字段。现在通过可选字段贯通，照片属于当前简历，所有正式写入经过 `WorkspaceRepository.editResumeBranchBasics`；不反写个人资料库。
2. 上传在浏览器校验 JPG/PNG/WebP、0～5 MB、可解码性与最多 4000 万像素；本地缩放至长边不超过 600px，再编码 JPEG，持久化 Data URL 上限约 512 KiB。不保存临时 Blob URL，不需要外部图片托管。错误保留可见反馈；更换/移除进入原有内容 revision，版本冲突仍拒绝写入。
3. 六个模板在共享 `ResumeHeader` 渲染照片，ATS 极简单栏保持 `supportsPhoto=false`。显示开关接入实际页面检查器，ATS 禁用并说明；照片偏移仍禁用并说明由模板管理。
4. 有照片时使用左右对称的预留列，文字相对纸张内容区居中。显示照片期间头部布局和信息水平偏移控件显示有效值并禁用，说明原因；隐藏/移除后恢复原保存的配置，不覆盖用户偏好。
5. 直接 PDF 的测量阶段和最终页面阶段都等待字体、图片解码与稳定布局。损坏图片返回明确 `resume_photo_decode_failed`，不生成缺图的成功 PDF。共享模板使用原生图片以支持独立 SSR；Next 图片组件在此链路实际造成过 HTTP 500，已消除。原生图片的局部 lint 例外有具体原因，上传阶段已完成缩放。
6. 浏览器打印原先被 AI shell/画布的固定高度与 overflow 截断，只印第一页。仅在简历编辑器打印媒体下释放这些容器，隐藏应用导航，保持 A4 页与分页。打印入口也等待图片；屏幕布局不变。
7. 模板切换原先猜测“等于源模板默认值”的值是默认设置，可能覆盖用户明确保存的相同值。现在切换保留全部已保存样式；新建/明确恢复模板默认排版仍使用 registry 默认值。
8. V2 栏目继续用 `canonicalSectionOrder`，V1 `sectionOrder` 和 `itemOrderBySection` 保留原职责，统一模型供预览/PDF。新增测试发现 flexible custom 没有 catalog seed，纯文本 codec 漏掉 title/description/highlights；现补齐这三个既有字段，不创建第二套正文模型。未知顺序键不造正文，未列出栏目稳定补入，重复/空键在 Schema 拒绝。
9. JSON 导出保留当前分支照片，移除后不从 Profile 重新补回。JSON 导入保留照片来源，用户单独确认或不导入，确认前 Repository 拒绝照片进入正文分支。外部 HTTP(S) 图片引用仍可读取和保留，但不发起远程加载，界面提示重传本地图片。空求职意向导出为缺省值，避免违反非空可选字段 Schema。

## 文件清单

| 文件 | 内容与原因 |
|---|---|
| `src/domain/schemas/resumePhoto.ts`（新增） | 共享本地光栅 Data URL/旧 HTTP(S) 引用校验和渲染边界 |
| `src/domain/schemas/resumeV2.ts` | V2 照片使用共享校验 |
| `src/domain/schemas/branch.ts` | 分支和版本快照的可选 photo |
| `src/domain/schemas/resumeRender.ts` | candidate 可选本地照片 |
| `src/domain/schemas/resumeImport.ts` | 导入照片字段保留来源与确认状态 |
| `src/domain/branch/profileBranch.ts` | 用户明确从 Profile 创建简历时复制其可选照片 |
| `src/domain/migrations/resumeV2.ts` | flexible custom 正文投影完整性 |
| `src/domain/resumeRender/mapper.ts` | 只从当前分支向 candidate 传递本地照片 |
| `src/domain/resumeImport/parser.ts` | JSON 照片与来源映射 |
| `src/domain/resumeImport/confirm.ts` | 照片人工确认及来源检查，写入简历而非 Profile |
| `src/domain/resumeImport/jsonV2Adapter.ts` | 照片 JSON 导出、移除不复活、空 targetRole 兼容 |
| `src/services/resumePhoto.ts`（新增） | 文件边界校验、本地解码缩放、编码和资源释放 |
| `src/components/editor/ResumePhotoInput.tsx`（新增） | 点击上传框、缩略图、更换/移除及错误反馈 |
| `src/components/editor/sections/BasicsSectionPage.tsx` | 姓名/求职意向右侧照片入口 |
| `src/components/resume/PrecisionInspector.tsx` | 真正可达的显示照片开关与居中模式说明 |
| `src/components/resume/import/ResumeImportWizard.tsx` | 导入照片预览/确认/不导入 |
| `src/components/resume/templates/shared/canonical.tsx` | 六模板共享照片头部，失败不影响其他内容 |
| `src/components/resume/templates/atsMinimal.tsx` | 明确不渲染照片 |
| `src/components/resume/templates/registry.tsx` | 能力声明与兼容提示 |
| `src/components/resume/templates/presentationStyles.ts` | 切换模板保留已保存配置 |
| `src/services/export/pdfGenerator.ts` | 测量/最终 PDF 解码等待与明确错误 |
| `src/app/resume/ResumeWorkspace.tsx` | 原 Repository 保存路径、显示开关、保存时阻止导出、打印等待 |
| `src/app/globals.css` | 点击上传框、对称居中头部和打印容器修复 |
| `tests/unit/resumePhoto.test.tsx`（新增） | Schema、文件错误、缩放、七模板能力、版本/隔离/移除/JSON 确认 |
| `tests/unit/presentationConfig.test.ts` | 自定义正文、部分顺序/未知键、稳定追加、重复/空顺序拒绝 |
| `tests/unit/templateRegistry.test.ts` | 明确已保存默认值也不被切换覆盖 |
| `tests/unit/p36g02CanonicalImport.test.ts` | 既有含照片夹具按新确认契约显式确认，保留原计数断言 |
| `tests/unit/p45c1c18-profile-editor-route.test.tsx` | 历史测试环境缺 ResizeObserver，且仍找退役 TipTap；补浏览器 API mock，按当前逐条编辑 DOM 保留四条内容、无重复和 A→B→A 复原断言 |
| `tests/e2e/p38b-resume-presentation.spec.ts` | 完整照片/七模板/排序/刷新/PDF 图片解析/打印/损坏图片闭环 |
| `docs/design/resume-editor-closure.md`（本文件） | 冻结范围、文件、验证、边界及下一阶段入口 |
| `plan4.md` / `history4.md`（原规则本地忽略） | 当前任务、结果和交接，不强制加入 Git |

## 验证与证据

- 修改前：`pnpm typecheck` 退出 0；四文件 43 项单测通过；既有栏目排序真实 PDF E2E 1 项通过，并取得修改前页面截图。
- 定向单元/集成：首批 11 文件 106 项通过，另有排序/参考模板验证；新增 flexible custom 场景已单独验证。最终全量见下。
- 首轮全量为 1614/1618，通过照片夹具确认后为 1616/1618；两项历史 Profile 测试已在 `.tmp/editor-closure-baseline` 的原始 HEAD 独立复现。补 mock 后暴露退役 TipTap DOM 期望，已按当前逐条编辑契约修正，单项 2/2 通过；之后一轮全量 220 文件、1618 项通过。新增 custom 回归后的最终全量见下。
- `pnpm exec playwright test tests/e2e/p38b-resume-presentation.spec.ts tests/e2e/resume-content-sidebar.spec.ts tests/e2e/resume-sidebar-polish.spec.ts --workers=1`：17/17 通过，7.5 分钟。包括原有字段联动、样式/布局恢复、草稿、拖拽、撤销重做、创建、删除恢复与正式 PDF。补充打印检查曾真实发现截断并修复；修复后照片闭环单项通过。加入自定义正文后补测 1/1 通过（1.8 分钟）；随后在刚构建的生产服务 3107 上复跑同一闭环，显式手动保存求职意向并检查所有头部文字居中、七模板和自定义正文、打印、损坏图片，1/1 通过（58.4 秒），退出 0。
- PDF 使用真实 `/api/resume-export/pdf`，检查 HTTP 200、快照的 template/order/photo/字体，Poppler `pdftotext` 验证正文/顺序，`pdfimages -list` 验证支持模板嵌入 450×600 图片、不支持/隐藏/移除无图；`pdftoppm` 将正式 PDF 栅格化后实际查看。打印媒体另生成真实 `browser-print.pdf`，保留跨页末尾内容与照片。`pdfinfo` 确认校园浅底直接 PDF 和浏览器打印 PDF 均为 2 页 A4（594.96×841.92pt）；预览也是 2 页。
- 证据目录 `artifacts/editor-closure/`：before/after-upload-1366.png、七模板 PDF、replacement/hidden/removed.pdf、browser-print.pdf、photo-pdf-page.png；匿名合成图，没有用户个人照片或云端请求。原有三视口证据仍在 sidebar/p38b 目录。
- 最终 `pnpm typecheck`、`pnpm lint`、`pnpm build`、`git diff --check` 均退出 0；补充 E2E 修改后的单文件 ESLint 也退出 0。Web build 完整生成 14 个页面；生产服务核心 E2E 通过。生成的 next-env.d.ts 已恢复到原内容并再次 typecheck 通过。测试过程中定位错误、等待保存时序和响应元数据断言错误均按实际契约修正；没有 skip、删内容断言或放松阈值。

## 限制与冻结交接

- 无新依赖、表、不可逆迁移、Fact Guard 阈值变化或 Agent 能力变化；ResumeDocument 仍只派生。
- 旧无照片数据可继续读取/导出。旧外部照片引用须重传本地图片；照片自动从扫描件提取不属于本轮。
- 浏览器打印生成文件已自动检查；操作系统打印对话框的人工保存、手机/触屏、旧客户端往返和 Electron 安装/升级未作为本轮验收，不声称已验证。
- 只冻结本轮核心编辑器范围，不代表所有 B0～B6、真实 AI provider 或 Agent 发布门禁完成。
- 推荐冻结基线为本报告验收的工作树；当前 HEAD 本身不包含本轮修复，待用户明确要求后再形成冻结提交。未提交、未推送、未打包，旧 release/EXE 不含本轮修改。
- 下一阶段由用户单独启动；不自动进入 Hermes/MCP/Skill Runtime/多智能体等优化。


## 最终命令汇总

| 命令 | 最终结果 |
|---|---|
| `pnpm typecheck` | PASS，退出 0 |
| `pnpm lint` | PASS，退出 0，补充 E2E 的单文件 ESLint 同样通过 |
| `pnpm test` | PASS，220 文件，1619 通过 / 0 失败，79.34 秒 |
| `pnpm exec playwright test tests/e2e/p38b-resume-presentation.spec.ts tests/e2e/resume-content-sidebar.spec.ts tests/e2e/resume-sidebar-polish.spec.ts --workers=1` | PASS，17 通过 / 0 失败，7.5 分钟 |
| `pnpm exec playwright test tests/e2e/p38b-resume-presentation.spec.ts -g 'editor closure' --workers=1` | 打印修复及自定义正文补测 PASS，1 通过 / 0 失败，1.8 分钟 |
| `pnpm build` | PASS，退出 0 |
| `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3107 pnpm exec playwright test tests/e2e/p38b-resume-presentation.spec.ts -g 'editor closure' --workers=1` | 生产构建服务 PASS，1 通过 / 0 失败，58.4 秒 |
| `git diff --check` | PASS，退出 0 |

未执行：全量历史 UI E2E/四分片、C1/C2/真实 AI、系统打印对话框手工保存、Electron 打包。它们不属于本轮核心编辑器改动门禁。测试启动的生产服务验收后停止；原有用户开发服务保留。历史基线检出保留于本地忽略目录，未批量删除。

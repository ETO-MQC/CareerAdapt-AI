# V2-G3b：一页/两页策略与确定性分页控制

状态：实现完成，等待 G2/G3a/G3b 联合独立验收。
日期：2026-07-05

## 1. 目标

- 在不引入新依赖、不新增 Dexie 表、不升级 Dexie 的前提下，为直接 PDF 和浏览器打印 fallback 增加一页/最多两页策略。
- 默认保持一页严格模式；用户可显式切换为最多两页。
- 预览、浏览器打印、直接 PDF 和 ExportRecord 使用同一份分页计划。
- Section 级支持“从下一页开始”的确定性断页提示，但不产生空白第一页。
- 超过策略上限时阻断直接 PDF 和打印 fallback，不写成功导出记录。

## 2. 范围边界

本阶段只做一页/两页策略与确定性分页控制。

不做：

- DOCX 导入或导出。
- OCR。
- 三页及以上策略。
- 自动压缩内容、AI 排版建议或模板推荐。
- Fact Guard 规则变更。
- Dexie 表结构迁移、ResumeDocument 持久化或新依赖。
- 最终 G2/G3 联合独立验收。

## 3. 数据模型

`ResumePresentationConfig` 新增：

- `pagination.pagePolicy`：`one_page_strict | up_to_two_pages`，默认 `one_page_strict`。
- `pagination.pageBreakBeforeSections`：Section ID 数组，仅保留当前可见 Section，过滤首个可见 Section、重复项和非法项。

分页策略属于展示配置：

- 会增加 `presentationRevision`。
- 进入展示层 undo/redo。
- 不创建内容 `ResumeRevision`。
- 不运行 Fact Guard。
- 不修改事实文本、factRefs 或 sourceTrace。

## 4. 分页状态

G3b 使用统一分页状态替代旧的单一 overflow 语义：

- `fits_one_page`
- `near_one_page_limit`
- `fits_two_pages`
- `exceeds_two_pages`
- `measuring`
- `measurement_failed`

旧的 `fits / near_limit / overflow` 仍在 Schema 层兼容解析，用于旧记录和旧测试语义。

## 5. 确定性分页计划

新增核心服务：`src/services/export/pagination.ts`。

分页流程：

```text
正式模板 renderer 渲染隐藏测量页
-> 收集 data-render-section / data-source-item-id 对应 DOM 位置
-> 结合 pagePolicy 和 pageBreakBeforeSections 计算 PaginationPlan
-> A4 预览按 PaginationPlan 渲染可见页面
-> 直接 PDF 在 Headless Chromium 内再次测量并重算 PaginationPlan
-> 比较 paginationHash
-> 只用服务端确认后的 PaginationPlan 生成最终 PDF
```

`paginationHash` 只包含策略、状态、页数、Section/Block 分页归属和手动断页配置，不包含原始像素测量值，避免浏览器与 Headless 之间的微小像素差导致误判。

## 6. 预览和导出

A4 预览：

- 使用正式模板 renderer 渲染隐藏测量页。
- 可见区域按 `PaginationPlan.pages` 渲染一页或两页。
- 页码标签位于 A4 页面外，并带 `.no-print`，不会进入 PDF。
- 选中区块被隐藏或因分页模型暂不可见时，编辑 overlay 回退到第一页，避免未保存草稿状态丢失。

直接 PDF：

- API 接收客户端冻结快照和客户端分页计划。
- Headless Chromium 先渲染测量 HTML，再收集 DOM 测量并重算分页计划。
- 若服务端计划超过策略上限，返回阻断错误，不生成成功记录。
- 最终 PDF 使用服务端确认后的分页计划。

浏览器打印 fallback：

- 复用当前客户端分页计划。
- 超过策略上限时阻断 `window.print()`。
- 阻断记录写入 `blocked_overflow`，不写 `print_invoked` 成功记录。

## 7. 模板能力

四套 G2 正式模板均声明：

- `supportsTwoPages: true`
- `supportsSectionPageBreaks: true`
- `supportsContinuationHeader: false`

当前实现不生成第二页续页页眉。第二页继续使用同一模板版式，但隐藏顶部联系 Header，避免重复候选人信息造成 PDF 审阅混乱。若后续需要续页页眉，应作为独立模板能力设计。

## 8. ExportRecord 和快照

导出快照新增：

- `pagePolicy`
- `requestedMaxPages`
- `actualPageCount`
- `pageBreakBeforeSections`
- `paginationPlan`
- `paginationHash`
- `presentation.pagination`

ExportRecord 新增可选字段：

- `pagePolicy`
- `requestedMaxPages`
- `actualPageCount`
- `pageBreakBeforeSections`
- `paginationHash`
- `paginationSnapshot`
- `exceededPageLimit`
- `continuationHeader`
- `pageSize`
- `pageDimensions`

所有新增字段均为可选字段，不需要 Dexie 迁移，旧记录继续兼容。

## 9. 验证结果

- `pnpm typecheck` 通过。
- `pnpm lint` 通过。
- `pnpm test` 通过：94/94。
- `pnpm build` 通过。
- G3b 专项 E2E 通过：2/2。
- G3a 专项 E2E 通过：7/7。
- D2/G2/G3b 组合 E2E 通过：22/22。
- `pnpm test:e2e` 通过：90/90。
- `pnpm test:c1:eval` 通过：total=15、positiveCasesPassed=13、negativeCasesCorrectlyRejected=2、hardSafetyFailures=0、overallQualified=true。
- `pnpm test:c2:eval` 通过：safeAllowed=6、safeBlocked=0、unsafeBlocked=10、unsafeAllowed=0、workflowTestsPassed=108/108、overallQualified=true。

## 10. 发现并修复的问题

- 隐藏当前选中区块后，编辑 overlay 因选中区块不在分页后的可见模型中而消失；已改为在选中区块暂不可见时回退渲染到第一页，保留未保存草稿状态。
- 大量克隆条目制造分页压力时，缩减建议列表可能产生重复 React key；已为建议 key 增加稳定前缀。

## 11. 遗留问题

- 未启动 G2/G3a/G3b 联合独立验收。
- 未做三页策略、自动压缩、排版诊断或模板推荐。
- 未做 DOCX、OCR、云存储或邮件发送。

# Resume Studio Spec

## 推荐交互结论

V2采用“结构化区块编辑器 + 所见即所得预览 + 有约束的布局调整”：

- 单击模块：选中。
- 双击正文：行内编辑。
- 拖动手柄：调整区块或经历顺序。
- 右侧属性栏：调整样式、栏目、显示状态。
- 顶部工具栏：模板、字号、颜色、导出、历史。

第一阶段不做完全自由画布，因为绝对坐标编辑会破坏事实引用、导出一致性、响应式约束和可测试性。也不能只做左侧表单编辑，因为用户无法直观看到最终简历。

## 信息架构

- 顶部工具栏：模板中心、字号/间距/主题色、导入、AI建议、版本历史、导出。
- 左侧面板：简历文档结构树、section列表、区块可见性、来源状态。
- 中间画布：A4实时预览，支持区块选中、双击编辑、拖动手柄。
- 右侧面板：当前选中区块属性、Fact Guard、sourceQuote、样式配置、排版诊断。

## 页面状态

- 空状态：没有 verified ResumeBranch 时，引导从 `/jobs` 创建分支或从导入入口创建简历。
- loading/error：沿用V1 workspace状态，不丢失已编辑草稿。
- legacy分支：只读提示，不允许正式编辑或导出。
- overflow：分为 `fits`、`near_limit`、`overflow`；overflow阻止正式导出。

## Section和Block

- Section：basics、education、experience、project、skill、certificate、custom。
- Block：标题、时间、组织、角色、bullet、summary、link、divider。
- Block必须带 `factRefs` 或明确标记为 presentation-only。
- 用户编辑正文时创建内容Revision；显示隐藏和样式修改只更新展示配置。

## 选择与编辑

- 单击区块：进入 selected 状态，右侧显示属性和来源。
- 双击正文：进入 inline-editing 状态。
- Enter或F2：进入编辑；Ctrl/Cmd+Enter：保存；Escape：取消；G0a不实现失焦保存、自动保存或防抖后台Revision。
- 保存时走 Repository，文本修改重新运行规则 Fact Guard。
- 高风险内容不得直接保存为正式文本。

## 拖动排序和显示隐藏

- 第一阶段可先实现 section内部上移/下移，后续用拖动手柄。
- 拖动只改变 order，不修改事实。
- 隐藏区块不删除事实，也不删除ResumeBranch内容项。

## 撤销、恢复和自动保存

- 内容修改使用不可变 Revision。
- 样式和模板偏好使用 presentationRevision 或展示配置，不创建内容Revision。
- G0a只使用明确保存和取消。正式保存创建Revision。
- 分支切换、Revision变化、恢复版本、撤销、保存成功和离开编辑模式后必须清理本地编辑缓存、选中状态、错误状态和pending operationId，避免V1出现过的 `editTexts` 残留问题。

## Fact Guard和来源查看

- 右侧面板显示当前区块事实来源、PDF locator、sourceQuote。
- `pdf_import` 只在唯一定位时作为PDF来源；用户新增或无法定位内容标记为 `user_input` 或 pending。
- 任何事实文本变化都重新运行Fact Guard；排版和模板建议不得触发事实写入。

## 键盘和可访问性

- Tab在工具栏、结构树、预览区和属性面板之间可达。
- Enter/Escape行为一致。
- 选中状态不能只依赖颜色。
- 移动端第一阶段只提供预览和基础编辑，不提供完整设计器。

## G0a编辑边界

- ResumeDocument只作为派生编辑视图模型，不持久化。
- ResumeBranch/ResumeRevision继续作为唯一内容事实来源。
- 模板A/B使用统一的 `contentItemId` 或等价稳定ID，不分别实现编辑状态。
- 编辑UI必须用打印样式隔离，不得出现在PDF。

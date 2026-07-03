# Editor Interaction

## 状态模型

- `idle`：无选中区块。
- `selected`：单击区块后显示边框和右侧属性。
- `editing`：双击正文或点击编辑按钮后进入行内编辑。
- `dirty`：本地草稿与持久化内容不同。
- `saving`：Repository写入中。
- `guard_failed`：Fact Guard阻断。
- `persisted`：保存成功，预览与数据一致。

## 点击和双击

- 单击区块只改变 selection，不创建Revision。
- 双击可编辑文本进入行内编辑，不可编辑模板装饰不响应。
- 点击空白区域取消选择；若存在dirty草稿，先提示保存或放弃。

## 输入行为

- Enter或F2：选中状态进入编辑。
- Shift+Enter：插入换行。
- Escape：放弃本次草稿并恢复 persisted 文本。
- Ctrl/Cmd+Enter：保存当前编辑。
- 失焦：G0a不保存，不创建Revision。
- 手动保存：调用Repository，重新运行规则 Fact Guard。
- G0a不实现自动保存、失焦保存或防抖后台Revision。

## 冲突处理

- 保存时必须携带 `expectedRevision`。
- Revision冲突时保留用户草稿，提示刷新或另存为新编辑。
- 不允许静默覆盖当前分支最新版本。

## Fact Guard状态

- 文本变化后先执行规则 Fact Guard。
- 高风险新增数字、组织、技能、奖项、成果、参与升级为主导等直接阻断。
- 规则通过但AI复核失败时可进入 `rule_only_verified`，必须在UI提示。
- 样式、模板、可见性和排序不运行事实改写。

## Drag/Drop和Reorder

- 第一阶段可先实现上移/下移按钮，G1再引入拖动手柄。
- 若引入 dnd-kit，只在结构化section/block维度排序，不允许任意坐标拖拽。
- 排序修改创建 presentationRevision 或展示配置，不创建内容Revision。

## 右侧Style Panel

面板只作用于展示配置：

- 字号级别。
- section间距。
- 主题色。
- 单栏/双栏布局选项。
- section显示隐藏。
- 是否展示头像、链接、技能熟练度等模板能力项。

面板不得修改事实文本，不得触发AI事实生成。

## Template Switch

- 切换模板只修改 `templateId` 和展示配置。
- 切换后立即以同一ResumeDocument重新渲染。
- 不创建内容Revision。
- 若模板不支持某section，必须显示“不支持但未删除”提示。

## Undo/Redo

- 内容修改使用 ResumeRevision 或 V2 ContentRevision。
- 样式修改使用 PresentationRevision 或可撤销展示操作栈。
- 撤销内容不得撤销模板偏好，除非用户明确在展示历史中撤销。
- 恢复旧版本后清空 selection、editing draft、drag state 和右侧面板缓存。

## 防止缓存残留Bug

V1曾出现 `editTexts` 在恢复/撤销后未清空的缓存残留。V2必须：

- 将草稿状态按 `branchId + documentRevision + blockId` 建key。
- 分支切换、Revision变化、恢复版本、撤销、保存成功和离开编辑模式后清理不匹配key、错误状态和pending operationId。
- 模板切换不得创建内容Revision，也不得创建另一套模板专属编辑状态。
- 预览正文永远来自持久化模型或当前唯一草稿源，不从多个缓存读取。
- E2E覆盖“编辑 -> 撤销 -> 切换分支 -> 返回”。

## 键盘、焦点和可访问性

- Tab顺序：工具栏 -> 左侧结构 -> 预览选中区块 -> 右侧面板。
- 选中状态有边框和文本提示，不仅依赖颜色。
- 编辑框有可见label或ARIA标签。
- Escape只影响当前编辑，不关闭整个页面。

## 哪些操作创建Revision

创建内容Revision：

- 修改正文。
- 接受AI内容建议。
- 删除或新增内容区块。
- 修改与事实表达相关的标题或bullet。

只更新展示配置：

- 模板切换。
- 字号、间距、颜色。
- section显示隐藏。
- 排序和布局配置。
- overflow诊断结果。

## 不允许的G0a实现

- 不持久化ResumeDocument，不新增Dexie表，不升级Dexie v8。
- 不建立第二套内容Revision系统。
- 不引入复杂编辑器依赖。
- 不让编辑控件进入PDF。

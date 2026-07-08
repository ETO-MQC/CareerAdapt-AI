# CareerAdapt AI Design Context

## Direction

CareerAdapt AI uses a refined utilitarian interface:

- professional
- calm
- compact but breathable
- consistent
- low cognitive load
- restrained visual effects
- clear primary actions

Avoid decorative complexity, excessive cards, generic AI gradients, oversized empty areas, and random spacing.

## Resume Entry

- Primary action: 导入简历.
- Secondary create menu: 从零创建, 根据岗位创建, 导入JSON.
- Resume cards expose only high-frequency actions: 编辑, 导出, 更多.
- Low-frequency actions stay inside 更多: 重命名, 复制, 查看历史, 归档, 删除.

## Resume Studio

- Workbar stays fixed near the top of the workspace and exposes three modes: 编辑, AI优化, 样式.
- Edit mode uses section navigation, current-section structured fields, and an A4 preview.
- AI mode keeps the A4 preview visible and starts with summary cards before detailed suggestions or checks.
- Style mode prioritizes the A4 canvas and a right-side inspector with tabs: 模板, 颜色, 字体, 页面.
- A4 pages remain true white in light and dark themes.

## Interaction Rules

- The structured form is the reliable primary editor.
- A4 direct editing is a quick-edit layer and must sync through the same repository and revision paths.
- Esc cancels inline edits; Ctrl/Cmd+Enter saves.
- Blur may save when the active inline edit has a real value change.
- Unsupported data creation must not fabricate facts or bypass confirmation.

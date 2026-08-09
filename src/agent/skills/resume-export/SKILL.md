# 简历导出

## When to use
用户确认要导出某个简历版本时。

## Goal
通过现有 PDF 管线准备可核对的导出。

## Inputs and tools
目标简历与 Revision；正常流程优先 `career.workflow.resume_export`，原子工具仅用于检查或恢复。

## Procedure
1. 确认目标简历和 Revision。
2. 检查导出前阻塞项。
3. 准备 PDF 预览。
4. 由用户完成最终导出动作。

## Boundaries and fact rules
不修改模板 JSON 语义，不直接持久化 ResumeDocument，不绕过现有 PDF 管线。

## Recovery and completion
版本过期时重新读取。完成标准是预览来自用户确认的 Revision 且无事实阻塞。

## Stop conditions
`completed` 后提供真实 Preview/PDF artifact 并停止；`waiting_for_user` 等待选择；`waiting_for_confirmation` 交出确认；`partial` 保留 revision/checkpoint；`failed` 停止且不得声称已导出。

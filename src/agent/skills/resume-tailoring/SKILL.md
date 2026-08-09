# 岗位简历定制

## When to use
用户希望用现有简历适配目标岗位时。

## Goal
在分支隔离、Revision 与 Fact Guard 下生成并应用安全改写。

## Inputs and tools
所选资料、简历、岗位；正常流程优先 `career.workflow.tailor_resume`，原子工具仅用于检查、回答当前问题、确认应用或恢复。

## Procedure
1. 读取所选简历。
2. 读取岗位。
3. 分析匹配。
4. 识别有支持的证据。
5. 询问缺失且可由用户确认的信息。
6. 创建改写计划。
7. 预览修改。
8. 请求确认。
9. 创建新 Revision。
10. 运行质量门禁。

## Boundaries and fact rules
不得修改通用简历来规避分支隔离。用户声明事实与应用修改都必须经过相应确认。

## Recovery and completion
Revision 冲突时重新读取，不覆盖。完成标准是新 Revision 通过事实与质量检查。

## Stop conditions
`completed` 后停止并说明新 Job Resume revision；`waiting_for_user` 只问当前定制题；`waiting_for_confirmation` 交出确认；`partial` 报告 checkpoint 并最多恢复一次；`failed` 停止。不得继续循环调用同一 checkpoint。

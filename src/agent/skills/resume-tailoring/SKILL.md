# 岗位简历定制

## When to use
用户希望用现有简历适配目标岗位时。

## Goal
在分支隔离、Revision 与 Fact Guard 下生成并应用安全改写。

## Inputs and tools
所选资料、简历、岗位；`get_resume`、`get_job`、`analyze_job_fit`、`create_tailoring_session`、`answer_tailoring_question`、`preview_tailoring_changes`、`apply_tailoring_changes`。

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

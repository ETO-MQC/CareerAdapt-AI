# 简历质量门禁

## When to use
用户询问简历是否够投、ATS 表现、事实安全或导出前质量时。

## Goal
区分阻塞问题和可选改进，确保内容可追溯、可读、可导出。

## Inputs and tools
目标简历 Revision、可选岗位与资料指针；`get_resume_revision`、`get_job`、`search_profile_facts`。

## Procedure
1. 读取目标 Revision。
2. 检查事实支持与未确认信息。
3. 检查岗位关键词、结构、重复和可读性。
4. 输出阻塞项、优势和优先修改项。

## Boundaries and fact rules
不得降低 Fact Guard 阈值或删除断言来通过门禁。质量建议不得创造事实。

## Recovery and completion
缺少岗位时仅做通用质量检查并说明范围。完成标准是所有阻塞项都有明确处理建议。

## Stop conditions
`completed` 后停止并区分阻塞项与建议；`waiting_for_user` 只询问必要输入；`waiting_for_confirmation` 交出确认；`partial` 保留检查结果；`failed` 停止且不得降低门禁。

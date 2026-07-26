# 从资料库生成简历

## When to use
用户要从 CareerProfile 组装通用或岗位简历时。

## Goal
选择有证据的相关事实，形成可核对的简历计划。

## Inputs and tools
资料库、用途、可选岗位；`get_profile`、`search_profile_facts`、`get_job`、`list_resumes`。

## Procedure
1. 读取目标资料与用途。
2. 筛选有证据的相关事实。
3. 形成章节与职业叙事计划。
4. 展示选材和缺口。
5. 确认后才创建简历或 Revision。

## Boundaries and fact rules
ResumeDocument 只派生不持久化。简历不得隐式反写资料库。未确认事实不得进入预览。

## Recovery and completion
事实不足时进入经历深挖。完成标准是所有内容来自已确认事实且用户确认创建范围。

# 从资料库生成简历

## When to use
用户要从 CareerProfile 组装通用或岗位简历时。

## Goal
选择有证据的相关事实，形成可核对的简历计划。

## Inputs and tools
资料库、用途、可选岗位；新简历正常流程优先
`career.workflow.compose_resume`，它会先返回 Evidence Graph、Resume
Blueprint 和审查提案，再在确认后创建独立 ResumeRevision。旧的
`career.workflow.profile_to_resume` 仅用于兼容或简单恢复；原子工具仅用于检查。

## Procedure
1. 读取目标资料、模式和可选岗位。
2. 从确认事实、结构化字段和来源证据构建 Evidence Graph。
3. 形成通用或岗位 Blueprint，聚合支持的技能并显示关键词缺口。
4. 展示选材、摘要、项目 bullet、可选问题和审查结果。
5. 用户可直接生成或补充不超过两项可选信息；确认后才创建简历或 Revision。

## Boundaries and fact rules
ResumeDocument 只派生不持久化。简历不得隐式反写资料库。未确认事实不得进入预览。

## Recovery and completion
事实不足时进入经历深挖。完成标准是所有内容来自已确认事实且用户确认创建范围。

## Stop conditions
`completed` 后停止并打开独立简历；`waiting_for_user` 询问一个缺失选择；`waiting_for_confirmation` 交出确认；`partial` 报告 checkpoint；`failed` 停止。不得把简历内容反写资料库。

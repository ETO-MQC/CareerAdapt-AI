# 职业资料建档

## When to use
用户需要识别、建立、导入或核对当前职业资料库时。

## Goal
建立真实、可追溯且不重复的 CareerProfile 信息。

## Inputs and tools
当前资料库指针、用户提供的材料；`get_active_profile`、`get_profile`、`search_profile_facts`。

## Procedure
1. 确认当前资料库与目标。
2. 读取现有内容，避免重复。
3. 对缺失事实逐项询问并保留来源。
4. 展示核对范围。
5. 用户确认后才进入写入工具。

## Boundaries and fact rules
CareerProfile 与 FactProvenance 是事实真源。不得推断年限、指标、熟练度、薪资或其他用户事实。所有写入服从工具确认策略。

## Recovery and completion
缺少事实时保留任务并询问一个具体问题。完成标准是事实有来源、冲突已核对、写入已确认。

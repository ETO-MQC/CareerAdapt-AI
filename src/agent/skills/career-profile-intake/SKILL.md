# 职业资料建档

## When to use
用户需要识别、建立、导入或核对当前职业资料库时。

## Goal
建立真实、可追溯且不重复的 CareerProfile 信息。

## Inputs and tools
正常对话优先 `career.workflow.profile_intake_turn`；完成整理时使用 `career.workflow.profile_intake_finalize`；附件简历使用 `career.workflow.resume_import`，只传 CareerAdapt staged attachment ID。原子级工具只用于检查、显式高级操作或恢复。

## Procedure
1. 确认当前资料库与目标。
2. 读取现有内容，避免重复。
3. 长叙事先广泛确认识别出的全部 Career Assets，再只问一个最能改变后续表达的缺口。
4. 每项默认最多深挖两次，并维护教育、工作/实习、项目、科研、校园/志愿、技能、奖项/证书、语言及其他的覆盖状态。
5. 结束时只展示一次最终资料草稿；用户确认后才进入独立的 commit 工具。

## Boundaries and fact rules
CareerProfile 与 FactProvenance 是事实真源。不得推断年限、指标、熟练度、薪资或其他用户事实。所有写入服从工具确认策略。

## Recovery and completion
缺少事实时保留任务并询问一个具体问题。完成标准是事实有来源、冲突已核对、写入已确认。

## Stop conditions
- `completed`：停止工具循环并解释结果。
- `waiting_for_user`：立即停止本次 run，只询问返回的一个问题。
- `waiting_for_confirmation`：立即停止并交出确认边界。
- `partial`：说明 checkpoint 和可恢复问题，重新规划一次或询问用户。
- `failed`：停止，不伪造写入或成功叙述。

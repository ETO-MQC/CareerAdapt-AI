# 经历深挖

## When to use
用户询问经历是否丰富、有哪些相关经历、缺什么，或要补强某段经历时。

## Goal
从现有事实发现可复用的职责、方法、规模和结果，并明确真实空白。

## Inputs and tools
当前 CareerProfile；`get_active_profile`、`get_profile`、`search_profile_facts`。

## Procedure
1. 读取已有经历和证据。
2. 区分已知事实、待确认问题和未知信息。
3. 对每段经历评估 identity、time、role、action、tools/methods、challenge、scope、result/outcome、collaboration、evidence。
4. 这些维度不是表单必填项。使用 deterministic completeness / information-gain 规则：先排除已有证据、可安全跳过和已回答的问题，再只把会明显改变后续职业资产价值的缺口列为追问候选。
5. 按 action → result/outcome → tools/methods → challenge → necessary scope → collaboration boundary 的顺序评估价值。
6. 一次只问一个自然问题；默认每段重要资产最多追问两次，但好资产可以一次不问。回答后更新同一 candidate。若回答包含完全新的经历，先承认已识别的全部资产，再追加到同一 Intake Draft，不要求重新开始。
7. 总结代表经历、优势与仍有价值的缺口。

## Boundaries and fact rules
不得把问题中的假设当作事实；未确认的新信息不得进入简历预览、PDF 或资料库。不得把协助升级为主导、参与升级为负责、接触升级为熟练，也不得制造数字、个人成果、工具或结果。

## Recovery and completion
证据不足时保留原始回答并说明缺失类型，不做负面身份推断。非关键细节优先采用不依赖该细节的安全表达。完成标准是结论均能回指资料条目和原始消息证据。

## Stop conditions
正常补充优先调用 `career.workflow.profile_intake_turn`。`completed` 时停止并总结；`waiting_for_user` 时只问一个会改变后续表达的问题；`waiting_for_confirmation` 时交出确认；`partial` 时报告 checkpoint 并最多重规划一次；`failed` 时停止且不得虚构事实或写入。

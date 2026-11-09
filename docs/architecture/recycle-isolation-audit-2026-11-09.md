# 岗位及其他实体回收站隔离审计

日期：2026-11-09。结论：**用户怀疑的岗位缺陷已复现，尚未修复**。本轮按“查一下是否有问题”完成审计，没有改变删除、恢复或重复导入的数据语义。

## 基线与范围

Starting / Final HEAD：`944c818406de83ac398c9ee27e5376f01a2d6887`；起始干净。上轮Hotfix已由用户提交为944c818，plan4/history4旧“尚未提交”仅为历史记录。本轮仅新增手动审计用例、配置、证据、本报告及交接记录；生产源码零修改，无真实Provider/Hermes额度、无用户实际IndexedDB访问、无提交推送打包、无文件删除。

## 1. 用户场景确认

“删除”实际是移入回收站，保留底层记录以便恢复，这是合理的。问题是岗位页与Agent读取没有共享同一套可见性约束。

- `JobsWorkspace.tsx:141–144`：列表和选中岗位会排除 `recycleBin.jobIds`。
- `WorkspaceRepository.moveJobToRecycleBin`（repositories.ts:7788）：仅写入回收站ID集合；不改正式Job、candidate listing、draft、Job revision。
- `listJobDescriptions/getJobDescription`（3024/3029）：读取全部正式记录，不判断回收状态。这些底层读取也用于备份、回收站和历史引用，本身保留完整数据不能直接认定有错。
- `BrowserAgentToolService.listJobs/getJob`（1249/1436）和 `QuickActionContextSnapshot.ts:129`：直接使用这些无过滤读取，没有在当前业务入口增加回收隔离。
- `commitJob`（agentToolService.ts:1749起）：候选listing仍指向旧Job，重复保存的早返回会返回原Job。
- `verifyJobIntakeCommit`（CareerWorkflowFacade.ts:665起）：详情和列表均能读到旧Job，就标记persistenceVerified/committed，没有验证岗位当前是否在用户可见列表。
- `completeJobCompany`（repositories.ts:2853）：同样未拒绝已经回收的Job，版本号未因回收变化而变化，所以旧版本目标仍可更新。

**两个确定性时序均已复现**：

1. 正式保存 → 移入回收站 → 创建全新Gateway/Executor → 相同JD再次保存。
2. 正式保存 → 新调用解析结束时移入回收站 → 提交/回读。

两者都返回原jobId、persistenceVerified=true、committed，但回收站仍含该ID，正式记录只有1条，并没有恢复或新建可见岗位。第一种时序已经排除了旧工具缓存或“AI删除前读过”的必要性。因此即使用户删除很早、模型很慢，也可以发生该问题。

这是**存在性核验与当前业务可见性不一致**，不是“物理删除失败”，也不是只需要改提示词。上轮Hotfix的保存回读验收遗漏了回收站分支；其PASS不覆盖本次新增场景。

## 2. 其他删除边界的抽查

| 对象 | 观察结果 | 判断/证据边界 |
|---|---|---|
| 岗位 | 页面排除；Agent列表、详情、公共摘要仍包含；旧岗位可被重复保存回执认可、可补公司 | 真实Gateway→Facade→Repository链已复现，确认缺陷 |
| 简历回收 | listResumes已排除trashed；getResume/getResumeRevision服务方法仍能读取 | 服务层生命周期隔离不统一。历史Revision应保留，但普通当前详情入口应区分；未宣称所有生产Gateway路径都可访问 |
| 资料版本回收 | listProfiles排除trashed；getProfile/searchProfileFacts服务方法仍返回该版本内容 | 服务层缺口已复现；生产绑定验证可能拦截部分调用，不将服务层观察冒充完整Hermes绕过 |
| 人物回收 | Person标记trashed，子Profile不改；Agent listProfiles仅看Profile自身标记，仍可能列出该人物的资料 | 当前列表对父容器删除状态缺检查，实际服务列表已复现；getActiveCareerContext已有父人物状态校验，不能说所有入口都失效 |
| 资料库单个canonical正文条目 | 从structuredFacts移除并经saveProfile保存后，当前详情、搜索、重新读取均不再出现；回收站保留副本 | 本次正向对照正常。Repository的removeDeletedMirrors会清理旧镜像，未复现“删了又回当前资料” |
| 显式恢复岗位 | ID移出回收站，原记录恢复可见，数量不增加 | 对照正常；不能把自动恢复当作已有默认策略 |

旧对话、来源材料、已生成简历和历史Revision可能包含删除前快照，保留这些历史不等同于把被删除条目当作当前事实。此次没有穷举全部字段、所有写入并发或永久删除关联链，也没有做跨账户安全审计。

## 3. 验证与原始证据

手动观察文件：`tests/audit/recycleIsolation.observations.ts`；独立配置：`vitest.recycle-audit.config.ts`，不加入默认Unit测试集合。用例断言的是当前实际行为；**9项观察通过意味着缺陷成功复现，不意味着产品修复或隔离通过**。

- `pnpm exec vitest run --config vitest.recycle-audit.config.ts`：最终9项退出0；结果见 `verified-observations-tests.json` 和 `observations.json`。
- `pnpm typecheck`：最终退出0（typecheck-verified.log）。初次审计夹具expectedVersion应为expectedRevision，已按真实Repository契约修正并重新验证全部9项，没有删断言。
- 审计配置及用例的ESLint退出0，git diff --check通过。
- 初始配置使用mergeConfig合并include，意外包含默认测试范围，发现后立即终止exit1，没有使用结果作通过结论。已改为显式覆盖include，之后只运行上述9项；原日志保留。本轮未修其他测试报错或修改业务源码。
- 没有Mock Repository写入；时序案例只在parse返回处插入真实moveJobToRecycleBin，以确定性重现删除时点。每条用例使用独立测试DB，无需模型猜测或消耗外部额度。

机器结论：`../quality/recycle-isolation-audit-2026-11-09/audit-summary.json`，状态 `DEFECTS_REPRODUCED_NOT_FIXED`。

## 4. 有界修复建议及需要分开的语义

建议后续独立Hotfix先统一“当前可用实体”的读取与写入检查：Agent列表/详情/上下文/去重/最终回执应读同一生命周期规则；写入事务中重验删除状态，避免仅靠提前读取或旧updatedAt。回收站、备份与显式历史查询仍可读取原始记录，不能简单把所有底层get一律过滤，导致无法恢复或破坏历史引用。

相同JD命中回收站记录时，应明确告知“这个岗位在回收站”，不能直接报告“已在岗位列表保存”。**恢复旧岗位还是另存新岗位是单独的数据语义选择**，本轮没有自动恢复、删除旧listing/ledger或创建第二条正式岗位。保守方案为保留本次JD并提供业务选择，用户明确选择后执行，再核对当前可见性。

同时，人物/资料/简历应对当前读取与显式历史读取作一致区分；不能借修复岗位而重写整个Runtime、清空历史或降低确认/版本保护。

下一步：用户选择是否执行该独立生命周期隔离Hotfix；当前不要把岗位回收场景当作已通过，也不自动进入C或全量发布门禁。

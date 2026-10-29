/** Frozen anonymous regression scenarios. These are mapped executable safety oracles,
 * not forty independent real-model quality measurements. Skills Quality will A/B them. */
const core = "tests/unit/p51-core-workflow.test.ts";
const material = "tests/unit/p512-material-intake.test.ts";
const intelligence = "tests/unit/p51-core-02-intelligence.test.ts";
const composition = "tests/unit/resumeCompositionConfirmedWriteP45c12.test.ts";
const routing = "tests/unit/p45c1c14-career-workflow-transactional-closure.test.ts";
type Category = "intent" | "intake" | "job" | "resume_safety" | "fit" | "recovery";
type Scenario = { id: string; category: Category; userTurn: string; invariant: string; testFile: string; testTitle: string };
const groups: Array<[Category, Array<[string, string, string, string]>]> = [
  ["intent", [
    ["把这个证书加到资料库", "Profile requires review and confirmation", material, "writes Profile only after explicit review"],
    ["这个岗位适合我吗", "Comparison returns requirement evidence without Profile write", core, "returns each requirement's real evidence"],
    ["帮我改这份简历", "General updates require selected target", composition, "keeps update_existing behind an explicit user selection"],
    ["根据这份JD改简历", "External target remains tailoring", routing, "keeps direct external targetText on tailor semantics"],
    ["生成通用简历", "Host owns confirmed composition", composition, "executes the confirmed checkpoint once"],
    ["[仅上传附件，无文字]", "Material classification remains provisional", material, "stores all 12 Hermes material kinds"],
    ["[上传混合材料] 整理一下", "Classification must have source-backed evidence", material, "stores all 12 Hermes material kinds"],
    ["继续刚才的任务", "Resume reuses durable checkpoint, not a new write", composition, "keeps a runtime composition proposal actionable"]
  ]],
  ["intake", [
    ["[resume.docx] 导入", "Existing DOCX parser is reused", material, "uses the real existing DOCX parser"],
    ["[certificate.txt] 这是我的证书", "No automatic formal facts", material, "writes Profile only after explicit review"],
    ["[award.png] 这是获奖材料", "Vision eligibility before sending image", material, "never sends an image to an unverified Vision provider"],
    ["[job.txt] 分析岗位", "Attachment and paste share Job analyzer", material, "routes attached JD plus pasted JD"],
    ["[mixed.json] 整理材料", "Shared source-block adapter", material, "extracts non-resume JSON"],
    ["再次上传同一个文件", "Hash identity is idempotent", material, "reuses exact hash identity per session"],
    ["另一个会话读取刚才的附件", "Cross-session attachment denied", material, "restores the exact raw file after reload and rejects a different session"],
    ["刷新后继续附件任务", "Durable queue restores into Hermes", material, "persists a Hermes attachment queue through reload"]
  ]],
  ["job", [
    ["保存这个新岗位", "One Job with raw source", core, "saves idempotently, versions a changed JD"],
    ["再保存相同JD", "Exact duplicate reuses ID", core, "saves idempotently, versions a changed JD"],
    ["岗位要求更新了", "Keep previous raw snapshots", core, "saves idempotently, versions a changed JD"],
    ["只分析不要保存", "No business persistence", core, "analyzes without any persistence"],
    ["[JD未给公司与职位]", "Unknown identity is explicit", core, "analyzes without any persistence"],
    ["复用这个版本的岗位分析", "Exact snapshots reuse analysis", intelligence, "reuses exact versioned snapshots"],
    ["别重复解析刚才的JD", "Canonical graph source/IDs retained", intelligence, "preserves canonical requirement identity"],
    ["岗位变化后提交旧提案", "Job-version CAS rejects", core, "rejects a composition checkpoint after the target Job version changes"]
  ]],
  ["resume_safety", [
    ["只改一条经历", "Field patch retains typed structure", "tests/unit/tailoringFieldSafety.test.ts", "builds a claim whose formal target is only the typed field patch"],
    ["用户编辑后采用旧建议", "Stale source cannot overwrite", core, "rejects a stale general proposal"],
    ["切换目标后采用原建议", "Old proposals cannot cross selected Job/Resume targets", "tests/unit/core02SessionCheckpoint.test.ts", "does not resume an old tailoring proposal after switching the selected"],
    ["只切换模板", "Presentation does not mutate body/revision", "tests/unit/presentationConfig.test.ts", "switches to new template ids without mutating resume content"],
    ["帮我写提升了999%", "Unsupported claims cannot pass quality gate", intelligence, "does not let attractive prose offset"],
    ["把参与改成独立负责", "Fact Guard prevents ungrounded composition", routing, "uses the Fact Guard fallback"],
    ["确认新证书后更新简历", "Profile revision invalidates prior checkpoint", composition, "rejects a same-checkpoint retry after the bound Profile revision changes"],
    ["加入未经确认的事实", "Pending facts excluded from retrieval", intelligence, "keeps unconfirmed and high-risk provenance out"]
  ]],
  ["fit", [
    ["我有直接证据吗", "Evidence IDs are grounded", intelligence, "preserves canonical requirement identity"],
    ["经历相近但行业不同", "Transferable is distinct from direct", "tests/unit/jobOptimizationV2.test.ts", "semantic rerank accepts recalled IDs"],
    ["资料没写Kubernetes是否就是不会", "Absence remains unknown", intelligence, "does not infer candidate Kubernetes"],
    ["没有必备证书怎么办", "Hard gaps never generate claims", "tests/unit/jobOptimizationV2.test.ts", "does not hide hard gaps"]
  ]],
  ["recovery", [
    ["取消保存", "No formal write after cancel", core, "does not save without Host confirmation"],
    ["Provider超时", "Checkpoint recoverable; no content writes", composition, "keeps a transport-failed checkpoint recoverable"],
    ["MCP调用失败", "Tool failure stays distinct from Provider", core, "keeps MCP failure distinct"],
    ["重复点击确认", "One branch and revision", composition, "executes the confirmed checkpoint once"]
  ]]
];
export const core02EvalCases: Scenario[] = groups.flatMap(([category, rows]) => rows.map(([userTurn, invariant, testFile, testTitle], index) => ({
  id: `C02-${category}-${String(index + 1).padStart(2, "0")}`, category, userTurn, invariant, testFile, testTitle
})));

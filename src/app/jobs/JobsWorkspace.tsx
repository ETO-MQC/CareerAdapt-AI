"use client";

import { nanoid } from "nanoid";
import { useEffect, useMemo, useState } from "react";
import { invokeStageBAi, invokeStructuredAi } from "@/ai/client";
import { promptVersions } from "@/ai/prompts/versions";
import { mapJobDraftToJobDescription } from "@/domain/mappers/jobDraftMapper";
import {
  EvidenceMatcherOutputSchema,
  JdAnalyzerOutputSchema,
  MatchEvaluationSchema,
  type JdAnalyzerOutput,
  type JdAnalyzerRequirement,
  type JobAnalysisDraft,
  type JobDescription,
  type CareerProfile,
  type MatchEvaluation,
  type MatchEvidenceRef,
  type RawInputDocument,
  type RequirementMatch
} from "@/domain/schemas";
import {
  checkRequirementMatchStale,
  createRuleRequirementMatches,
  evidenceRefKey,
  recallCandidatesForRequirement,
  resolveEffectiveMatch,
  withResolvedEffectiveMatch
} from "@/domain/match/matcher";
import { WorkspaceEmptyState, WorkspaceErrorState, WorkspaceLoadingState } from "@/components/workspace/WorkspaceStates";
import { hashText, redactSensitiveTextForModel, stableHashText } from "@/services/security/text";
import { RevisionConflictError, WorkspaceRepository } from "@/services/storage/repositories";
import { useWorkspace } from "@/services/workspace/useWorkspace";

const repository = new WorkspaceRepository();

export function JobsWorkspace() {
  const workspace = useWorkspace(repository);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [rawText, setRawText] = useState("");
  const [rawInput, setRawInput] = useState<RawInputDocument | undefined>();
  const [draft, setDraft] = useState<JobAnalysisDraft | undefined>();
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed" | "conflict">("idle");
  const [message, setMessage] = useState<string | undefined>();
  const [loadedDraft, setLoadedDraft] = useState(false);
  const [matches, setMatches] = useState<RequirementMatch[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | undefined>();
  const [manualLevel, setManualLevel] = useState<MatchEvaluation["matchLevel"]>("weak");
  const [manualRisk, setManualRisk] = useState<MatchEvaluation["riskLevel"]>("medium");
  const [manualReason, setManualReason] = useState("");
  const [manualEvidenceKey, setManualEvidenceKey] = useState("");

  useEffect(() => {
    let active = true;

    async function loadDraft() {
      const latest = await repository.getLatestJobAnalysisDraft();
      if (!active || !latest) {
        setLoadedDraft(true);
        return;
      }

      const raw = await repository.getRawInput(latest.rawInputId);
      if (!active) {
        return;
      }

      setDraft(latest);
      setTitle(latest.title);
      setCompany(latest.company);
      setRawInput(raw);
      setRawText(raw?.rawText ?? "");
      setLoadedDraft(true);
    }

    void loadDraft();

    return () => {
      active = false;
    };
  }, []);

  const redactionPreview = useMemo(() => redactSensitiveTextForModel(rawText), [rawText]);
  const output = draft?.analyzerOutput ?? (draft ? { requirements: draft.manualRequirements, riskNotes: draft.riskNotes } : undefined);
  const profile = workspace.status === "ready" ? workspace.profiles[0] : undefined;
  const jobs = workspace.status === "ready" ? workspace.jobs : [];
  const selectedJob = jobs[0];

  useEffect(() => {
    let active = true;

    async function loadMatches() {
      if (!profile || !selectedJob) {
        setMatches([]);
        return;
      }

      const stored = await repository.listRequirementMatches(profile.id, selectedJob.id);
      if (active) {
        setMatches(stored);
        setSelectedMatchId((current) => current ?? stored[0]?.id);
      }
    }

    void loadMatches();

    return () => {
      active = false;
    };
  }, [profile, selectedJob]);

  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? matches[0];
  const selectedRequirement = selectedJob?.requirements.find((requirement) => requirement.id === selectedMatch?.requirementId);
  const manualCandidates = profile && selectedRequirement ? recallCandidatesForRequirement(profile, selectedRequirement) : [];

  async function startImport() {
    if (!title.trim() || !company.trim() || !rawText.trim()) {
      setMessage("请填写岗位名称、公司名称并粘贴JD原文。");
      return;
    }

    const now = new Date().toISOString();
    const inputHash = await hashText(`${title}\n${company}\n${rawText}`);
    const nextRawInput: RawInputDocument = {
      id: rawInput?.id ?? `raw-${nanoid(10)}`,
      kind: "job_jd",
      rawText,
      inputHash,
      title: `${company} / ${title}`,
      createdAt: rawInput?.createdAt ?? now,
      updatedAt: now
    };

    await repository.saveRawInput(nextRawInput);

    const nextDraft: JobAnalysisDraft = {
      id: draft?.id ?? `job-draft-${nanoid(10)}`,
      rawInputId: nextRawInput.id,
      revision: draft?.revision ?? 0,
      title,
      company,
      status: "privacy_pending",
      promptVersion: promptVersions.jdAnalyzer,
      attemptCount: draft?.attemptCount ?? 0,
      analyzerOutput: draft?.analyzerOutput,
      manualRequirements: draft?.manualRequirements ?? [],
      riskNotes: draft?.riskNotes ?? [],
      createdAt: draft?.createdAt ?? now,
      updatedAt: now
    };

    const saved = draft
      ? await repository.saveJobAnalysisDraftRevision(nextDraft, draft.revision)
      : await repository.createJobAnalysisDraft(nextDraft);

    setRawInput(nextRawInput);
    setDraft(saved);
    setMessage("原始JD已保存。请确认是否发送脱敏内容给外部模型。");
  }

  async function analyzeWithAi() {
    if (!draft || !rawInput) {
      return;
    }

    setMessage("正在解析JD，服务端会先脱敏并校验模型输出。");
    const analyzingDraft = await saveDraft({ ...draft, title, company, status: "analyzing" });

    const result = await invokeStageBAi({
      task: "jd-analyzer",
      businessInput: {
        title,
        company,
        rawText: rawInput.rawText,
        inputHash: rawInput.inputHash
      },
      outputSchema: JdAnalyzerOutputSchema
    });

    await repository.saveAiLogs([result.log]);

    if (!result.ok) {
      const failedAttempt = analyzingDraft.attemptCount + 1;
      const manual = failedAttempt >= 2 || result.errorCode !== "validation_failed";
      const fallbackOutput = createManualJdOutput(rawInput.rawText, title, company);
      const saved = await saveDraft({
        ...analyzingDraft,
        status: manual ? "manual_mode" : "error",
        attemptCount: failedAttempt,
        manualRequirements: manual ? fallbackOutput.requirements : analyzingDraft.manualRequirements,
        riskNotes: fallbackOutput.riskNotes,
        saveError: result.errorCode
      });
      setDraft(saved);
      setMessage(manual ? "AI不可用或校验失败，已进入JD手动分类模式。" : "AI解析失败，可重试或改用手动分类。");
      return;
    }

    const saved = await saveDraft({
      ...analyzingDraft,
      status: "ai_validated",
      attemptCount: analyzingDraft.attemptCount + 1,
      promptVersion: result.promptVersion,
      analyzerOutput: result.data,
      riskNotes: result.data.riskNotes,
      saveError: undefined
    });
    setDraft(saved);
    setMessage("JD解析完成。请核对原文依据并确认要求。");
  }

  async function enterManualMode() {
    if (!draft || !rawInput) {
      return;
    }

    const fallbackOutput = createManualJdOutput(rawInput.rawText, title, company);
    const saved = await saveDraft({
      ...draft,
      status: "manual_mode",
      manualRequirements: draft.manualRequirements.length > 0 ? draft.manualRequirements : fallbackOutput.requirements,
      riskNotes: draft.riskNotes
    });
    setDraft(saved);
    setMessage("已进入手动分类模式，外部模型不会被调用。");
  }

  async function toggleRequirement(requirementId: string, checked: boolean) {
    if (!draft || !output) {
      return;
    }

    const nextOutput: JdAnalyzerOutput = {
      ...output,
      requirements: output.requirements.map((requirement) =>
        requirement.id === requirementId
          ? {
              ...requirement,
              confirmedByUser: checked,
              needsConfirmation: !checked
            }
          : requirement
      )
    };

    const saved = await saveDraft({
      ...draft,
      status: draft.status === "ai_validated" ? "editing" : draft.status,
      analyzerOutput: draft.analyzerOutput ? nextOutput : draft.analyzerOutput,
      manualRequirements: draft.analyzerOutput ? draft.manualRequirements : nextOutput.requirements,
      riskNotes: nextOutput.riskNotes
    });
    setDraft(saved);
  }

  async function removeRequirement(requirementId: string) {
    if (!draft || !output) {
      return;
    }

    const confirmed = window.confirm("删除后该要求不会进入正式岗位数据，但原始JD和草稿历史仍会保留。确认删除？");
    if (!confirmed) {
      return;
    }

    const nextOutput: JdAnalyzerOutput = {
      ...output,
      requirements: output.requirements.filter((requirement) => requirement.id !== requirementId)
    };
    const saved = await saveDraft({
      ...draft,
      status: "editing",
      analyzerOutput: draft.analyzerOutput ? nextOutput : draft.analyzerOutput,
      manualRequirements: draft.analyzerOutput ? draft.manualRequirements : nextOutput.requirements
    });
    setDraft(saved);
  }

  async function commitJob() {
    if (!draft || !rawInput) {
      return;
    }

    try {
      setSaveStatus("saving");
      const jobDescription = mapJobDraftToJobDescription({ draft, rawInput });
      const result = await repository.commitJobDraft({
        draftId: draft.id,
        expectedRevision: draft.revision,
        commitId: `commit-job-${draft.id}`,
        jobDescription
      });
      setDraft({
        ...draft,
        status: "committed",
        revision: draft.revision + (result.idempotent ? 0 : 1),
        committedJobId: result.jobDescription.id,
        committedAt: new Date().toISOString()
      });
      setSaveStatus("saved");
      setMessage(`已写入正式岗位数据：${result.jobDescription.company} / ${result.jobDescription.title}`);
    } catch (error) {
      setSaveStatus(error instanceof RevisionConflictError ? "conflict" : "failed");
      setMessage(error instanceof RevisionConflictError ? "提交失败：草稿版本已变化，请刷新后重试。" : "提交失败，请至少确认一条可定位原文的岗位要求。");
    }
  }

  async function saveDraft(nextDraft: JobAnalysisDraft) {
    setSaveStatus("saving");
    try {
      const saved = await repository.saveJobAnalysisDraftRevision(nextDraft, nextDraft.revision);
      setSaveStatus("saved");
      return saved;
    } catch (error) {
      setSaveStatus(error instanceof RevisionConflictError ? "conflict" : "failed");
      throw error;
    }
  }

  async function runRuleMatcher() {
    if (!profile || !selectedJob) {
      setMessage("请先准备正式职业母档案和正式岗位数据。");
      return;
    }

    const nextMatches = createRuleRequirementMatches({ profile, job: selectedJob });
    const saved = await repository.saveRuleRequirementMatches({
      profile,
      job: selectedJob,
      matches: nextMatches
    });
    setMatches(saved);
    setSelectedMatchId(saved[0]?.id);
    setMessage("C1规则匹配完成：只使用正式母档案中已确认事实。");
  }

  async function runAiEvidenceMatcher() {
    if (!profile || !selectedJob || matches.length === 0) {
      setMessage("请先运行C1规则匹配。");
      return;
    }

    const nextMatches: RequirementMatch[] = [];

    for (const match of matches) {
      const stale = checkRequirementMatchStale(match, { profile, job: selectedJob });
      const requirement = selectedJob.requirements.find((item) => item.id === match.requirementId);
      if (stale.isStale || !requirement) {
        nextMatches.push({ ...match, isStale: true });
        continue;
      }

      const candidates = recallCandidatesForRequirement(profile, requirement);
      const result = await invokeStructuredAi({
        task: "evidence-matcher",
        businessInput: {
          profileId: profile.id,
          jobId: selectedJob.id,
          profileVersion: profile.version,
          jobVersion: selectedJob.updatedAt,
          matcherVersion: match.matcherVersion,
          candidateSetHash: match.candidateSetHash,
          requirement: {
            id: requirement.id,
            description: requirement.description,
            sourceQuote: requirement.sourceSpan.text,
            hardConstraint: requirement.hardConstraint,
            keywords: requirement.keywords
          },
          candidates: candidates.map((candidate) => ({
            evidenceRef: candidate.ref,
            searchText: candidate.searchText
          }))
        },
        outputSchema: EvidenceMatcherOutputSchema
      });

      await repository.saveAiLogs([result.log]);

      if (!result.ok) {
        nextMatches.push(match);
        continue;
      }

      const evaluation = result.data.evaluations.find((item) => item.requirementId === requirement.id);
      if (!evaluation) {
        nextMatches.push(match);
        continue;
      }

      const aiEvaluation = MatchEvaluationSchema.parse({
        source: "ai",
        matchLevel: evaluation.matchLevel,
        riskLevel: evaluation.riskLevel,
        risks: evaluation.risks,
        evidenceRefs: evaluation.evidenceRefs,
        explanation: evaluation.explanation,
        evaluatedAt: new Date().toISOString()
      }) as MatchEvaluation & { source: "ai" };

      nextMatches.push(withResolvedEffectiveMatch({
        ...match,
        aiEvaluation,
        updatedAt: new Date().toISOString()
      }));
    }

    const saved = await repository.saveAiRequirementMatches({
      profile,
      job: selectedJob,
      matches: nextMatches
    });
    setMatches(saved);
    setMessage("C1 AI解释完成。AI只生成 aiEvaluation，规则层与人工覆盖未被修改。");
  }

  async function saveManualOverride(match: RequirementMatch) {
    if (!profile || !selectedJob) {
      return;
    }

    if (!manualReason.trim()) {
      setMessage("人工覆盖必须填写说明。");
      return;
    }

    const evidenceRefs = manualLevel === "none" ? [] : selectedManualEvidenceRef();
    if (manualLevel !== "none" && evidenceRefs.length === 0) {
      setMessage("人工覆盖为 strong、weak 或 transferable 时必须选择至少一条正式事实。");
      return;
    }

    const nextEvaluation = MatchEvaluationSchema.parse({
      source: "manual",
      matchLevel: manualLevel,
      riskLevel: manualRisk,
      risks: manualRisk === "low" ? [] : ["low_confidence"],
      evidenceRefs,
      explanation: manualReason,
      evaluatedAt: new Date().toISOString()
    }) as MatchEvaluation & { source: "manual" };

    const saved = await repository.saveManualMatchOverride({
      profile,
      job: selectedJob,
      matchId: match.id,
      operationId: `manual-${stableHashText(JSON.stringify({
        matchId: match.id,
        manualLevel,
        manualRisk,
        manualReason,
        manualEvidenceKey
      }))}`,
      nextEvaluation,
      reason: manualReason
    });

    setMatches((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    setManualReason("");
    setMessage("人工覆盖已保存，并记录修改前后结果。");
  }

  function selectedManualEvidenceRef(): MatchEvidenceRef[] {
    const candidate = manualCandidates.find((item) => evidenceRefKey(item.ref) === manualEvidenceKey);
    return candidate ? [candidate.ref] : [];
  }

  if (workspace.status === "loading" || !loadedDraft) {
    return (
      <main className="page-shell">
        <WorkspaceLoadingState />
      </main>
    );
  }

  if (workspace.status === "error") {
    return (
      <main className="page-shell">
        <WorkspaceErrorState message={workspace.error} />
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="page-title">
        <p className="eyebrow">Stage B2 / JD Analyzer</p>
        <h1>岗位JD解析</h1>
        <p>保存原始JD后再解析。每条要求保留原文依据、定性置信度和优先级，不输出岗位匹配总分。</p>
      </section>

      {workspace.status === "empty" ? <WorkspaceEmptyState /> : null}
      {message ? <section className="notice">{message}</section> : null}

      <section className="stage-grid">
        <article className="panel">
          <h2>1. 粘贴岗位JD</h2>
          <div className="form-grid">
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="岗位名称" />
            <input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="公司名称" />
          </div>
          <textarea className="textarea" value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder="粘贴岗位JD原文..." />
          <div className="action-row">
            <button className="primary-button" onClick={startImport}>
              保存原始JD
            </button>
            <span className={`save-status save-status-${saveStatus}`}>自动保存：{saveStatus}</span>
          </div>
        </article>

        {draft?.status === "privacy_pending" ? (
          <article className="panel">
            <h2>2. 外部模型与隐私说明</h2>
            <p>系统会在服务端默认脱敏手机号、邮箱、身份证号和精确地址后再发送给外部模型。</p>
            <p>本次脱敏预览：{redactionPreview.redactions.length === 0 ? "未发现需脱敏内容" : redactionPreview.redactions.map((item) => `${item.type} x${item.count}`).join(" / ")}</p>
            <div className="action-row">
              <button className="primary-button" onClick={analyzeWithAi}>
                同意脱敏并解析
              </button>
              <button className="secondary-button" onClick={enterManualMode}>
                拒绝，手动分类
              </button>
            </div>
          </article>
        ) : null}
      </section>

      {output ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>岗位要求草稿</h2>
              <p>确认后的要求才会进入正式岗位数据。删除前会提示影响。</p>
            </div>
            <button className="primary-button" onClick={commitJob}>
              提交正式岗位
            </button>
          </div>
          <div className="requirement-list">
            {output.requirements.map((requirement) => (
              <RequirementReviewRow key={requirement.id} requirement={requirement} onToggle={toggleRequirement} onRemove={removeRequirement} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>当前正式岗位数据</h2>
        <div className="job-list">
          {jobs.length > 0 ? (
            jobs.map((job) => (
              <article key={job.id}>
                <h3>
                  {job.company} / {job.title}
                </h3>
                <p>{job.requirements.length} 条要求，来源：{job.source}</p>
              </article>
            ))
          ) : (
            <p>暂无正式岗位数据。</p>
          )}
        </div>
      </section>

      {profile && selectedJob ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>C1 经历匹配与差距诊断</h2>
              <p>仅使用正式职业母档案中已确认事实；页面展示统一由 resolveEffectiveMatch 计算的有效结果。</p>
            </div>
            <div className="action-row">
              <button className="primary-button" onClick={runRuleMatcher}>
                运行C1规则匹配
              </button>
              <button className="secondary-button" onClick={runAiEvidenceMatcher} disabled={matches.length === 0}>
                运行AI解释
              </button>
            </div>
          </div>

          {matches.length === 0 ? (
            <p>尚未生成匹配结果。请先运行C1规则匹配。</p>
          ) : (
            <div className="match-layout">
              <div className="match-list">
                {matches.map((match) => {
                  const effective = resolveEffectiveMatch(match);
                  const stale = checkRequirementMatchStale(match, { profile, job: selectedJob });
                  return (
                    <button
                      className={`match-row ${match.id === selectedMatch?.id ? "match-row-active" : ""}`}
                      key={match.id}
                      onClick={() => setSelectedMatchId(match.id)}
                    >
                      <strong>{selectedJob.requirements.find((item) => item.id === match.requirementId)?.description}</strong>
                      <span>{effective.matchLevel} / {effective.riskLevel} / {effective.source}{stale.isStale ? " / stale" : ""}</span>
                    </button>
                  );
                })}
              </div>

              {selectedMatch ? (
                <MatchDetail
                  match={selectedMatch}
                  profile={profile}
                  job={selectedJob}
                  manualLevel={manualLevel}
                  manualRisk={manualRisk}
                  manualReason={manualReason}
                  manualEvidenceKey={manualEvidenceKey}
                  manualCandidates={manualCandidates}
                  onManualLevel={setManualLevel}
                  onManualRisk={setManualRisk}
                  onManualReason={setManualReason}
                  onManualEvidence={setManualEvidenceKey}
                  onSaveManual={() => saveManualOverride(selectedMatch)}
                />
              ) : null}
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}

function MatchDetail({
  match,
  profile,
  job,
  manualLevel,
  manualRisk,
  manualReason,
  manualEvidenceKey,
  manualCandidates,
  onManualLevel,
  onManualRisk,
  onManualReason,
  onManualEvidence,
  onSaveManual
}: {
  match: RequirementMatch;
  profile: CareerProfile;
  job: JobDescription;
  manualLevel: MatchEvaluation["matchLevel"];
  manualRisk: MatchEvaluation["riskLevel"];
  manualReason: string;
  manualEvidenceKey: string;
  manualCandidates: ReturnType<typeof recallCandidatesForRequirement>;
  onManualLevel: (level: MatchEvaluation["matchLevel"]) => void;
  onManualRisk: (risk: MatchEvaluation["riskLevel"]) => void;
  onManualReason: (reason: string) => void;
  onManualEvidence: (key: string) => void;
  onSaveManual: () => void;
}) {
  const effective = resolveEffectiveMatch(match);
  const stale = checkRequirementMatchStale(match, { profile, job });
  const requirement = job.requirements.find((item) => item.id === match.requirementId);

  return (
    <article className="match-detail">
      {stale.isStale ? <div className="warning-box">该匹配已过期，需要重新运行C1后才能用于后续阶段。</div> : null}
      <h3>{requirement?.description}</h3>
      <p><strong>岗位原文：</strong>{match.requirementQuote.text}</p>
      <p><strong>有效结果：</strong>{effective.matchLevel} / {effective.riskLevel} / 来源：{effective.source}</p>
      <p><strong>解释：</strong>{effective.explanation}</p>
      <div className="evidence-list">
        {effective.evidenceRefs.length > 0 ? effective.evidenceRefs.map((ref) => (
          <p key={evidenceRefKey(ref)}><strong>事实依据：</strong>{ref.factText}<br /><small>{ref.factQuote}</small></p>
        )) : <p>当前无证据。</p>}
      </div>
      <div className="manual-override">
        <h4>人工覆盖</h4>
        <div className="form-grid">
          <select value={manualLevel} onChange={(event) => onManualLevel(event.target.value as MatchEvaluation["matchLevel"])}>
            <option value="strong">strong</option>
            <option value="weak">weak</option>
            <option value="transferable">transferable</option>
            <option value="none">none</option>
          </select>
          <select value={manualRisk} onChange={(event) => onManualRisk(event.target.value as MatchEvaluation["riskLevel"])}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </div>
        {manualLevel !== "none" ? (
          <select value={manualEvidenceKey} onChange={(event) => onManualEvidence(event.target.value)}>
            <option value="">选择正式事实</option>
            {manualCandidates.map((candidate) => (
              <option key={evidenceRefKey(candidate.ref)} value={evidenceRefKey(candidate.ref)}>
                {candidate.ref.factText}
              </option>
            ))}
          </select>
        ) : null}
        <textarea className="textarea small-textarea" value={manualReason} onChange={(event) => onManualReason(event.target.value)} placeholder="填写人工覆盖说明..." />
        <button className="secondary-button" onClick={onSaveManual}>保存人工覆盖</button>
      </div>
    </article>
  );
}

function RequirementReviewRow({
  requirement,
  onToggle,
  onRemove
}: {
  requirement: JdAnalyzerRequirement;
  onToggle: (requirementId: string, checked: boolean) => void;
  onRemove: (requirementId: string) => void;
}) {
  return (
    <div className="review-row">
      <input
        type="checkbox"
        checked={requirement.confirmedByUser}
        disabled={!requirement.sourceSpan}
        onChange={(event) => onToggle(requirement.id, event.target.checked)}
      />
      <span>
        <strong>{requirement.description}</strong>
        <small>
          {requirement.category} / {requirement.priority} / {requirement.confidenceLevel} / 原文：
          {requirement.sourceSpan?.text ?? "未定位，待确认"}
        </small>
      </span>
      <button className="secondary-button compact" onClick={() => onRemove(requirement.id)}>
        删除
      </button>
    </div>
  );
}

function createManualJdOutput(rawText: string, title: string, company: string): JdAnalyzerOutput {
  const now = new Date().toISOString();
  const sourceQuote = rawText.split(/[。；;\n]/).find(Boolean)?.slice(0, 120) || rawText.slice(0, 120);
  const start = rawText.indexOf(sourceQuote);
  const sourceSpan = start >= 0 ? { start, end: start + sourceQuote.length, text: sourceQuote } : undefined;

  return {
    title: {
      value: title,
      sourceQuote,
      sourceSpan,
      confidenceLevel: "medium",
      confidenceReason: "岗位名称来自用户填写。",
      needsConfirmation: false
    },
    company: {
      value: company,
      sourceQuote,
      sourceSpan,
      confidenceLevel: "medium",
      confidenceReason: "公司名称来自用户填写。",
      needsConfirmation: false
    },
    requirements: [
      {
        id: `manual-req-${nanoid(8)}`,
        category: "risk_or_uncertain",
        description: sourceQuote || "待补充岗位要求",
        priority: "uncertain",
        hardConstraint: false,
        sourceQuote,
        sourceSpan,
        keywords: [],
        confidenceLevel: "low",
        confidenceReason: "手动模式默认条目，需要用户分类确认。",
        needsConfirmation: true,
        confirmedByUser: false,
        createdAt: now,
        updatedAt: now
      }
    ],
    riskNotes: []
  };
}

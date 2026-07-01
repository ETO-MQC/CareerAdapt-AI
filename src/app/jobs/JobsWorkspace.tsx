"use client";

import { nanoid } from "nanoid";
import { useEffect, useMemo, useState } from "react";
import { invokeStageBAi } from "@/ai/client";
import { promptVersions } from "@/ai/prompts/versions";
import { mapJobDraftToJobDescription } from "@/domain/mappers/jobDraftMapper";
import {
  JdAnalyzerOutputSchema,
  type JdAnalyzerOutput,
  type JdAnalyzerRequirement,
  type JobAnalysisDraft,
  type RawInputDocument
} from "@/domain/schemas";
import { WorkspaceEmptyState, WorkspaceErrorState, WorkspaceLoadingState } from "@/components/workspace/WorkspaceStates";
import { hashText, redactSensitiveTextForModel } from "@/services/security/text";
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

  const jobs = workspace.status === "ready" ? workspace.jobs : [];

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
    </main>
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

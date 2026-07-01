"use client";

import { nanoid } from "nanoid";
import { useEffect, useMemo, useState } from "react";
import { invokeStageBAi } from "@/ai/client";
import { promptVersions } from "@/ai/prompts/versions";
import { mapProfileDraftToCareerProfile } from "@/domain/mappers/profileDraftMapper";
import {
  ProfileBuilderOutputSchema,
  type ProfileBuilderFact,
  type ProfileBuilderOutput,
  type ProfileImportDraft,
  type RawInputDocument
} from "@/domain/schemas";
import { WorkspaceEmptyState, WorkspaceErrorState, WorkspaceLoadingState } from "@/components/workspace/WorkspaceStates";
import { hashText, redactSensitiveTextForModel } from "@/services/security/text";
import { useWorkspace } from "@/services/workspace/useWorkspace";
import { RevisionConflictError, WorkspaceRepository } from "@/services/storage/repositories";

const repository = new WorkspaceRepository();

export function ProfileWorkspace() {
  const workspace = useWorkspace(repository);
  const [rawText, setRawText] = useState("");
  const [rawInput, setRawInput] = useState<RawInputDocument | undefined>();
  const [draft, setDraft] = useState<ProfileImportDraft | undefined>();
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed" | "conflict">("idle");
  const [message, setMessage] = useState<string | undefined>();
  const [loadedDraft, setLoadedDraft] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadDraft() {
      const latest = await repository.getLatestProfileImportDraft();
      if (!active || !latest) {
        setLoadedDraft(true);
        return;
      }

      const raw = await repository.getRawInput(latest.rawInputId);
      if (!active) {
        return;
      }

      setDraft(latest);
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
  const output = draft?.manualSections ?? draft?.builderOutput;

  async function startImport() {
    if (!rawText.trim()) {
      setMessage("请先粘贴简历文本。");
      return;
    }

    const now = new Date().toISOString();
    const inputHash = await hashText(rawText);
    const nextRawInput: RawInputDocument = {
      id: rawInput?.id ?? `raw-${nanoid(10)}`,
      kind: "resume_text",
      rawText,
      inputHash,
      title: "简历文本导入",
      createdAt: rawInput?.createdAt ?? now,
      updatedAt: now
    };

    await repository.saveRawInput(nextRawInput);
    const nextDraft: ProfileImportDraft = {
      id: draft?.id ?? `profile-draft-${nanoid(10)}`,
      rawInputId: nextRawInput.id,
      revision: draft?.revision ?? 0,
      status: "privacy_pending",
      promptVersion: promptVersions.profileBuilder,
      attemptCount: draft?.attemptCount ?? 0,
      builderOutput: draft?.builderOutput,
      manualSections: draft?.manualSections,
      pendingFacts: draft?.pendingFacts ?? [],
      createdAt: draft?.createdAt ?? now,
      updatedAt: now
    };

    if (draft) {
      const saved = await repository.saveProfileImportDraftRevision(nextDraft, draft.revision);
      setDraft(saved);
    } else {
      const saved = await repository.createProfileImportDraft(nextDraft);
      setDraft(saved);
    }

    setRawInput(nextRawInput);
    setMessage("原始输入已保存。请确认是否发送脱敏内容给外部模型。");
  }

  async function analyzeWithAi() {
    if (!draft || !rawInput) {
      return;
    }

    setMessage("正在解析，服务端会先脱敏并校验模型输出。");
    const analyzingDraft = await saveDraft({ ...draft, status: "analyzing" });

    const result = await invokeStageBAi({
      task: "profile-builder",
      businessInput: {
        rawText: rawInput.rawText,
        inputHash: rawInput.inputHash
      },
      outputSchema: ProfileBuilderOutputSchema
    });

    await repository.saveAiLogs([result.log]);

    if (!result.ok) {
      const failedAttempt = analyzingDraft.attemptCount + 1;
      const manual = failedAttempt >= 2 || result.errorCode !== "validation_failed";
      const fallbackOutput = createManualProfileOutput(rawInput.rawText);
      const saved = await saveDraft({
        ...analyzingDraft,
        status: manual ? "manual_mode" : "error",
        attemptCount: failedAttempt,
        manualSections: manual ? fallbackOutput : analyzingDraft.manualSections,
        saveError: result.errorCode
      });
      setMessage(manual ? "AI不可用或校验失败，已进入手动分类模式。" : "AI解析失败，可重试或改用手动分类。");
      setDraft(saved);
      return;
    }

    const saved = await saveDraft({
      ...analyzingDraft,
      status: "ai_validated",
      attemptCount: analyzingDraft.attemptCount + 1,
      promptVersion: result.promptVersion,
      builderOutput: result.data,
      pendingFacts: result.data.experiences.flatMap((experience) => experience.facts),
      saveError: undefined
    });
    setDraft(saved);
    setMessage("解析完成。请核对原文依据并勾选确认事实。");
  }

  async function enterManualMode() {
    if (!draft || !rawInput) {
      return;
    }

    const saved = await saveDraft({
      ...draft,
      status: "manual_mode",
      manualSections: draft.manualSections ?? draft.builderOutput ?? createManualProfileOutput(rawInput.rawText)
    });
    setDraft(saved);
    setMessage("已进入手动分类模式，外部模型不会被调用。");
  }

  async function toggleFact(factId: string, checked: boolean) {
    if (!draft || !output) {
      return;
    }

    const nextOutput: ProfileBuilderOutput = {
      ...output,
      experiences: output.experiences.map((experience) => ({
        ...experience,
        facts: experience.facts.map((fact) =>
          fact.id === factId
            ? {
                ...fact,
                confirmedByUser: checked,
                needsConfirmation: !checked
              }
            : fact
        )
      })),
      skills: output.skills.map((skill) =>
        skill.id === factId
          ? {
              ...skill,
              confirmedByUser: checked,
              needsConfirmation: !checked
            }
          : skill
      ),
      certificates: output.certificates.map((certificate) =>
        certificate.id === factId
          ? {
              ...certificate,
              confirmedByUser: checked,
              needsConfirmation: !checked
            }
          : certificate
      )
    };

    const saved = await saveDraft({
      ...draft,
      status: draft.status === "ai_validated" ? "editing" : draft.status,
      builderOutput: draft.builderOutput ? nextOutput : draft.builderOutput,
      manualSections: draft.manualSections ? nextOutput : draft.manualSections
    });
    setDraft(saved);
  }

  async function commitProfile() {
    if (!draft || !rawInput) {
      return;
    }

    try {
      setSaveStatus("saving");
      const profile = mapProfileDraftToCareerProfile({ draft, rawInput });
      const result = await repository.commitProfileDraft({
        draftId: draft.id,
        expectedRevision: draft.revision,
        commitId: `commit-profile-${draft.id}`,
        profile
      });
      setDraft({
        ...draft,
        status: "committed",
        revision: draft.revision + (result.idempotent ? 0 : 1),
        committedProfileId: result.profile.id,
        committedAt: new Date().toISOString()
      });
      setSaveStatus("saved");
      setMessage(`已写入正式职业母档案：${result.profile.name}`);
    } catch (error) {
      setSaveStatus(error instanceof RevisionConflictError ? "conflict" : "failed");
      setMessage(error instanceof RevisionConflictError ? "提交失败：草稿版本已变化，请刷新后重试。" : "提交失败，请检查已确认事实。");
    }
  }

  async function saveDraft(nextDraft: ProfileImportDraft) {
    setSaveStatus("saving");
    try {
      const saved = await repository.saveProfileImportDraftRevision(nextDraft, nextDraft.revision);
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

  const profile = workspace.status === "ready" ? workspace.profiles[0] : undefined;

  return (
    <main className="page-shell">
      <section className="page-title">
        <p className="eyebrow">Stage B1 / Career Master Profile</p>
        <h1>职业母档案解析</h1>
        <p>先保存原始输入，再通过服务端白名单任务解析。用户确认前，草稿事实不会写入正式母档案。</p>
      </section>

      {workspace.status === "empty" ? <WorkspaceEmptyState /> : null}
      {message ? <section className="notice">{message}</section> : null}

      <section className="stage-grid">
        <article className="panel">
          <h2>1. 粘贴简历文本</h2>
          <textarea
            className="textarea"
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            placeholder="粘贴简历、经历清单或已有简历文本..."
          />
          <div className="action-row">
            <button className="primary-button" onClick={startImport}>
              保存原文
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
              <h2>解析草稿与原文依据</h2>
              <p>只勾选你确认属实的事实；未定位原文的低置信度内容不会进入正式母档案。</p>
            </div>
            <button className="primary-button" onClick={commitProfile}>
              提交正式母档案
            </button>
          </div>
          <div className="timeline">
            {output.experiences.map((experience) => (
              <article key={experience.id}>
                <h3>
                  {experience.organization.value} / {experience.role.value}
                </h3>
                {experience.facts.map((fact) => (
                  <FactReviewRow key={fact.id} fact={fact} onToggle={toggleFact} />
                ))}
              </article>
            ))}
          </div>
          {output.unclassifiedBlocks.length > 0 ? (
            <div className="warning-box">
              <strong>未分类内容</strong>
              {output.unclassifiedBlocks.map((block) => (
                <p key={block}>{block}</p>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel">
        <h2>当前正式职业母档案</h2>
        {profile ? (
          <div className="timeline">
            <article>
              <h3>{profile.name}</h3>
              <p>{profile.basics.summary}</p>
              <p>
                {profile.experiences.length} 段经历 / {profile.skills.length} 项技能 / v{profile.version}
              </p>
            </article>
          </div>
        ) : (
          <p>暂无正式母档案。</p>
        )}
      </section>
    </main>
  );
}

function FactReviewRow({ fact, onToggle }: { fact: ProfileBuilderFact; onToggle: (factId: string, checked: boolean) => void }) {
  return (
    <label className="review-row">
      <input
        type="checkbox"
        checked={fact.confirmedByUser}
        disabled={!fact.sourceSpan}
        onChange={(event) => onToggle(fact.id, event.target.checked)}
      />
      <span>
        <strong>{fact.statement}</strong>
        <small>
          {fact.confidenceLevel} / {fact.confidenceReason} / 原文：{fact.sourceSpan?.text ?? "未定位，待确认"}
        </small>
      </span>
    </label>
  );
}

function createManualProfileOutput(rawText: string): ProfileBuilderOutput {
  const now = new Date().toISOString();
  const sourceQuote = rawText.split(/\r?\n/).find(Boolean)?.slice(0, 120) || rawText.slice(0, 120);
  const start = rawText.indexOf(sourceQuote);
  const sourceSpan = start >= 0 ? { start, end: start + sourceQuote.length, text: sourceQuote } : undefined;

  return {
    basics: {
      name: {
        value: "待确认用户",
        sourceQuote,
        sourceSpan,
        confidenceLevel: "low",
        confidenceReason: "手动模式默认占位，需要用户确认。",
        needsConfirmation: true
      },
      links: []
    },
    experiences: [
      {
        id: `manual-exp-${nanoid(8)}`,
        type: "other",
        organization: {
          value: "待分类经历",
          sourceQuote,
          sourceSpan,
          confidenceLevel: "low",
          confidenceReason: "手动模式默认分类。",
          needsConfirmation: true
        },
        role: {
          value: "待确认角色",
          sourceQuote,
          sourceSpan,
          confidenceLevel: "low",
          confidenceReason: "手动模式默认分类。",
          needsConfirmation: true
        },
        facts: [
          {
            id: `manual-fact-${nanoid(8)}`,
            statement: sourceQuote || "待补充事实",
            category: "experience",
            sourceQuote: sourceQuote || rawText,
            sourceSpan,
            confidenceLevel: "low",
            confidenceReason: "用户拒绝外部处理或AI不可用，需手动确认。",
            needsConfirmation: true,
            confirmedByUser: false,
            createdAt: now,
            updatedAt: now
          }
        ],
        tags: [],
        confirmedByUser: false,
        createdAt: now,
        updatedAt: now
      }
    ],
    skills: [],
    certificates: [],
    unclassifiedBlocks: []
  };
}

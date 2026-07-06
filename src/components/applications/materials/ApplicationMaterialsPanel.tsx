"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  editCoverLetterMaterial,
  generateApplicationEmailMaterial,
  generateCoverLetterMaterial,
  generateInterviewQuestionMaterial,
  generateSelfIntroductionMaterial,
  generateStarStoryMaterial,
  markApplicationMaterialCompleted,
  markApplicationMaterialNotNeeded,
  resolveApplicationFactGap,
  restoreApplicationMaterialVersion,
  updateInterviewQuestion,
  type ApplicationPreparationContext
} from "@/domain/applicationPreparation";
import {
  CoverLetterContentSchema,
  type ApplicationEmailMaterial,
  type ApplicationPreparationPack,
  type CoverLetterContent,
  type CoverLetterMaterial,
  type InterviewQuestionSetMaterial,
  type MaterialEvidenceRef,
  type MaterialLanguage,
  type SelfIntroductionMaterial,
  type StarStoryMaterial
} from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
import { WorkspaceRepository } from "@/services/storage/repositories";

const repository = new WorkspaceRepository();

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | {
      status: "ready";
      context: ApplicationPreparationContext;
      pack: ApplicationPreparationPack;
      corrupted: boolean;
    };

export function ApplicationMaterialsPanel({
  applicationId,
  onMessage,
  onChanged
}: {
  applicationId: string;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [coverLanguage, setCoverLanguage] = useState<MaterialLanguage>("zh");
  const [emailLanguage, setEmailLanguage] = useState<MaterialLanguage>("zh");
  const [emailTone, setEmailTone] = useState<"brief" | "formal">("brief");
  const [introLanguage, setIntroLanguage] = useState<MaterialLanguage>("zh");
  const [introDuration, setIntroDuration] = useState<30 | 60>(60);

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const loaded = await repository.loadApplicationPreparationPack(applicationId);
      if (!loaded.context || !loaded.pack) {
        setLoadState({ status: "error", error: "application_preparation_context_unavailable" });
        return;
      }
      setLoadState({
        status: "ready",
        context: loaded.context,
        pack: loaded.pack,
        corrupted: loaded.corrupted
      });
    } catch (error) {
      setLoadState({ status: "error", error: materialErrorMessage(error) });
    }
  }, [applicationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const ready = loadState.status === "ready" ? loadState : undefined;
  const pack = ready?.pack;
  const context = ready?.context;

  async function savePack(nextPack: ApplicationPreparationPack, action: string) {
    if (!pack) {
      return;
    }
    setSaving(true);
    try {
      const result = await repository.saveApplicationPreparationPack({
        applicationId,
        expectedVersion: pack.version,
        operationId: `v2-g6b-${applicationId}-${pack.version}-${action}-${stableHashText(JSON.stringify(nextPack)).slice(0, 10)}`,
        pack: nextPack
      });
      setLoadState((current) => current.status === "ready"
        ? { ...current, pack: result.pack, corrupted: false }
        : current);
      onMessage(result.idempotent ? "申请材料操作已记录过。" : "申请材料已保存。");
      await onChanged();
    } catch (error) {
      onMessage(materialErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  if (loadState.status === "loading") {
    return (
      <section className="application-materials-panel" data-testid="application-materials-panel">
        <h3>申请材料</h3>
        <p>正在读取申请材料包...</p>
      </section>
    );
  }

  if (loadState.status === "error" || !pack || !context) {
    return (
      <section className="application-materials-panel" data-testid="application-materials-panel">
        <h3>申请材料</h3>
        <p>{loadState.status === "error" ? loadState.error : "申请材料暂不可用。"}</p>
      </section>
    );
  }

  const selectedCover = pack.materials.coverLetters[coverLanguage];
  const selectedEmail = pack.materials.applicationEmails[`${emailLanguage}_${emailTone}` as const];
  const selectedIntro = pack.materials.selfIntroductions[`${introLanguage}${introDuration}` as const];
  const questionSet = pack.materials.interviewQuestions[0];
  const starStory = pack.materials.starStories[0];

  return (
    <section className="application-materials-panel" data-testid="application-materials-panel">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">申请材料</p>
          <h3>申请材料与面试准备</h3>
          <p>材料版本 {pack.version}</p>
        </div>
        <strong className={`application-readiness-chip application-readiness-${pack.checklist.level}`}>
          {readinessLabel(pack.checklist.level)}
        </strong>
      </div>

      {ready.corrupted ? (
        <div className="diagnostic-notice" data-testid="invalid-preparation-pack">
          旧材料包已损坏，系统已安全回退为空材料包。
        </div>
      ) : null}

      <MaterialsSummary pack={pack} />

      <div className="materials-control-grid">
        <section className="materials-tool">
          <h4>求职信</h4>
          <div className="compact-form-grid">
            <label className="field-label">
              语言
              <select value={coverLanguage} onChange={(event) => setCoverLanguage(event.target.value as MaterialLanguage)}>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
          <button
            className="primary-button"
            disabled={saving}
            onClick={() => savePack(generateCoverLetterMaterial({ pack, context, language: coverLanguage }), `cover-letter-${coverLanguage}`)}
          >
            生成求职信
          </button>
          {selectedCover ? (
            <CoverLetterEditor
              key={`${selectedCover.id}-${selectedCover.generationVersion}`}
              material={selectedCover}
              disabled={saving}
              onSave={(content) => savePack(editCoverLetterMaterial({ pack, context, language: coverLanguage, content }), `edit-cover-letter-${coverLanguage}`)}
              onComplete={() => savePack(markApplicationMaterialCompleted({ pack, materialId: selectedCover.id }), `complete-${selectedCover.id}`)}
              onNotNeeded={() => savePack(markApplicationMaterialNotNeeded({ pack, materialId: selectedCover.id }), `not-needed-${selectedCover.id}`)}
              onRestore={(versionId) => savePack(restoreApplicationMaterialVersion({ pack, context, materialId: selectedCover.id, versionId }), `restore-${selectedCover.id}-${versionId}`)}
            />
          ) : <p className="application-muted">尚未生成求职信。</p>}
        </section>

        <section className="materials-tool">
          <h4>投递邮件</h4>
          <div className="compact-form-grid">
            <label className="field-label">
              语言
              <select value={emailLanguage} onChange={(event) => setEmailLanguage(event.target.value as MaterialLanguage)}>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="field-label">
              语气
              <select value={emailTone} onChange={(event) => setEmailTone(event.target.value as "brief" | "formal")}>
                <option value="brief">简洁</option>
                <option value="formal">正式</option>
              </select>
            </label>
          </div>
          <button
            className="primary-button"
            disabled={saving}
            onClick={() => savePack(generateApplicationEmailMaterial({ pack, context, language: emailLanguage, tone: emailTone }), `email-${emailLanguage}-${emailTone}`)}
          >
            生成邮件草稿
          </button>
          {selectedEmail ? (
            <EmailPreview
              material={selectedEmail}
              disabled={saving}
              onComplete={() => savePack(markApplicationMaterialCompleted({ pack, materialId: selectedEmail.id }), `complete-${selectedEmail.id}`)}
              onNotNeeded={() => savePack(markApplicationMaterialNotNeeded({ pack, materialId: selectedEmail.id }), `not-needed-${selectedEmail.id}`)}
            />
          ) : <p className="application-muted">尚未生成投递邮件。</p>}
        </section>

        <section className="materials-tool">
          <h4>自我介绍</h4>
          <div className="compact-form-grid">
            <label className="field-label">
              语言
              <select value={introLanguage} onChange={(event) => setIntroLanguage(event.target.value as MaterialLanguage)}>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="field-label">
              时长
              <select value={introDuration} onChange={(event) => setIntroDuration(Number(event.target.value) as 30 | 60)}>
                <option value={30}>30秒</option>
                <option value={60}>60秒</option>
              </select>
            </label>
          </div>
          <button
            className="primary-button"
            disabled={saving}
            onClick={() => savePack(generateSelfIntroductionMaterial({ pack, context, language: introLanguage, durationSeconds: introDuration }), `intro-${introLanguage}-${introDuration}`)}
          >
            生成自我介绍
          </button>
          {selectedIntro ? (
            <SelfIntroductionPreview
              material={selectedIntro}
              disabled={saving}
              onComplete={() => savePack(markApplicationMaterialCompleted({ pack, materialId: selectedIntro.id }), `complete-${selectedIntro.id}`)}
              onNotNeeded={() => savePack(markApplicationMaterialNotNeeded({ pack, materialId: selectedIntro.id }), `not-needed-${selectedIntro.id}`)}
            />
          ) : <p className="application-muted">尚未生成自我介绍。</p>}
        </section>

        <section className="materials-tool">
          <h4>面试问题</h4>
          <button
            className="primary-button"
            disabled={saving}
            onClick={() => savePack(generateInterviewQuestionMaterial({ pack, context }), "interview-questions")}
          >
            生成面试问题
          </button>
          {questionSet ? (
            <InterviewQuestionsPanel
              material={questionSet}
              disabled={saving}
              onPrepared={(questionId) => savePack(updateInterviewQuestion({ pack, questionId, preparationStatus: "prepared" }), `prepared-${questionId}`)}
              onNotes={(questionId, userNotes) => savePack(updateInterviewQuestion({ pack, questionId, userNotes }), `notes-${questionId}-${stableHashText(userNotes).slice(0, 8)}`)}
              onComplete={() => savePack(markApplicationMaterialCompleted({ pack, materialId: questionSet.id }), `complete-${questionSet.id}`)}
            />
          ) : <p className="application-muted">尚未生成面试问题。</p>}
        </section>

        <section className="materials-tool">
          <h4>STAR 案例</h4>
          <button
            className="primary-button"
            disabled={saving}
            onClick={() => savePack(generateStarStoryMaterial({ pack, context }), "star-story")}
          >
            生成STAR案例
          </button>
          {starStory ? (
            <StarStoryPreview
              material={starStory}
              disabled={saving}
              onComplete={() => savePack(markApplicationMaterialCompleted({ pack, materialId: starStory.id }), `complete-${starStory.id}`)}
              onNotNeeded={() => savePack(markApplicationMaterialNotNeeded({ pack, materialId: starStory.id }), `not-needed-${starStory.id}`)}
            />
          ) : <p className="application-muted">尚未生成STAR案例。</p>}
        </section>

        <FactGapsPanel
          pack={pack}
          disabled={saving}
          onResolve={(gapId) => savePack(resolveApplicationFactGap({ pack, gapId, status: "resolved" }), `gap-resolved-${gapId}`)}
          onIgnore={(gapId) => savePack(resolveApplicationFactGap({ pack, gapId, status: "ignored" }), `gap-ignored-${gapId}`)}
        />
      </div>
    </section>
  );
}

function MaterialsSummary({ pack }: { pack: ApplicationPreparationPack }) {
  return (
    <div className="application-readiness-list materials-summary" data-testid="materials-readiness">
      {pack.checklist.items.map((item) => (
        <article key={item.id} className={`application-readiness-item application-readiness-item-${item.level}`}>
          <strong>{item.label}</strong>
          <span>{readinessLabel(item.level)}</span>
          <p>{item.message}</p>
        </article>
      ))}
    </div>
  );
}

function CoverLetterEditor({
  material,
  disabled,
  onSave,
  onComplete,
  onNotNeeded,
  onRestore
}: {
  material: CoverLetterMaterial;
  disabled: boolean;
  onSave: (content: CoverLetterContent) => void;
  onComplete: () => void;
  onNotNeeded: () => void;
  onRestore: (versionId: string) => void;
}) {
  const [draft, setDraft] = useState(() => contentToDraft(material.currentContent));

  const parsed = useMemo(() => CoverLetterContentSchema.safeParse({
    salutation: draft.salutation,
    opening: draft.opening,
    bodyParagraphs: draft.bodyParagraphs.split("\n").map((line) => line.trim()).filter(Boolean),
    closing: draft.closing,
    signatureName: draft.signatureName
  }), [draft]);

  return (
    <article className={`material-card material-status-${material.status}`} data-testid="cover-letter-material">
      <MaterialHeader material={material} />
      <label className="field-label">
        称呼
        <input value={draft.salutation} onChange={(event) => setDraft({ ...draft, salutation: event.target.value })} />
      </label>
      <label className="field-label">
        开头
        <textarea className="textarea compact-textarea" value={draft.opening} onChange={(event) => setDraft({ ...draft, opening: event.target.value })} />
      </label>
      <label className="field-label">
        正文段落
        <textarea className="textarea material-textarea" value={draft.bodyParagraphs} onChange={(event) => setDraft({ ...draft, bodyParagraphs: event.target.value })} />
      </label>
      <label className="field-label">
        结尾
        <textarea className="textarea compact-textarea" value={draft.closing} onChange={(event) => setDraft({ ...draft, closing: event.target.value })} />
      </label>
      <div className="action-row">
        <button className="secondary-button compact" disabled={disabled || !parsed.success} onClick={() => parsed.success && onSave(parsed.data)}>保存草稿</button>
        <button className="primary-button compact" disabled={disabled || material.guardStatus !== "allowed" || material.status === "stale"} onClick={onComplete}>标记完成</button>
        <button className="secondary-button compact" disabled={disabled} onClick={onNotNeeded}>标记不需要</button>
      </div>
      <MaterialEvidence evidenceRefs={material.evidenceRefs} />
      <MaterialHistory material={material} onRestore={onRestore} disabled={disabled} />
    </article>
  );
}

function EmailPreview({
  material,
  disabled,
  onComplete,
  onNotNeeded
}: {
  material: ApplicationEmailMaterial;
  disabled: boolean;
  onComplete: () => void;
  onNotNeeded: () => void;
}) {
  return (
    <article className={`material-card material-status-${material.status}`} data-testid="application-email-material">
      <MaterialHeader material={material} />
      <strong>{material.currentContent.subject}</strong>
      <p>{material.currentContent.greeting}</p>
      {material.currentContent.bodyParagraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      {material.currentContent.attachmentMentions.length > 0 ? (
        <ul>{material.currentContent.attachmentMentions.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : <p className="application-muted">当前草稿未声明附件。</p>}
      <p>{material.currentContent.closing} {material.currentContent.senderName}</p>
      <div className="action-row">
        <button className="primary-button compact" disabled={disabled || material.guardStatus !== "allowed" || material.status === "stale"} onClick={onComplete}>标记完成</button>
        <button className="secondary-button compact" disabled={disabled} onClick={onNotNeeded}>标记不需要</button>
      </div>
      <MaterialEvidence evidenceRefs={material.evidenceRefs} />
    </article>
  );
}

function SelfIntroductionPreview({
  material,
  disabled,
  onComplete,
  onNotNeeded
}: {
  material: SelfIntroductionMaterial;
  disabled: boolean;
  onComplete: () => void;
  onNotNeeded: () => void;
}) {
  return (
    <article className={`material-card material-status-${material.status}`} data-testid="self-introduction-material">
      <MaterialHeader material={material} />
      <p>{material.currentContent.opening}</p>
      {material.currentContent.education ? <p>{material.currentContent.education}</p> : null}
      <p>{material.currentContent.relevantExperience}</p>
      <p>{material.currentContent.roleFit}</p>
      <p>{material.currentContent.closing}</p>
      <p className="application-muted">预计 {material.currentContent.estimatedSeconds} 秒。</p>
      <div className="action-row">
        <button className="primary-button compact" disabled={disabled || material.guardStatus !== "allowed" || material.status === "stale"} onClick={onComplete}>标记完成</button>
        <button className="secondary-button compact" disabled={disabled} onClick={onNotNeeded}>标记不需要</button>
      </div>
      <MaterialEvidence evidenceRefs={material.evidenceRefs} />
    </article>
  );
}

function InterviewQuestionsPanel({
  material,
  disabled,
  onPrepared,
  onNotes,
  onComplete
}: {
  material: InterviewQuestionSetMaterial;
  disabled: boolean;
  onPrepared: (questionId: string) => void;
  onNotes: (questionId: string, userNotes: string) => void;
  onComplete: () => void;
}) {
  return (
    <article className={`material-card material-status-${material.status}`} data-testid="interview-questions-material">
      <MaterialHeader material={material} />
      {material.currentContent.questions.map((question) => (
        <div className="interview-question-row" key={question.id}>
          <strong>{question.category}</strong>
          <p>{question.question}</p>
          <p className="application-muted">{question.whyAsked}</p>
          {question.answerOutline.length > 0 ? (
            <ul>{question.answerOutline.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : null}
          <textarea
            className="textarea compact-textarea"
            placeholder="答案笔记"
            defaultValue={question.userNotes ?? ""}
            onBlur={(event) => onNotes(question.id, event.target.value)}
          />
          <button className="secondary-button compact" disabled={disabled} onClick={() => onPrepared(question.id)}>标记已准备</button>
        </div>
      ))}
      <div className="action-row">
        <button className="primary-button compact" disabled={disabled || material.guardStatus !== "allowed" || material.status === "stale"} onClick={onComplete}>标记完成</button>
      </div>
      <MaterialEvidence evidenceRefs={material.evidenceRefs} />
    </article>
  );
}

function StarStoryPreview({
  material,
  disabled,
  onComplete,
  onNotNeeded
}: {
  material: StarStoryMaterial;
  disabled: boolean;
  onComplete: () => void;
  onNotNeeded: () => void;
}) {
  return (
    <article className={`material-card material-status-${material.status}`} data-testid="star-story-material">
      <MaterialHeader material={material} />
      <h5>{material.currentContent.title}</h5>
      <dl className="application-definition-list">
        <div><dt>Situation</dt><dd>{material.currentContent.situation}</dd></div>
        <div><dt>Task</dt><dd>{material.currentContent.task}</dd></div>
        <div><dt>Action</dt><dd>{material.currentContent.action}</dd></div>
        <div><dt>Result</dt><dd>{material.currentContent.result}</dd></div>
      </dl>
      {material.currentContent.missingParts.length > 0 ? (
        <p className="diagnostic-notice">缺少：{material.currentContent.missingParts.join(", ")}</p>
      ) : null}
      <div className="action-row">
        <button className="primary-button compact" disabled={disabled || material.guardStatus !== "allowed" || material.status === "stale"} onClick={onComplete}>标记完成</button>
        <button className="secondary-button compact" disabled={disabled} onClick={onNotNeeded}>标记不需要</button>
      </div>
      <MaterialEvidence evidenceRefs={material.evidenceRefs} />
    </article>
  );
}

function FactGapsPanel({
  pack,
  disabled,
  onResolve,
  onIgnore
}: {
  pack: ApplicationPreparationPack;
  disabled: boolean;
  onResolve: (gapId: string) => void;
  onIgnore: (gapId: string) => void;
}) {
  return (
    <section className="materials-tool" data-testid="fact-gaps-panel">
      <h4>事实缺口</h4>
      {pack.factGaps.length === 0 ? <p className="application-muted">暂无事实缺口。</p> : null}
      {pack.factGaps.map((gap) => (
        <article className={`fact-gap-card fact-gap-${gap.status}`} key={gap.id}>
          <strong>{gap.missingFactType}</strong>
          <p>{gap.description}</p>
          <span>{gap.status}</span>
          {gap.status === "open" ? (
            <div className="action-row">
              <button className="secondary-button compact" disabled={disabled} onClick={() => onResolve(gap.id)}>标记已解决</button>
              <button className="secondary-button compact" disabled={disabled} onClick={() => onIgnore(gap.id)}>忽略</button>
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}

function MaterialHeader({
  material
}: {
  material: CoverLetterMaterial | ApplicationEmailMaterial | SelfIntroductionMaterial | InterviewQuestionSetMaterial | StarStoryMaterial;
}) {
  return (
    <div className="material-card-header">
      <strong>{materialLabel(material.materialType)}</strong>
      <span>{material.status}</span>
      <span>{material.guardStatus}</span>
      {material.userEdited ? <span>已编辑</span> : null}
      {material.guardReasons.length > 0 ? <p>{material.guardReasons.join("；")}</p> : null}
    </div>
  );
}

function MaterialEvidence({ evidenceRefs }: { evidenceRefs: MaterialEvidenceRef[] }) {
  return (
    <details className="material-evidence-panel" data-testid="material-evidence">
      <summary>事实证据</summary>
      {evidenceRefs.length === 0 ? <p>暂无证据。</p> : null}
      <ul>
        {evidenceRefs.map((ref, index) => (
          <li key={`${ref.sourceType}-${ref.factId ?? ref.contentItemId ?? ref.requirementId}-${index}`}>
            <strong>{ref.label ?? ref.sourceType}</strong>
            <span>{ref.quote}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function MaterialHistory({
  material,
  disabled,
  onRestore
}: {
  material: CoverLetterMaterial;
  disabled: boolean;
  onRestore: (versionId: string) => void;
}) {
  return (
    <details className="material-history" data-testid="material-history">
      <summary>版本历史</summary>
      {material.history.length === 0 ? <p>暂无历史版本。</p> : null}
      {material.history.map((version) => (
        <div key={version.id} className="material-history-row">
          <span>v{version.generationVersion} / {version.reason ?? "version"}</span>
          <button className="secondary-button compact" disabled={disabled} onClick={() => onRestore(version.id)}>恢复</button>
        </div>
      ))}
    </details>
  );
}

function contentToDraft(content: CoverLetterContent) {
  return {
    salutation: content.salutation,
    opening: content.opening,
    bodyParagraphs: content.bodyParagraphs.join("\n"),
    closing: content.closing,
    signatureName: content.signatureName
  };
}

function materialLabel(type: string) {
  const labels: Record<string, string> = {
    cover_letter: "求职信",
    application_email: "投递邮件",
    self_introduction: "自我介绍",
    interview_questions: "面试问题",
    star_story: "STAR 案例"
  };
  return labels[type] ?? type;
}

function readinessLabel(level: "ready" | "needs_attention" | "blocked") {
  return level === "blocked" ? "存在阻断" : level === "needs_attention" ? "需要关注" : "准备就绪";
}

function materialErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "application_material_error";
  const labels: Record<string, string> = {
    application_preparation_context_unavailable: "无法读取申请材料上下文。",
    application_not_found: "投递记录不存在。",
    invalid_preparation_pack: "申请材料包损坏。",
    version_conflict: "材料包已被更新，请刷新后重试。",
    forbidden_preparation_payload: "材料包包含禁止保存的字段。",
    material_not_found: "材料不存在。",
    stale_material: "材料已过期，需要重新生成或复核。",
    guard_blocked: "材料存在事实安全检查阻断，不能标记完成。",
    guard_needs_edit: "材料仍需编辑后才能完成。",
    history_corrupted: "材料历史版本不可用。"
  };
  return labels[message] ?? message;
}

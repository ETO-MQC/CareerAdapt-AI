"use client";

import { nanoid } from "nanoid";
import { useEffect, useMemo, useState } from "react";
import { invokeStageBAi, invokeStructuredAi } from "@/ai/client";
import { promptVersions } from "@/ai/prompts/versions";
import { createManualJdOutput } from "@/domain/jobAnalysis/manual";
import { mapJobDraftToJobDescription } from "@/domain/mappers/jobDraftMapper";
import {
  FactGuardOutputSchema,
  ResumeTailorOutputSchema,
  EvidenceMatcherOutputSchema,
  JdAnalyzerOutputSchema,
  MatchEvaluationSchema,
  type AiSuggestion,
  type FactGuardResult,
  type JdAnalyzerOutput,
  type JdAnalyzerRequirement,
  type JobAdaptationDraft,
  type JobAnalysisDraft,
  type JobDescription,
  type CareerProfile,
  type MatchEvaluation,
  type MatchEvidenceRef,
  type RawInputDocument,
  type RequirementMatch
} from "@/domain/schemas";
import { collectAllowedEvidenceRefs } from "@/domain/adaptation/draft";
import { mergeAiFactGuardReview, runRuleFactGuard } from "@/domain/adaptation/factGuard";
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
  const [adaptationDraft, setAdaptationDraft] = useState<JobAdaptationDraft | undefined>();
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [c2Status, setC2Status] = useState<"idle" | "running" | "failed">("idle");
  const [editedSuggestions, setEditedSuggestions] = useState<Record<string, string>>({});
  const [selectedJobId, setSelectedJobId] = useState<string>("");

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
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0];

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

  useEffect(() => {
    let active = true;

    async function loadC2Draft() {
      if (!profile || !selectedJob) {
        setAdaptationDraft(undefined);
        setSuggestions([]);
        return;
      }

      const latestDraft = await repository.getLatestJobAdaptationDraft(profile.id, selectedJob.id);
      const latestSuggestions = latestDraft ? await repository.listAiSuggestions(latestDraft.id) : [];
      if (active) {
        setAdaptationDraft(latestDraft);
        setSuggestions(latestSuggestions);
      }
    }

    void loadC2Draft();

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
      setMessage("请先准备个人资料和正式岗位数据。");
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
    setMessage("经历匹配已完成：只使用个人资料中已确认的事实。");
  }

  async function runAiEvidenceMatcher() {
    if (!profile || !selectedJob || matches.length === 0) {
      setMessage("请先运行经历匹配。");
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
    setMessage("AI解释已完成；规则匹配和人工覆盖未被修改。");
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

  async function createC2Draft() {
    if (!profile || !selectedJob || matches.length === 0) {
      setMessage("请先完成经历匹配，再创建简历建议草稿。");
      return undefined;
    }

    try {
      setC2Status("running");
      const operationId = `c2-create-${stableHashText(JSON.stringify({
        profileId: profile.id,
        jobId: selectedJob.id,
        matchIds: matches.map((match) => match.id).sort()
      }))}`;
      const result = await repository.createJobAdaptationDraft({
        profile,
        job: selectedJob,
        matches,
        operationId
      });
      setAdaptationDraft(result.draft);
      setC2Status("idle");
      setMessage(result.idempotent ? "简历建议草稿已存在，已恢复。" : "简历建议草稿已创建。");
      return result.draft;
    } catch (error) {
      setC2Status("failed");
      setMessage(error instanceof Error && error.message.includes("c2_match_stale")
        ? "存在过期匹配，暂不能生成建议。请重新运行经历匹配。"
        : "创建简历建议草稿失败，请确认匹配结果未过期。");
      return undefined;
    }
  }

  async function generateC2Suggestions() {
    if (!profile || !selectedJob) {
      return;
    }

    const draftForGeneration = adaptationDraft ?? await createC2Draft();
    if (!draftForGeneration) {
      return;
    }

    try {
      setC2Status("running");
      const usableMatches = getC2UsableMatches();
      const tailorInput = buildResumeTailorInput(draftForGeneration, usableMatches);
      const result = await invokeStructuredAi({
        task: "resume-tailor",
        businessInput: tailorInput,
        outputSchema: ResumeTailorOutputSchema
      });
      await repository.saveAiLogs([result.log]);

      if (!result.ok) {
        setC2Status("failed");
        setMessage("resume-tailor 调用失败，已保留现有草稿和建议。");
        return;
      }

      const now = new Date().toISOString();
      const nextSuggestions: AiSuggestion[] = [];
      for (const item of result.data.suggestions) {
        const guardResult = await runFullFactGuard(item.originalText, item.suggestedText, item.usedEvidenceRefs);
        nextSuggestions.push({
          id: `suggestion-${nanoid(10)}`,
          draftId: draftForGeneration.id,
          targetSectionId: item.targetSectionId,
          type: item.type,
          originalText: item.originalText,
          suggestedText: item.suggestedText,
          reason: item.reason,
          requirementIds: item.requirementIds,
          usedEvidenceRefs: item.usedEvidenceRefs,
          guardResult,
          riskLevel: guardResult.riskLevel,
          status: guardResult.status === "blocked_high_risk" ? "blocked_high_risk" : "pending_review",
          promptVersion: result.promptVersion,
          createdAt: now,
          updatedAt: now
        });
      }

      const saved = await repository.saveGeneratedSuggestions({
        profile,
        job: selectedJob,
        draftId: draftForGeneration.id,
        matches: usableMatches,
        suggestions: nextSuggestions,
        expectedRevision: draftForGeneration.revision,
        operationId: `c2-generate-${draftForGeneration.id}-${stableHashText(JSON.stringify(nextSuggestions.map((item) => item.id)))}`
      });
      setAdaptationDraft(saved.draft);
      setSuggestions(saved.suggestions);
      setC2Status("idle");
      setMessage("AI简历建议已生成，并完成事实安全检查。");
    } catch {
      setC2Status("failed");
      setMessage("生成简历建议失败。已有草稿和规则检测结果不会被清空。");
    }
  }

  async function runFullFactGuard(originalText: string, checkedText: string, usedEvidenceRefs: AiSuggestion["usedEvidenceRefs"]): Promise<FactGuardResult> {
    const ruleResult = runRuleFactGuard({ originalText, checkedText, usedEvidenceRefs });
    const aiResult = await invokeStructuredAi({
      task: "fact-guard",
      businessInput: {
        originalText,
        checkedText,
        usedEvidenceRefs,
        ruleFindings: ruleResult.ruleFindings
      },
      outputSchema: FactGuardOutputSchema
    });
    await repository.saveAiLogs([aiResult.log]);
    return mergeAiFactGuardReview({
      ruleResult,
      aiReview: aiResult.ok ? aiResult.data : undefined,
      aiFailed: !aiResult.ok
    });
  }

  async function acceptSuggestion(suggestion: AiSuggestion) {
    if (!profile || !selectedJob || !adaptationDraft) {
      return;
    }

    try {
      const result = await repository.acceptSuggestion({
        profile,
        job: selectedJob,
        matches: getC2UsableMatches(),
        draftId: adaptationDraft.id,
        suggestionId: suggestion.id,
        expectedRevision: adaptationDraft.revision,
        operationId: `c2-accept-${suggestion.id}-${adaptationDraft.revision}`
      });
      setAdaptationDraft(result.draft);
      setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? result.suggestion : item));
      setMessage("建议已接受，草稿文本和快照已保存。");
    } catch {
      setMessage("该建议无法接受：可能是高风险、未通过事实安全检查、版本冲突或匹配已过期。");
    }
  }

  async function rejectSuggestion(suggestion: AiSuggestion) {
    if (!adaptationDraft) {
      return;
    }

    const result = await repository.rejectSuggestion({
      draftId: adaptationDraft.id,
      suggestionId: suggestion.id,
      expectedRevision: adaptationDraft.revision,
      operationId: `c2-reject-${suggestion.id}-${adaptationDraft.revision}`
    });
    setAdaptationDraft(result.draft);
    setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? result.suggestion : item));
    setMessage("建议已拒绝，并已记录快照。");
  }

  async function editAndGuardSuggestion(suggestion: AiSuggestion) {
    if (!adaptationDraft) {
      return;
    }

    const editedText = editedSuggestions[suggestion.id]?.trim();
    if (!editedText) {
      setMessage("请先填写编辑后的文本。");
      return;
    }

    const guardResult = await runFullFactGuard(suggestion.originalText, editedText, suggestion.usedEvidenceRefs);
    const result = await repository.editSuggestionGuarded({
      draftId: adaptationDraft.id,
      suggestionId: suggestion.id,
      expectedRevision: adaptationDraft.revision,
      operationId: `c2-edit-${suggestion.id}-${stableHashText(editedText)}-${adaptationDraft.revision}`,
      editedText,
      guardResult
    });
    setAdaptationDraft(result.draft);
    setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? result.suggestion : item));
    setMessage(guardResult.status === "pass" ? "编辑文本已通过事实安全检查，可单条接受。" : "编辑文本仍存在事实风险，请删除风险内容后重新检测。");
  }

  async function rerunGuardSuggestion(suggestion: AiSuggestion) {
    if (!adaptationDraft) {
      return;
    }

    const checkedText = suggestion.editedText ?? suggestion.suggestedText;
    const guardResult = await runFullFactGuard(suggestion.originalText, checkedText, suggestion.usedEvidenceRefs);
    const result = await repository.rerunSuggestionGuard({
      draftId: adaptationDraft.id,
      suggestionId: suggestion.id,
      expectedRevision: adaptationDraft.revision,
      operationId: `c2-rerun-guard-${suggestion.id}-${stableHashText(checkedText)}-${adaptationDraft.revision}`,
      checkedText,
      guardResult
    });
    setAdaptationDraft(result.draft);
    setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? result.suggestion : item));
    setMessage("事实安全检查已重新检测。");
  }

  async function undoSuggestion(suggestion: AiSuggestion) {
    if (!adaptationDraft) {
      return;
    }

    const result = await repository.undoSuggestion({
      draftId: adaptationDraft.id,
      suggestionId: suggestion.id,
      expectedRevision: adaptationDraft.revision,
      operationId: `c2-undo-${suggestion.id}-${adaptationDraft.revision}`
    });
    setAdaptationDraft(result.draft);
    setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? result.suggestion : item));
    setMessage("已撤销该建议造成的草稿变更。");
  }

  function getC2UsableMatches() {
    if (!profile || !selectedJob) {
      return [];
    }
    return matches.filter((match) => {
      const stale = checkRequirementMatchStale(match, { profile, job: selectedJob });
      return match.profileId === profile.id && match.jobId === selectedJob.id && !match.isStale && !stale.isStale;
    });
  }

  function buildResumeTailorInput(draftForGeneration: JobAdaptationDraft, usableMatches: RequirementMatch[]) {
    const allowedEvidenceRefs = collectAllowedEvidenceRefs(usableMatches);
    return {
      draftId: draftForGeneration.id,
      profileId: draftForGeneration.profileId,
      jobId: draftForGeneration.jobId,
      profileVersion: draftForGeneration.profileVersion,
      jobVersion: draftForGeneration.jobVersion,
      matcherVersion: draftForGeneration.matcherVersion,
      requirementIds: usableMatches.map((match) => match.requirementId),
      allowedEvidenceRefs,
      sectionTexts: draftForGeneration.sectionTexts.map((section) => ({
        sectionId: section.sectionId,
        sectionType: section.sectionType,
        text: section.text,
        originalText: section.originalText,
        order: section.order
      })),
      matches: usableMatches.map((match) => {
        const effective = resolveEffectiveMatch(match);
        const requirement = selectedJob?.requirements.find((item) => item.id === match.requirementId);
        return {
          requirementId: match.requirementId,
          requirementDescription: requirement?.description ?? match.requirementQuote.text,
          matchLevel: effective.matchLevel,
          riskLevel: effective.riskLevel,
          risks: effective.risks,
          evidenceRefs: effective.evidenceRefs,
          explanation: effective.explanation
        };
      })
    };
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
    <main className="page-shell jobs-workspace">
      <section className="page-title">
        <p className="eyebrow">岗位工作区</p>
        <h1>岗位解析与简历建议</h1>
        <p>粘贴岗位描述，提取要求，匹配你的个人资料，并生成可审阅的简历修改建议。</p>
      </section>

      {workspace.status === "empty" ? <WorkspaceEmptyState /> : null}
      {message ? <section className="notice">{message}</section> : null}

      <section className="stage-grid">
        <article className="panel">
          <h2>1. 粘贴岗位JD</h2>
          <div className="form-grid">
            <input data-testid="job-title-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="岗位名称" />
            <input data-testid="job-company-input" value={company} onChange={(event) => setCompany(event.target.value)} placeholder="公司名称" />
          </div>
          <textarea data-testid="job-raw-textarea" className="textarea" value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder="粘贴岗位JD原文..." />
          <div className="action-row">
            <button className="primary-button" data-testid="save-job-raw-input" onClick={startImport}>
              保存原始JD
            </button>
            <span className={`save-status save-status-${saveStatus}`}>保存状态：{saveStatusLabel(saveStatus)}</span>
          </div>
        </article>

        {draft?.status === "privacy_pending" ? (
          <article className="panel">
            <h2>2. 外部模型与隐私说明</h2>
            <p>系统会在服务端默认脱敏手机号、邮箱、身份证号和精确地址后再发送给外部模型。</p>
            <p>本次脱敏预览：{redactionPreview.redactions.length === 0 ? "未发现需脱敏内容" : redactionPreview.redactions.map((item) => `${item.type} x${item.count}`).join(" / ")}</p>
            <div className="action-row">
              <button className="primary-button" data-testid="job-analyze-ai" onClick={analyzeWithAi}>
                同意脱敏并解析
              </button>
              <button className="secondary-button" data-testid="job-manual-mode" onClick={enterManualMode}>
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
            <button className="primary-button" data-testid="commit-job" onClick={commitJob}>
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
        {jobs.length > 0 ? (
          <label className="field-label">
            当前岗位
            <select data-testid="current-job-select" value={selectedJob?.id ?? ""} onChange={(event) => {
              setSelectedJobId(event.target.value);
              setSelectedMatchId(undefined);
              setAdaptationDraft(undefined);
              setSuggestions([]);
            }}>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.company} / {job.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
              <h2>经历匹配与差距诊断</h2>
              <p>仅使用个人资料中已确认的事实，帮助你判断哪些要求已有证据、哪些需要补充。</p>
            </div>
            <div className="action-row">
              <button className="primary-button" data-testid="run-experience-match" onClick={runRuleMatcher}>
                运行经历匹配
              </button>
              <button className="secondary-button" data-testid="run-ai-evidence-explanation" onClick={runAiEvidenceMatcher} disabled={matches.length === 0}>
                运行AI解释
              </button>
            </div>
          </div>

          {matches.length === 0 ? (
            <p>尚未生成匹配结果。请先运行经历匹配。</p>
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
                      <span>{matchLevelLabel(effective.matchLevel)} / {riskLabel(effective.riskLevel)} / {sourceLabel(effective.source)}{stale.isStale ? " / 已过期" : ""}</span>
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

      {profile && selectedJob ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>AI简历建议与事实安全检查</h2>
              <p>只读取未过期的匹配结果；建议会先进入草稿，接受前不会修改个人资料。</p>
            </div>
            <div className="action-row">
              <button className="primary-button" data-testid="create-suggestion-draft" onClick={createC2Draft} disabled={matches.length === 0 || c2Status === "running"}>
                创建建议草稿
              </button>
              <button className="secondary-button" data-testid="generate-ai-suggestions" onClick={generateC2Suggestions} disabled={matches.length === 0 || c2Status === "running"}>
                生成AI建议
              </button>
            </div>
          </div>

          {adaptationDraft ? (
            <div className="c2-layout">
              <article className="draft-preview">
                <h3>建议草稿</h3>
                {adaptationDraft.sectionTexts.map((section) => (
                  <p key={section.sectionId}><strong>{section.sectionType}</strong>：{section.text}</p>
                ))}
              </article>
              <div className="suggestion-list">
                {suggestions.length === 0 ? <p>尚未生成建议。</p> : suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    editedText={editedSuggestions[suggestion.id] ?? suggestion.editedText ?? ""}
                    onEditedText={(text) => setEditedSuggestions((current) => ({ ...current, [suggestion.id]: text }))}
                    onAccept={() => acceptSuggestion(suggestion)}
                    onReject={() => rejectSuggestion(suggestion)}
                    onEditGuard={() => editAndGuardSuggestion(suggestion)}
                    onRerunGuard={() => rerunGuardSuggestion(suggestion)}
                    onUndo={() => undoSuggestion(suggestion)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p>请先创建建议草稿。若任一引用匹配过期，系统会要求重新运行经历匹配。</p>
          )}
        </section>
      ) : null}
    </main>
  );
}

function SuggestionCard({
  suggestion,
  editedText,
  onEditedText,
  onAccept,
  onReject,
  onEditGuard,
  onRerunGuard,
  onUndo
}: {
  suggestion: AiSuggestion;
  editedText: string;
  onEditedText: (text: string) => void;
  onAccept: () => void;
  onReject: () => void;
  onEditGuard: () => void;
  onRerunGuard: () => void;
  onUndo: () => void;
}) {
  const canAccept = (suggestion.guardResult.status === "pass" || suggestion.guardResult.status === "ai_failed_rule_kept")
    && suggestion.status !== "blocked_high_risk"
    && suggestion.riskLevel !== "high";

  return (
    <article className={`suggestion-card suggestion-card-${suggestion.guardResult.riskLevel}`}>
      <div className="section-heading compact-heading">
        <div>
          <h3>{suggestion.type} / {suggestion.status}</h3>
          <p>风险：{suggestion.guardResult.status} / {suggestion.guardResult.riskLevel}</p>
        </div>
      </div>
      <p><strong>原文：</strong>{suggestion.originalText}</p>
      <p><strong>建议：</strong>{suggestion.suggestedText}</p>
      <p><strong>原因：</strong>{suggestion.reason}</p>
      <p><strong>岗位依据：</strong>{suggestion.requirementIds.join(" / ")}</p>
      <div className="evidence-list">
        {suggestion.usedEvidenceRefs.length > 0 ? suggestion.usedEvidenceRefs.map((ref) => (
          <p key={evidenceRefKey(ref)}><strong>事实依据：</strong>{ref.factText}</p>
        )) : <p>无可引用事实，不能补写新事实。</p>}
      </div>
      {suggestion.guardResult.ruleFindings.length > 0 ? (
        <div className="warning-box">
          {suggestion.guardResult.ruleFindings.map((finding) => (
            <p key={`${finding.type}-${finding.text}`}>{finding.type}：{finding.text} / {finding.message}</p>
          ))}
        </div>
      ) : null}
      <textarea
        className="textarea small-textarea"
        value={editedText}
        onChange={(event) => onEditedText(event.target.value)}
        placeholder="编辑后必须重新检测，不能在建议卡片中直接确认新增事实。"
      />
      <div className="action-row">
        <button className="primary-button" onClick={onAccept} disabled={!canAccept}>接受</button>
        <button className="secondary-button" onClick={onReject}>拒绝</button>
        <button className="secondary-button" onClick={onEditGuard}>编辑后检测</button>
        <button className="secondary-button" onClick={onRerunGuard}>重新检测</button>
        <button className="secondary-button" onClick={onUndo}>撤销</button>
      </div>
    </article>
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
      {stale.isStale ? <div className="warning-box">该匹配已过期，需要重新运行经历匹配后才能继续使用。</div> : null}
      <h3>{requirement?.description}</h3>
      <p><strong>岗位原文：</strong>{match.requirementQuote.text}</p>
      <p><strong>有效结果：</strong>{matchLevelLabel(effective.matchLevel)} / {riskLabel(effective.riskLevel)} / 来源：{sourceLabel(effective.source)}</p>
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
            <option value="strong">直接匹配</option>
            <option value="weak">部分匹配</option>
            <option value="transferable">可迁移</option>
            <option value="none">暂无匹配</option>
          </select>
          <select value={manualRisk} onChange={(event) => onManualRisk(event.target.value as MatchEvaluation["riskLevel"])}>
            <option value="low">低风险</option>
            <option value="medium">中风险</option>
            <option value="high">高风险</option>
          </select>
        </div>
        {manualLevel !== "none" ? (
          <select value={manualEvidenceKey} onChange={(event) => onManualEvidence(event.target.value)}>
            <option value="">选择已确认事实</option>
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

function matchLevelLabel(level: MatchEvaluation["matchLevel"]) {
  return {
    strong: "直接匹配",
    weak: "部分匹配",
    transferable: "可迁移",
    none: "暂无匹配"
  }[level];
}

function riskLabel(risk: MatchEvaluation["riskLevel"]) {
  return {
    low: "低风险",
    medium: "中风险",
    high: "高风险"
  }[risk];
}

function sourceLabel(source: string) {
  return {
    rule: "规则",
    ai: "AI解释",
    manual: "人工确认",
    fallback: "本地规则"
  }[source] ?? source;
}

function saveStatusLabel(status: "idle" | "saving" | "saved" | "failed" | "conflict") {
  return {
    idle: "等待保存",
    saving: "保存中",
    saved: "已保存",
    failed: "保存失败",
    conflict: "需要刷新后重试"
  }[status];
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

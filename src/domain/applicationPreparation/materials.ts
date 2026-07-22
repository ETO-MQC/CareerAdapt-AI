import {
  ApplicationEmailMaterialSchema,
  ApplicationPreparationPackSchema,
  CoverLetterMaterialSchema,
  InterviewQuestionSetMaterialSchema,
  SelfIntroductionMaterialSchema,
  StarStoryMaterialSchema,
  type ApplicationEmailContent,
  type ApplicationEmailMaterial,
  type ApplicationFactGap,
  type ApplicationMaterialStatus,
  type ApplicationPreparationBasedOn,
  type ApplicationPreparationPack,
  type CoverLetterContent,
  type CoverLetterMaterial,
  type InterviewQuestionItem,
  type InterviewQuestionSetMaterial,
  type MaterialEvidenceRef,
  type MaterialLanguage,
  type MaterialVersionSnapshot,
  type SelfIntroductionContent,
  type SelfIntroductionMaterial,
  type StarStoryContent,
  type StarStoryMaterial
} from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
import { runApplicationMaterialGuard } from "./guards";
import {
  type ApplicationPreparationContext,
  type ApplicationPreparationResumeBlock
} from "./context";

type EmailTone = "brief" | "formal";
type SelfIntroKey = "zh30" | "zh60" | "en30" | "en60";
type EmailKey = "zh_brief" | "zh_formal" | "en_brief" | "en_formal";
type ApplicationPreparationMaterial =
  | CoverLetterMaterial
  | ApplicationEmailMaterial
  | SelfIntroductionMaterial
  | InterviewQuestionSetMaterial
  | StarStoryMaterial;

export function createEmptyApplicationPreparationPack(
  context: ApplicationPreparationContext,
  now = new Date().toISOString()
): ApplicationPreparationPack {
  return ApplicationPreparationPackSchema.parse({
    schemaVersion: "application-preparation-v1",
    id: `application-preparation-${context.applicationId}`,
    applicationId: context.applicationId,
    profileId: context.profileId,
    jobId: context.jobId,
    basedOn: basedOnFromContext(context),
    materials: {
      coverLetters: {},
      applicationEmails: {},
      selfIntroductions: {},
      interviewQuestions: [],
      starStories: []
    },
    factGaps: [],
    checklist: {
      level: "needs_attention",
      items: [],
      updatedAt: now
    },
    version: 1,
    createdAt: now,
    updatedAt: now
  });
}

export function generateCoverLetterMaterial(input: {
  pack: ApplicationPreparationPack;
  context: ApplicationPreparationContext;
  language: MaterialLanguage;
  now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  const content = buildCoverLetterContent(input.context, input.language);
  const evidenceRefs = evidenceRefsForBlocks(selectEvidenceBlocks(input.context), input.context);
  const material = CoverLetterMaterialSchema.parse(applyGuardToMaterial({
    existing: input.pack.materials.coverLetters[input.language],
    material: {
      ...baseMaterial({
        id: `cover-letter-${input.language}-${input.context.applicationId}`,
        materialType: "cover_letter",
        context: input.context,
        now
      }),
      language: input.language,
      generatedContent: content,
      currentContent: content,
      evidenceRefs,
      factGapIds: []
    },
    context: input.context,
    reason: input.pack.materials.coverLetters[input.language] ? "regenerated" : "generated"
  }));
  const factGaps = mergeFactGaps(input.pack.factGaps, deriveFactGaps({
    context: input.context,
    materialType: "cover_letter",
    now
  }));
  return ApplicationPreparationPackSchema.parse({
    ...input.pack,
    basedOn: basedOnFromContext(input.context),
    materials: {
      ...input.pack.materials,
      coverLetters: {
        ...input.pack.materials.coverLetters,
        [input.language]: {
          ...material,
          factGapIds: factGaps.filter((gap) => gap.materialType === "cover_letter" && gap.status === "open").map((gap) => gap.id)
        }
      }
    },
    factGaps,
    updatedAt: now,
    version: input.pack.version + 1
  });
}

export function generateApplicationEmailMaterial(input: {
  pack: ApplicationPreparationPack;
  context: ApplicationPreparationContext;
  language: MaterialLanguage;
  tone: EmailTone;
  now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  const key = emailKey(input.language, input.tone);
  const content = buildApplicationEmailContent(input.context, input.language, input.tone);
  const material = ApplicationEmailMaterialSchema.parse(applyGuardToMaterial({
    existing: input.pack.materials.applicationEmails[key],
    material: {
      ...baseMaterial({
        id: `application-email-${key}-${input.context.applicationId}`,
        materialType: "application_email",
        context: input.context,
        now
      }),
      language: input.language,
      tone: input.tone,
      recipientEmail: undefined,
      generatedContent: content,
      currentContent: content,
      evidenceRefs: evidenceRefsForBlocks(selectEvidenceBlocks(input.context).slice(0, 1), input.context),
      factGapIds: []
    },
    context: input.context,
    reason: input.pack.materials.applicationEmails[key] ? "regenerated" : "generated"
  }));
  return ApplicationPreparationPackSchema.parse({
    ...input.pack,
    basedOn: basedOnFromContext(input.context),
    materials: {
      ...input.pack.materials,
      applicationEmails: {
        ...input.pack.materials.applicationEmails,
        [key]: material
      }
    },
    updatedAt: now,
    version: input.pack.version + 1
  });
}

export function generateSelfIntroductionMaterial(input: {
  pack: ApplicationPreparationPack;
  context: ApplicationPreparationContext;
  language: MaterialLanguage;
  durationSeconds: 30 | 60;
  now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  const key = selfIntroKey(input.language, input.durationSeconds);
  const content = buildSelfIntroductionContent(input.context, input.language, input.durationSeconds);
  const evidenceBlocks = selectEvidenceBlocks(input.context).slice(0, input.durationSeconds === 30 ? 1 : 3);
  const material = SelfIntroductionMaterialSchema.parse(applyGuardToMaterial({
    existing: input.pack.materials.selfIntroductions[key],
    material: {
      ...baseMaterial({
        id: `self-introduction-${key}-${input.context.applicationId}`,
        materialType: "self_introduction",
        context: input.context,
        now
      }),
      language: input.language,
      durationSeconds: input.durationSeconds,
      generatedContent: content,
      currentContent: content,
      evidenceRefs: evidenceRefsForBlocks(evidenceBlocks, input.context),
      factGapIds: []
    },
    context: input.context,
    reason: input.pack.materials.selfIntroductions[key] ? "regenerated" : "generated"
  }));
  return ApplicationPreparationPackSchema.parse({
    ...input.pack,
    basedOn: basedOnFromContext(input.context),
    materials: {
      ...input.pack.materials,
      selfIntroductions: {
        ...input.pack.materials.selfIntroductions,
        [key]: material
      }
    },
    updatedAt: now,
    version: input.pack.version + 1
  });
}

export function generateInterviewQuestionMaterial(input: {
  pack: ApplicationPreparationPack;
  context: ApplicationPreparationContext;
  now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  const content = { questions: buildInterviewQuestions(input.context) };
  const existing = input.pack.materials.interviewQuestions[0];
  const material = InterviewQuestionSetMaterialSchema.parse(applyGuardToMaterial({
    existing,
    material: {
      ...baseMaterial({
        id: `interview-questions-${input.context.applicationId}`,
        materialType: "interview_questions",
        context: input.context,
        now
      }),
      generatedContent: content,
      currentContent: content,
      evidenceRefs: evidenceRefsForBlocks(selectEvidenceBlocks(input.context), input.context),
      factGapIds: []
    },
    context: input.context,
    reason: existing ? "regenerated" : "generated"
  }));
  const factGaps = mergeFactGaps(input.pack.factGaps, deriveFactGaps({
    context: input.context,
    materialType: "interview_questions",
    now
  }));
  return ApplicationPreparationPackSchema.parse({
    ...input.pack,
    basedOn: basedOnFromContext(input.context),
    materials: {
      ...input.pack.materials,
      interviewQuestions: [{
        ...material,
        factGapIds: factGaps.filter((gap) => gap.materialType === "interview_questions" && gap.status === "open").map((gap) => gap.id)
      }]
    },
    factGaps,
    updatedAt: now,
    version: input.pack.version + 1
  });
}

export function generateStarStoryMaterial(input: {
  pack: ApplicationPreparationPack;
  context: ApplicationPreparationContext;
  now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  const content = buildStarStoryContent(input.context);
  const existing = input.pack.materials.starStories[0];
  const material = StarStoryMaterialSchema.parse(applyGuardToMaterial({
    existing,
    material: {
      ...baseMaterial({
        id: `star-story-${input.context.applicationId}`,
        materialType: "star_story",
        context: input.context,
        now
      }),
      generatedContent: content,
      currentContent: content,
      evidenceRefs: evidenceRefsForBlocks(
        input.context.resumeBlocks.filter((block) => content.sourceContentItemIds.includes(block.id)),
        input.context
      ),
      factGapIds: content.missingParts.includes("result")
        ? [`fact-gap-${input.context.applicationId}-star_story-result`]
        : []
    },
    context: input.context,
    reason: existing ? "regenerated" : "generated"
  }));
  const resultGap = content.missingParts.includes("result")
    ? [{
        id: `fact-gap-${input.context.applicationId}-star_story-result`,
        applicationId: input.context.applicationId,
        materialType: "star_story",
        description: "STAR 案例缺少已确认的结果或量化产出，不能自动补数字。",
        missingFactType: "result" as const,
        status: "open" as const,
        createdAt: now
      }]
    : [];
  return ApplicationPreparationPackSchema.parse({
    ...input.pack,
    basedOn: basedOnFromContext(input.context),
    materials: {
      ...input.pack.materials,
      starStories: [material]
    },
    factGaps: mergeFactGaps(input.pack.factGaps, resultGap),
    updatedAt: now,
    version: input.pack.version + 1
  });
}

export function editCoverLetterMaterial(input: {
  pack: ApplicationPreparationPack;
  context: ApplicationPreparationContext;
  language: MaterialLanguage;
  content: CoverLetterContent;
  now?: string;
}) {
  const existing = input.pack.materials.coverLetters[input.language];
  if (!existing) {
    throw new Error("material_not_found");
  }
  const now = input.now ?? new Date().toISOString();
  const material = CoverLetterMaterialSchema.parse(applyGuardToMaterial({
    existing,
    material: {
      ...existing,
      currentContent: input.content,
      userEdited: true,
      status: "draft",
      generationVersion: existing.generationVersion + 1,
      updatedAt: now
    },
    context: input.context,
    reason: "user_edit"
  }));
  return replaceMaterial(input.pack, material, now);
}

export function updateInterviewQuestion(input: {
  pack: ApplicationPreparationPack;
  questionId: string;
  userNotes?: string;
  preparationStatus?: InterviewQuestionItem["preparationStatus"];
  now?: string;
}) {
  const existing = input.pack.materials.interviewQuestions[0];
  if (!existing) {
    throw new Error("material_not_found");
  }
  const now = input.now ?? new Date().toISOString();
  const questions = existing.currentContent.questions.map((question) =>
    question.id === input.questionId
      ? {
          ...question,
          userNotes: input.userNotes ?? question.userNotes,
          preparationStatus: input.preparationStatus ?? question.preparationStatus
        }
      : question
  );
  const material = InterviewQuestionSetMaterialSchema.parse({
    ...existing,
    currentContent: { questions },
    userEdited: true,
    status: "draft",
    updatedAt: now,
    history: prependHistory(existing, "user_edit", now)
  });
  return replaceMaterial(input.pack, material, now);
}

export function markApplicationMaterialCompleted(input: {
  pack: ApplicationPreparationPack;
  materialId: string;
  now?: string;
}) {
  const material = findMaterial(input.pack, input.materialId);
  if (!material) {
    throw new Error("material_not_found");
  }
  if (material.status === "stale") {
    throw new Error("stale_material");
  }
  if (material.guardStatus === "blocked" || material.status === "blocked") {
    throw new Error("guard_blocked");
  }
  if (material.guardStatus === "needs_edit") {
    throw new Error("guard_needs_edit");
  }
  const now = input.now ?? new Date().toISOString();
  return replaceMaterial(input.pack, {
    ...material,
    status: "completed",
    completedAt: now,
    updatedAt: now
  }, now);
}

export function markApplicationMaterialNotNeeded(input: {
  pack: ApplicationPreparationPack;
  materialId: string;
  now?: string;
}) {
  const material = findMaterial(input.pack, input.materialId);
  if (!material) {
    throw new Error("material_not_found");
  }
  const now = input.now ?? new Date().toISOString();
  return replaceMaterial(input.pack, {
    ...material,
    status: "not_needed",
    updatedAt: now
  }, now);
}

export function restoreApplicationMaterialVersion(input: {
  pack: ApplicationPreparationPack;
  materialId: string;
  versionId: string;
  context: ApplicationPreparationContext;
  now?: string;
}) {
  const material = findMaterial(input.pack, input.materialId);
  if (!material) {
    throw new Error("material_not_found");
  }
  const snapshot = material.history.find((item) => item.id === input.versionId);
  if (!snapshot) {
    throw new Error("history_corrupted");
  }
  const now = input.now ?? new Date().toISOString();
  const restored = parseConcreteMaterial(applyGuardToMaterial({
    existing: material,
    material: {
      ...material,
      currentContent: snapshot.content,
      status: snapshot.status === "completed" ? "draft" : snapshot.status,
      userEdited: true,
      generationVersion: material.generationVersion + 1,
      updatedAt: now
    },
    context: input.context,
    reason: "restored"
  }));
  return replaceMaterial(input.pack, restored, now);
}

export function resolveApplicationFactGap(input: {
  pack: ApplicationPreparationPack;
  gapId: string;
  status: "resolved" | "ignored";
  now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  return ApplicationPreparationPackSchema.parse({
    ...input.pack,
    factGaps: input.pack.factGaps.map((gap) =>
      gap.id === input.gapId
        ? {
            ...gap,
            status: input.status,
            resolvedAt: now
          }
        : gap
    ),
    updatedAt: now,
    version: input.pack.version + 1
  });
}

function baseMaterial(input: {
  id: string;
  materialType: "cover_letter" | "application_email" | "self_introduction" | "interview_questions" | "star_story";
  context: ApplicationPreparationContext;
  now: string;
}) {
  return {
    id: input.id,
    materialType: input.materialType,
    status: "draft" as ApplicationMaterialStatus,
    basedOnRevisionId: input.context.revisionId,
    basedOnBranchRevision: input.context.branchRevision,
    basedOnPresentationRevision: input.context.presentationRevision,
    basedOnRequirementsHash: input.context.requirementsHash,
    basedOnExportRecordId: input.context.exportRecordId,
    evidenceRefs: [],
    factGapIds: [],
    guardStatus: "unchecked" as const,
    guardReasons: [],
    generationVersion: 1,
    userEdited: false,
    generatedAt: input.now,
    updatedAt: input.now,
    history: []
  };
}

function applyGuardToMaterial<T extends {
  currentContent: unknown;
  status: ApplicationMaterialStatus;
  guardStatus: string;
  guardReasons: string[];
  guardVersion?: string;
  history: MaterialVersionSnapshot[];
  generationVersion: number;
  updatedAt: string;
}>(input: {
  existing?: { currentContent: unknown; generationVersion: number; status: ApplicationMaterialStatus; guardStatus: string; guardReasons: string[]; history: MaterialVersionSnapshot[] };
  material: T;
  context: ApplicationPreparationContext;
  reason: MaterialVersionSnapshot["reason"];
}) {
  const guard = runApplicationMaterialGuard({
    context: input.context,
    content: input.material.currentContent
  });
  return {
    ...input.material,
    status: guard.statusSuggestion ?? input.material.status,
    guardStatus: guard.guardStatus,
    guardReasons: guard.guardReasons,
    guardVersion: guard.guardVersion,
    history: input.existing ? prependHistory(input.existing, input.reason, input.material.updatedAt) : input.material.history
  };
}

function prependHistory(
  material: { currentContent: unknown; generationVersion: number; status: ApplicationMaterialStatus; guardStatus: string; guardReasons: string[]; history: MaterialVersionSnapshot[] },
  reason: MaterialVersionSnapshot["reason"],
  now: string
): MaterialVersionSnapshot[] {
  return [
    {
      id: `material-history-${stableHashText(`${now}:${material.generationVersion}:${JSON.stringify(material.currentContent)}`).slice(0, 24)}`,
      generationVersion: material.generationVersion,
      status: material.status,
      content: material.currentContent,
      guardStatus: material.guardStatus as MaterialVersionSnapshot["guardStatus"],
      guardReasons: material.guardReasons,
      createdAt: now,
      reason
    },
    ...material.history
  ].slice(0, 5);
}

function replaceMaterial(
  pack: ApplicationPreparationPack,
  material: ApplicationPreparationMaterial,
  now: string
) {
  const materials = structuredClone(pack.materials);
  if (material.materialType === "cover_letter") {
    materials.coverLetters[(material as CoverLetterMaterial).language] = material as CoverLetterMaterial;
  } else if (material.materialType === "application_email") {
    const email = material as ApplicationEmailMaterial;
    materials.applicationEmails[emailKey(email.language, email.tone)] = email;
  } else if (material.materialType === "self_introduction") {
    const intro = material as SelfIntroductionMaterial;
    materials.selfIntroductions[selfIntroKey(intro.language, intro.durationSeconds)] = intro;
  } else if (material.materialType === "interview_questions") {
    materials.interviewQuestions = [material as InterviewQuestionSetMaterial];
  } else if (material.materialType === "star_story") {
    materials.starStories = [material as StarStoryMaterial];
  }
  return ApplicationPreparationPackSchema.parse({
    ...pack,
    materials,
    updatedAt: now,
    version: pack.version + 1
  });
}

function findMaterial(pack: ApplicationPreparationPack, materialId: string) {
  const all = [
    ...Object.values(pack.materials.coverLetters),
    ...Object.values(pack.materials.applicationEmails),
    ...Object.values(pack.materials.selfIntroductions),
    ...pack.materials.interviewQuestions,
    ...pack.materials.starStories
  ].filter(Boolean);
  return all.find((material) => material.id === materialId);
}

function parseConcreteMaterial(material: unknown): ApplicationPreparationMaterial {
  const candidate = material as { materialType?: string };
  if (candidate.materialType === "cover_letter") {
    return CoverLetterMaterialSchema.parse(material);
  }
  if (candidate.materialType === "application_email") {
    return ApplicationEmailMaterialSchema.parse(material);
  }
  if (candidate.materialType === "self_introduction") {
    return SelfIntroductionMaterialSchema.parse(material);
  }
  if (candidate.materialType === "interview_questions") {
    return InterviewQuestionSetMaterialSchema.parse(material);
  }
  if (candidate.materialType === "star_story") {
    return StarStoryMaterialSchema.parse(material);
  }
  throw new Error("material_not_found");
}

function basedOnFromContext(context: ApplicationPreparationContext): ApplicationPreparationBasedOn {
  return {
    branchId: context.branchId,
    revisionId: context.revisionId,
    branchRevision: context.branchRevision,
    presentationRevision: context.presentationRevision,
    requirementsHash: context.requirementsHash,
    exportRecordId: context.exportRecordId
  };
}

function buildCoverLetterContent(context: ApplicationPreparationContext, language: MaterialLanguage): CoverLetterContent {
  const blocks = selectEvidenceBlocks(context).slice(0, 3);
  if (language === "en") {
    return {
      salutation: "Dear hiring team,",
      opening: `I am applying for the ${context.jobTitle} role${context.company ? ` at ${context.company}` : ""}. This draft only uses facts already present in my current resume revision.`,
      bodyParagraphs: blocks.length > 0
        ? blocks.map((block) => `Relevant confirmed experience: ${trimText(block.text, 220)}`)
        : ["I do not yet have enough confirmed resume evidence for a stronger role-specific paragraph."],
      closing: "Thank you for reviewing my application. I would be glad to discuss the confirmed experience above in more detail.",
      signatureName: context.candidateName
    };
  }
  return {
    salutation: "尊敬的招聘团队：",
    opening: `我正在申请${context.company ? `${context.company}的` : ""}${context.jobTitle}岗位。以下内容仅基于当前锁定简历版本中的已确认事实。`,
    bodyParagraphs: blocks.length > 0
      ? blocks.map((block) => `与岗位相关的一段已确认经历是：${trimText(block.text, 180)}`)
      : ["当前锁定简历中还缺少足够的已确认经历证据，建议先补充事实后再强化求职信正文。"],
    closing: "感谢您审阅我的申请材料，期待有机会进一步沟通这些已确认经历与岗位要求的匹配点。",
    signatureName: context.candidateName
  };
}

function buildApplicationEmailContent(context: ApplicationPreparationContext, language: MaterialLanguage, tone: EmailTone): ApplicationEmailContent {
  const hasPdf = context.hasSuccessfulPdf;
  if (language === "en") {
    return {
      subject: `Application for ${context.jobTitle} - ${context.candidateName}`,
      greeting: "Dear hiring team,",
      bodyParagraphs: tone === "brief"
        ? [`I would like to apply for the ${context.jobTitle} role${context.company ? ` at ${context.company}` : ""}.`, "The attached materials, if any, should be checked by me before sending."]
        : [`I am writing to submit my application for the ${context.jobTitle} role${context.company ? ` at ${context.company}` : ""}.`, "This email is only a draft and should be reviewed against my confirmed resume facts before sending."],
      attachmentMentions: hasPdf ? ["Resume PDF from the current Application export record"] : [],
      closing: "Best regards,",
      senderName: context.candidateName
    };
  }
  return {
    subject: `${context.jobTitle}岗位申请 - ${context.candidateName}`,
    greeting: "您好：",
    bodyParagraphs: tone === "brief"
      ? [`我想申请${context.company ? `${context.company}的` : ""}${context.jobTitle}岗位。`, "这是一封投递邮件草稿，发送前仍需由我确认内容与附件。"]
      : [`我希望投递${context.company ? `${context.company}的` : ""}${context.jobTitle}岗位，随信提交当前 Application 下已确认的申请材料。`, "邮件正文仅基于当前简历与岗位信息生成，不包含自动发送或平台投递动作。"],
    attachmentMentions: hasPdf ? ["当前 Application 已关联的简历 PDF"] : [],
    closing: "谢谢！",
    senderName: context.candidateName
  };
}

function buildSelfIntroductionContent(context: ApplicationPreparationContext, language: MaterialLanguage, durationSeconds: 30 | 60): SelfIntroductionContent {
  const blocks = selectEvidenceBlocks(context);
  const picked = blocks.slice(0, durationSeconds === 30 ? 1 : 3);
  const evidenceText = picked.map((block) => trimText(block.text, durationSeconds === 30 ? 90 : 150)).join(language === "en" ? " " : "；");
  const seconds = estimateDurationSeconds(evidenceText, language);
  if (language === "en") {
    return {
      opening: `Hello, I am ${context.candidateName}.`,
      relevantExperience: evidenceText || "I need to add more confirmed resume facts before using a detailed introduction.",
      strengths: picked.map((block) => `Confirmed evidence from resume block ${block.id}`),
      roleFit: `For the ${context.jobTitle} role, I would focus the discussion on the confirmed experience above rather than adding unsupported claims.`,
      closing: durationSeconds === 30 ? "That is my brief introduction." : "I am happy to explain the details and evidence behind these experiences.",
      estimatedSeconds: Math.min(durationSeconds + 10, Math.max(10, seconds))
    };
  }
  return {
    opening: `您好，我是${context.candidateName}。`,
    relevantExperience: evidenceText || "当前还缺少足够的已确认简历事实，建议先补充事实后再使用详细自我介绍。",
    strengths: picked.map((block) => `来自当前简历区块的已确认依据：${trimText(block.text, 60)}`),
    roleFit: `针对${context.jobTitle}岗位，我会围绕上述已确认经历展开，不添加未经确认的技能、结果或职业目标。`,
    closing: durationSeconds === 30 ? "以上是我的简短介绍。" : "如果需要，我可以进一步说明这些经历的事实依据和与岗位要求的关联。",
    estimatedSeconds: Math.min(durationSeconds + 10, Math.max(10, seconds))
  };
}

function buildInterviewQuestions(context: ApplicationPreparationContext): InterviewQuestionItem[] {
  const requirement = [...context.requirements].sort((left, right) => requirementPriority(right) - requirementPriority(left))[0];
  const block = selectEvidenceBlocks(context)[0];
  const questions: InterviewQuestionItem[] = [];
  if (requirement) {
    questions.push({
      id: `interview-question-requirement-${requirement.id}`,
      category: "requirement_based",
      question: `这个岗位要求“${trimText(requirement.description, 60)}”，你会如何用已确认经历说明匹配度？`,
      whyAsked: "面试官通常会围绕 JD 中的核心要求追问具体证据。",
      requirementIds: [requirement.id],
      contentItemIds: [],
      evidenceRefs: materialRequirementEvidence(requirement),
      answerOutline: ["只引用当前简历中已有事实；缺少证据时说明需要补充。"],
      preparationStatus: context.requirementBlockMatches.some((match) => match.requirementId === requirement.id && match.matchLevel !== "none")
        ? "draft"
        : "needs_fact"
    });
  }
  if (block) {
    questions.push({
      id: `interview-question-resume-${block.id}`,
      category: "resume_based",
      question: `请展开说明这段简历经历：${trimText(block.text, 70)}`,
      whyAsked: "简历区块中的具体经历容易被要求补充背景、行动和结果。",
      requirementIds: [],
      contentItemIds: [block.id],
      evidenceRefs: evidenceRefsForBlocks([block], context),
      answerOutline: [`可引用事实：${trimText(block.text, 100)}`],
      preparationStatus: "draft"
    });
    questions.push({
      id: `interview-question-verification-${block.id}`,
      category: "verification",
      question: "这段经历中的职责、工具或数字是否都有事实依据？如果被追问，你会如何证明？",
      whyAsked: "核验问题用于确认简历表达是否真实、可解释。",
      requirementIds: [],
      contentItemIds: [block.id],
      evidenceRefs: evidenceRefsForBlocks([block], context),
      answerOutline: ["逐条对照原始事实，不补充未确认数字。"],
      preparationStatus: "draft"
    });
    questions.push({
      id: `interview-question-behavioral-${block.id}`,
      category: "behavioral",
      question: "请基于同一段真实经历，讲一次你如何推进任务或解决问题。",
      whyAsked: "行为面试会要求用同一段经历说明情境、行动和结果。",
      requirementIds: [],
      contentItemIds: [block.id],
      evidenceRefs: evidenceRefsForBlocks([block], context),
      answerOutline: ["使用 STAR 结构；缺少 Result 时明确补充事实缺口。"],
      preparationStatus: "draft"
    });
  }
  const verificationMaterial = context.verificationMaterials[0];
  if (verificationMaterial) {
    questions.push({
      id: `interview-question-material-${verificationMaterial.id}`,
      category: "verification",
      question: `申请材料要求“${trimText(verificationMaterial.label, 70)}”，你准备提供哪些可核验内容？`,
      whyAsked: "该项属于申请材料清单，不是简历技能或硬性能力。",
      requirementIds: [],
      contentItemIds: [],
      evidenceRefs: [],
      answerOutline: verificationMaterial.requiredComponents.length ? [`逐项准备：${verificationMaterial.requiredComponents.join("、")}`] : ["确认材料可访问，并避免在简历中把材料名称写成技能。"],
      preparationStatus: "needs_fact"
    });
  }
  const hiringSignal = context.hiringSignals[0];
  if (hiringSignal) {
    questions.push({
      id: `interview-question-signal-${hiringSignal.id}`,
      category: "behavioral",
      question: `请用真实经历说明：${trimText(hiringSignal.statement, 80)}`,
      whyAsked: "这是候选人画像信号，可用于自我评价和面试准备，但不作为硬条件计分。",
      requirementIds: [],
      contentItemIds: block ? [block.id] : [],
      evidenceRefs: block ? evidenceRefsForBlocks([block], context) : [],
      answerOutline: block ? [`只引用已确认经历：${trimText(block.text, 100)}`] : ["先补充一段真实经历，再组织回答。"],
      preparationStatus: block ? "draft" : "needs_fact"
    });
  }
  return questions.length > 0 ? questions : [{
    id: `interview-question-needs-fact-${context.applicationId}`,
    category: "verification",
    question: "当前简历缺少可追问的已确认经历，请先补充事实后再准备回答。",
    whyAsked: "没有事实证据时不能生成具体面试回答。",
    requirementIds: [],
    contentItemIds: [],
    evidenceRefs: [],
    answerOutline: [],
    preparationStatus: "needs_fact"
  }];
}

function requirementPriority(requirement: ApplicationPreparationContext["requirements"][number]) {
  if (requirement.hardConstraint || requirement.priority === "must") return 4;
  if (requirement.priority === "high" || requirement.priority === "important") return 3;
  if (requirement.priority === "medium") return 2;
  return 1;
}

function buildStarStoryContent(context: ApplicationPreparationContext): StarStoryContent {
  const block = selectEvidenceBlocks(context)[0] ?? context.resumeBlocks[0];
  if (!block) {
    return {
      title: "待补充 STAR 案例",
      sourceContentItemIds: [`missing-source-${context.applicationId}`],
      requirementIds: [],
      situation: "缺少已确认经历来源。",
      task: "需要用户补充真实经历事实。",
      action: "不得自动编造行动。",
      result: "结果信息缺失，需用户补充已确认事实。",
      missingParts: ["situation", "task", "action", "result"]
    };
  }
  const requirementIds = context.requirementBlockMatches
    .filter((match) => match.contentItemId === block.id)
    .map((match) => match.requirementId);
  const hasResult = /(\d|%|提升|增长|降低|优化|获奖|排名|交付|落地)/.test(block.text);
  return {
    title: `基于当前经历的 STAR 草稿`,
    sourceContentItemIds: [block.id],
    requirementIds: Array.from(new Set(requirementIds)),
    situation: `情境来自同一段简历经历：${trimText(block.text, 100)}`,
    task: "任务部分仅根据该经历原文整理，若原文不足需用户补充。",
    action: `行动依据：${trimText(block.text, 120)}`,
    result: hasResult ? `结果依据：${trimText(block.text, 120)}` : "结果信息缺失，需用户补充已确认事实。",
    missingParts: hasResult ? [] : ["result"]
  };
}

function deriveFactGaps(input: {
  context: ApplicationPreparationContext;
  materialType: string;
  now: string;
}): ApplicationFactGap[] {
  return input.context.requirementBlockMatches
    .filter((match) => match.matchLevel === "none" || match.matchLevel === "needs_confirmation")
    .map((match) => {
      const requirement = input.context.requirements.find((item) => item.id === match.requirementId);
      return {
        id: `fact-gap-${input.context.applicationId}-${input.materialType}-${match.requirementId}`,
        applicationId: input.context.applicationId,
        requirementId: match.requirementId,
        materialType: input.materialType,
        description: requirement
          ? `岗位要求缺少已确认事实支持：${trimText(requirement.description, 120)}`
          : "岗位要求缺少已确认事实支持。",
        missingFactType: missingFactTypeForRequirement(requirement),
        status: "open",
        createdAt: input.now
      };
    });
}

function mergeFactGaps(existing: ApplicationFactGap[], incoming: ApplicationFactGap[]) {
  const byId = new Map(existing.map((gap) => [gap.id, gap]));
  for (const gap of incoming) {
    const current = byId.get(gap.id);
    byId.set(gap.id, current ? { ...gap, status: current.status, resolvedAt: current.resolvedAt } : gap);
  }
  return Array.from(byId.values());
}

function missingFactTypeForRequirement(requirement: { category: string; description: string; keywords: string[] } | undefined): ApplicationFactGap["missingFactType"] {
  const text = `${requirement?.category ?? ""} ${requirement?.description ?? ""} ${(requirement?.keywords ?? []).join(" ")}`.toLowerCase();
  if (/sql|python|excel|tableau|power bi|技能|工具/.test(text)) {
    return "skill";
  }
  if (/%|\d|指标|增长|提升|量化/.test(text)) {
    return "metric";
  }
  if (/英语|英文|语言/.test(text)) {
    return "language";
  }
  if (/公司|业务|行业|产品/.test(text)) {
    return "company_knowledge";
  }
  if (/结果|成果|产出/.test(text)) {
    return "result";
  }
  if (/负责|职责|推进|管理/.test(text)) {
    return "responsibility";
  }
  return "other";
}

function selectEvidenceBlocks(context: ApplicationPreparationContext) {
  return context.resumeBlocks.filter((block) => block.evidenceRefs.length > 0).slice(0, 4);
}

function evidenceRefsForBlocks(blocks: ApplicationPreparationResumeBlock[], context: ApplicationPreparationContext): MaterialEvidenceRef[] {
  const resumeEvidence = blocks.map((block) => ({
    contentItemId: block.id,
    quote: trimText(block.text, 160),
    sourceType: "resume_block" as const,
    label: "当前锁定简历区块"
  }));
  const factEvidence = blocks.flatMap((block) => block.evidenceRefs.map((ref) => ({
    factId: factIdOf(ref),
    contentItemId: block.id,
    quote: trimText(ref.factText || ref.factQuote, 160),
    sourceType: "career_fact" as const,
    label: "已确认事实"
  })));
  const requirementEvidence = context.requirements.slice(0, 3).map((requirement) => ({
    requirementId: requirement.id,
    quote: trimText(requirement.description, 160),
    sourceType: "job_requirement" as const,
    label: "岗位要求"
  }));
  return dedupeMaterialEvidence([...resumeEvidence, ...factEvidence, ...requirementEvidence]);
}

function materialRequirementEvidence(requirement: { id: string; description: string }): MaterialEvidenceRef[] {
  return [{
    requirementId: requirement.id,
    quote: requirement.description,
    sourceType: "job_requirement",
    label: "岗位要求"
  }];
}

function dedupeMaterialEvidence(refs: MaterialEvidenceRef[]) {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.sourceType}:${ref.factId ?? ""}:${ref.contentItemId ?? ""}:${ref.requirementId ?? ""}:${ref.quote}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function factIdOf(ref: { type: string; factId?: string; linkedFactId?: string }) {
  return ref.factId ?? ref.linkedFactId;
}

function emailKey(language: MaterialLanguage, tone: EmailTone): EmailKey {
  return `${language}_${tone}` as EmailKey;
}

function selfIntroKey(language: MaterialLanguage, durationSeconds: 30 | 60): SelfIntroKey {
  return `${language}${durationSeconds}` as SelfIntroKey;
}

function estimateDurationSeconds(text: string, language: MaterialLanguage) {
  if (!text) {
    return 15;
  }
  if (language === "en") {
    return Math.ceil(text.split(/\s+/).filter(Boolean).length / 2.2);
  }
  return Math.ceil(text.length / 4.5);
}

function trimText(text: string, maxLength: number) {
  const normalized = text.trim().replace(/\s+/g, " ");
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

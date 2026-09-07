import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AGENT_QUICK_ACTION_INTENTS, createQuickActionIntent, type AgentQuickActionId } from "@/agent/contracts/agentQuickAction";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { AgentToolRegistry } from "@/agent/tools/registry";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { executeCareerWorkflowFacade } from "@/agent/workflows/CareerWorkflowFacade";
import { upsertAgentActivity } from "@/agent/runtime/AgentSessionMessages";
import { agentAttachmentStore } from "@/services/agent/AgentAttachmentStore";
import { CareerProfileSchema, ProfileStructuredFactSchema, ResumeItemV2Schema, type CareerProfile, type FactStatement, type ResumeItemV2 } from "@/domain/schemas";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2, projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  if (!db) return;
  db.close();
  await db.delete();
  db = undefined;
});

function createRepositoryStub() {
  return {
    getActiveCareerContext: vi.fn(async () => undefined),
    listCareerPersons: vi.fn(async () => []),
    listProfiles: vi.fn(async () => []),
    listResumeBranches: vi.fn(async () => []),
    listJobDescriptions: vi.fn(async () => [])
  };
}

function createHost(repository = createRepositoryStub()) {
  return new AgentHostStore({
    kernel: { runTurn: vi.fn() } as never,
    executor: { execute: vi.fn() } as never,
    persistence: {
      save: async (session: AgentSession) => session,
      getWorkspaceRepository: () => repository
    } as never,
    repository: repository as never
  });
}

function quickActionSession() {
  return AgentRuntime.create("agent-p4-7c", "collecting_intent");
}

describe("P4.7c core user journey and Profile data integrity contracts", () => {
  it("keeps all six Quick Action cards typed and free of synthetic UserMessages", async () => {
    const actionIds = Object.keys(AGENT_QUICK_ACTION_INTENTS) as AgentQuickActionId[];

    for (const actionId of actionIds) {
      const host = createHost();
      const intent = createQuickActionIntent(actionId);
      const prepared = await host.prepareRuntimeUserEvent({
        session: quickActionSession(),
        event: {
          type: "quick_action_started",
          actionId: intent.actionId,
          text: intent.intent,
          task: intent.task
        },
        pageContext: { pathname: "/ai-workspace", query: {} }
      });

      expect(prepared.session.messages.some((message) => message.role === "user")).toBe(false);
      expect(prepared.event).toMatchObject({ type: "quick_action_started", actionId });
      if (actionId === "import_existing_resume" || actionId === "build_profile_from_scratch") {
        expect(prepared.userMessage).toBe("");
      } else {
        expect(prepared.userMessage).toBe(intent.intent);
      }
    }
  });

  it("treats import and from-zero cards as Host commands without a synthetic UserMessage", async () => {
    const host = createHost();
    const importIntent = createQuickActionIntent("import_existing_resume");
    const intakeIntent = createQuickActionIntent("build_profile_from_scratch");

    const imported = await host.prepareRuntimeUserEvent({
      session: quickActionSession(),
      event: {
        type: "quick_action_started",
        actionId: importIntent.actionId,
        text: importIntent.intent,
        task: importIntent.task
      },
      pageContext: { pathname: "/ai-workspace", query: {} }
    });
    const intake = await host.prepareRuntimeUserEvent({
      session: imported.session,
      event: {
        type: "quick_action_started",
        actionId: intakeIntent.actionId,
        text: intakeIntent.intent,
        task: intakeIntent.task
      },
      pageContext: { pathname: "/ai-workspace", query: {} }
    });

    expect(imported.deterministicTerminal).toBe(true);
    expect(intake.deterministicTerminal).toBe(true);
    expect(intake.userMessage).toBe("");
    expect(intake.session.messages.some((message) => message.role === "user")).toBe(false);
  });

  it("opens the existing composer upload control before import work exists", async () => {
    const host = createHost();
    const intent = createQuickActionIntent("import_existing_resume");
    const session = await host.dispatch({
      type: "quick_action",
      actionId: intent.actionId,
      text: intent.intent,
      task: intent.task
    }, { session: quickActionSession(), pageContext: { pathname: "/ai-workspace", query: {} } });

    expect(session?.messages.some((message) => message.role === "user")).toBe(false);
    expect(host.getSnapshot().uiAction).toEqual({ type: "open_resume_upload" });
    expect(session?.taskState).toBeUndefined();
  });

  it("keeps resume import optional-profile and exposes a minimal model-facing compose schema", () => {
    const gateway = new CareerToolGateway(new AgentToolRegistry([]));
    const importContract = gateway.getContract("career.workflow.resume_import");
    const composeContract = gateway.getContract("career.workflow.compose_resume");

    expect(importContract.personProfileBinding).toBe("optional");
    expect(composeContract.personProfileBinding).toBe("required");
    expect(composeContract.inputSchema).toMatchObject({
      type: "object",
      oneOf: expect.arrayContaining([
        expect.objectContaining({ required: ["mode", "generalResumeMode"] })
      ])
    });
    expect(composeContract.inputSchema).not.toHaveProperty("properties.profileId");
    expect(composeContract.inputSchema).not.toHaveProperty("properties.expectedProfileRevision");
  });

  it("stops for Host profile binding before composing when a raw model call is unbound", async () => {
    const calls: string[] = [];
    const result = await executeCareerWorkflowFacade(
      "career.workflow.compose_resume",
      { mode: "general", generalResumeMode: "create_new" },
      { agentSessionId: "session-unbound-compose-1" },
      "compose-unbound-operation-1",
      async (name) => {
        calls.push(name);
        throw new Error("compose must not execute without Host binding");
      }
    );

    expect(calls).toEqual([]);
    expect(result.data).toMatchObject({
      status: "waiting_for_user",
      workflowStage: "select_profile_scope",
      nextAction: "select_profile",
      workflowCheckpoint: {
        kind: "resume_composition",
        reason: "profile_binding_required"
      }
    });
  });

  it("parses an import before target selection when no Profile is bound", async () => {
    const calls: Array<{ name: string; input: unknown }> = [];
    const result = await executeCareerWorkflowFacade(
      "career.workflow.resume_import",
      { attachmentId: "attachment-unbound-1" },
      { agentSessionId: "session-unbound-1" },
      "import-unbound-operation-1",
      async (name, input) => {
        calls.push({ name, input });
        return {
          ok: true,
          data: {
            importId: "import-draft-unbound-1",
            expectedDraftRevision: 1,
            sourceKind: "markdown",
            fileName: "resume.md",
            status: "ready_for_review",
            reviewSummary: { candidateCount: 1, needsConfirmationCount: 1 }
          },
          artifacts: [],
          receipt: {
            operationId: "atomic-import-unbound-1",
            toolName: name,
            status: "completed",
            completedAt: "2026-09-05T00:00:00.000Z"
          }
        };
      }
    );

    expect(calls).toEqual([{ name: "career.resume.import.prepare", input: { attachmentId: "attachment-unbound-1" } }]);
    expect(result.data).toMatchObject({
      status: "waiting_for_user",
      nextAction: "review_import",
      workflowCheckpoint: {
        kind: "resume_import_review",
        attachmentId: "attachment-unbound-1"
      }
    });
  });

  it("rejects an attachment that belongs to another Agent Session", async () => {
    const ref = await agentAttachmentStore.register(
      new File(["resume"], "resume.md", { type: "text/markdown" }),
      { agentSessionId: "session-a" }
    );
    try {
      expect(() => agentAttachmentStore.assertOwned(ref.id, "session-b")).toThrowError(
        expect.objectContaining({ code: "agent_attachment_session_mismatch" })
      );
      expect(agentAttachmentStore.assertOwned(ref.id, "session-a")).toEqual(ref);
    } finally {
      agentAttachmentStore.release(ref.id);
    }
  });

  it("keeps one collapsed semantic activity across lifecycle retries and transport operation ids", () => {
    let session: AgentSession = quickActionSession();
    session = upsertAgentActivity(session, {
      id: "agent-tool-logical-1",
      turnId: "turn-activity-1",
      content: "正在执行任务步骤…",
      toolName: "career.workflow.compose_resume",
      operationId: "transport-1",
      status: "pending",
      metadata: {
        activityState: "pending",
        logicalToolOperationId: "logical-activity-1",
        transportOperationIds: ["transport-1"]
      }
    });
    session = upsertAgentActivity(session, {
      id: "agent-tool-logical-1",
      turnId: "turn-activity-1",
      content: "该步骤未完成，当前进度已保留，可重试。",
      toolName: "career.workflow.compose_resume",
      operationId: "transport-2",
      status: "failed",
      metadata: {
        activityState: "failed",
        logicalToolOperationId: "logical-activity-1",
        transportOperationIds: ["transport-2"],
        safeErrorCode: "schema_validation_failed"
      }
    });

    const activities = session.messages.filter((message) => message.role === "tool");
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      status: "failed",
      content: "该步骤未完成，当前进度已保留，可重试。",
      metadata: {
        logicalToolOperationId: "logical-activity-1",
        transportOperationIds: ["transport-1", "transport-2"],
        safeErrorCode: "schema_validation_failed"
      }
    });
  });

  it("rebounds the same session to the late active Profile without replacing its conversation", async () => {
    db = new CareerAdaptDb(`CareerAdaptP47cRace-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const profile = migrateCareerProfileToV2(demoCareerProfile);
    await repository.saveProfile(profile);
    const original = AgentRuntime.create("agent-race-1", "collecting_intent");
    let persisted: AgentSession = original;
    const hostWithPersistence = new AgentHostStore({
      kernel: { runTurn: vi.fn() } as never,
      executor: { execute: vi.fn() } as never,
      repository,
      persistence: {
        get: vi.fn(async () => persisted),
        save: vi.fn(async (session: AgentSession) => {
          persisted = session;
          return session;
        }),
        getWorkspaceRepository: () => repository
      } as never
    });
    const rebound = await hostWithPersistence.rebindSessionCareerContext(original.id, {
      personId: profile.personId!,
      profileId: profile.id
    });

    expect(rebound.id).toBe(original.id);
    expect(rebound.activeProfileId).toBe(profile.id);
    expect(rebound.personId).toBe(profile.personId);
    expect(persisted.id).toBe(original.id);
  });

  it("preserves rich Profile lineage through write normalization and a general Resume revision", async () => {
    db = new CareerAdaptDb(`CareerAdaptP47cLineage-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const profile = richProfile();
    await repository.saveProfile(profile);

    const stored = await repository.getProfile(profile.id);
    const storedEducation = stored?.structuredFacts?.find((entry) => entry.data.id === "p47c-rich-education");
    const storedWork = stored?.structuredFacts?.find((entry) => entry.data.id === "p47c-rich-work");
    const storedProject = stored?.structuredFacts?.find((entry) => entry.data.id === "p47c-rich-project");
    const storedSecondProject = stored?.structuredFacts?.find((entry) => entry.data.id === "p47c-rich-project-2");
    const storedResearch = stored?.structuredFacts?.find((entry) => entry.data.id === "p47c-rich-research");
    expect(storedEducation?.data).toMatchObject({ sectionType: "education", school: "示例大学", major: "信息管理" });
    expect(storedEducation?.factIds).toHaveLength(3);
    expect(storedWork?.data).toMatchObject({ sectionType: "work", organization: "示例数据团队", highlights: ["整理业务数据", "核对运营口径", "协同产品与业务", "交付周报分析"] });
    expect(storedWork?.factIds).toHaveLength(4);
    expect(storedProject).toMatchObject({
      data: {
        sectionType: "project",
        tools: ["TypeScript", "Dexie", "Vitest"],
        background: "保留项目背景。",
        description: "保留完整职责段落。",
        highlights: ["完成需求拆解", "设计数据结构", "实现核心流程", "补充回归测试"],
        outcomes: ["结果一"]
      },
      factIds: [
        "fact-p47c-project-1",
        "fact-p47c-project-2",
        "fact-p47c-project-3",
        "fact-p47c-project-4"
      ]
    });
    expect(storedResearch).toMatchObject({
      data: {
        sectionType: "research",
        methods: ["访谈", "回归分析"],
        samples: "31 个省级样本",
        publication: "职业适配研究报告",
        publicationStatus: "已提交",
        description: "研究职责保留。",
        highlights: ["形成研究结论"]
      },
      factIds: ["fact-p47c-research"]
    });
    expect(storedSecondProject?.data).toMatchObject({
      sectionType: "project",
      background: "围绕跨境订单数据建立分析流程。",
      highlights: ["清理订单数据", "定义核心指标", "分析异常原因"],
      outcomes: ["形成运营分析看板并完成课堂汇报"]
    });
    expect(storedSecondProject?.factIds).toHaveLength(3);
    const projectMirror = stored?.experiences.find((entry) => entry.id === "p47c-rich-project");
    expect(projectMirror?.resumeDrafts[0]?.text).toBe(projectResumeItemV2(storedProject!.data));

    const created = await repository.createGeneralResumeBranch({
      profileId: profile.id,
      operationId: "p47c-rich-lineage-branch",
      name: "P4.7c 富内容通用简历",
      includeProfileFacts: true,
      includeProfileBasics: true
    });
    const reloadedBranch = await repository.getResumeBranch(created.branch.id);
    const reloadedRevision = await repository.getResumeRevision(created.revision!.id);
    const branchProject = reloadedBranch?.structuredContentItems?.find((item) => item.data.id === "p47c-rich-project");
    const revisionProject = reloadedRevision?.snapshot.structuredContentItems?.find((item) => item.data.id === "p47c-rich-project");
    expect(branchProject?.data).toEqual(storedProject!.data);
    expect(branchProject?.factRefs).toEqual([
      { type: "experience_fact", experienceId: "p47c-rich-project", factId: "fact-p47c-project-1" },
      { type: "experience_fact", experienceId: "p47c-rich-project", factId: "fact-p47c-project-2" },
      { type: "experience_fact", experienceId: "p47c-rich-project", factId: "fact-p47c-project-3" },
      { type: "experience_fact", experienceId: "p47c-rich-project", factId: "fact-p47c-project-4" }
    ]);
    expect(revisionProject?.data).toEqual(storedProject!.data);
    expect(reloadedBranch?.branchPurpose).toBe("general");
  });

  it("fails Profile persistence rather than retaining an orphan structured fact reference", async () => {
    db = new CareerAdaptDb(`CareerAdaptP47cIntegrity-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const base = migrateCareerProfileToV2(demoCareerProfile);
    const invalid = CareerProfileSchema.parse({
      ...base,
      structuredFacts: [
        ...(base.structuredFacts ?? []),
        ProfileStructuredFactSchema.parse({
          data: ResumeItemV2Schema.parse({
            id: "p47c-orphan-project",
            sectionType: "project",
            title: "孤立项目",
            description: "这条内容不能引用不存在的事实。",
            customFields: []
          }),
          factIds: ["fact-does-not-exist"],
          sourceBlockIds: ["block-orphan"],
          mappingTrace: []
        })
      ]
    });

    await expect(repository.saveProfile(invalid)).rejects.toMatchObject({
      code: "profile_fact_reference_unresolved",
      factIds: ["fact-does-not-exist"]
    });
    expect(await repository.getProfile(invalid.id)).toBeUndefined();
  });
});

function richProfile(): CareerProfile {
  const base = migrateCareerProfileToV2(demoCareerProfile);
  const now = "2026-09-05T00:00:00.000Z";
  const education = ResumeItemV2Schema.parse({
    id: "p47c-rich-education",
    sectionType: "education",
    school: "示例大学",
    major: "信息管理",
    degree: "本科",
    startDate: "2022-09",
    endDate: "2026-06",
    courses: ["数据分析", "数据库原理"],
    honors: ["优秀学生"],
    description: "完成信息管理本科阶段学习。",
    highlights: ["完成数据分析课程", "完成数据库课程", "完成毕业设计"],
    customFields: []
  }) as Extract<ResumeItemV2, { sectionType: "education" }>;
  const educationFacts = [
    richFact("fact-p47c-education-1", "在示例大学完成信息管理本科阶段学习。", now, "education"),
    richFact("fact-p47c-education-2", "完成数据分析与数据库原理课程。", now, "education"),
    richFact("fact-p47c-education-3", "完成毕业设计并形成可展示的研究交付物。", now, "education")
  ];
  const work = ResumeItemV2Schema.parse({
    id: "p47c-rich-work",
    sectionType: "work",
    organization: "示例数据团队",
    role: "数据运营实习生",
    startDate: "2025-06",
    endDate: "2025-08",
    description: "参与数据运营流程和跨团队交付。",
    highlights: ["整理业务数据", "核对运营口径", "协同产品与业务", "交付周报分析"],
    customFields: []
  }) as Extract<ResumeItemV2, { sectionType: "work" }>;
  const workFacts = [
    richFact("fact-p47c-work-1", "整理业务数据并维护统一字段口径。", now),
    richFact("fact-p47c-work-2", "核对运营数据，记录并反馈异常项。", now),
    richFact("fact-p47c-work-3", "协同产品与业务同学推进需求确认。", now),
    richFact("fact-p47c-work-4", "交付周报分析，支持团队复盘。", now)
  ];
  const project = ResumeItemV2Schema.parse({
    id: "p47c-rich-project",
    sectionType: "project",
    title: "证据链项目",
    role: "产品与数据协作",
    organization: "CareerAdapt",
    startDate: "2026-01",
    current: true,
    tools: ["TypeScript", "Dexie", "Vitest"],
    background: "保留项目背景。",
    description: "保留完整职责段落。",
    highlights: ["完成需求拆解", "设计数据结构", "实现核心流程", "补充回归测试"],
    outcomes: ["结果一"],
    customFields: []
  }) as Extract<ResumeItemV2, { sectionType: "project" }>;
  const projectFacts = [
    richFact("fact-p47c-project-1", "完成项目需求拆解并明确用户流程。", now),
    richFact("fact-p47c-project-2", "使用 TypeScript 与 Dexie 设计结构化数据模型。", now),
    richFact("fact-p47c-project-3", "实现核心导入与资料整理流程。", now),
    richFact("fact-p47c-project-4", "使用 Vitest 补充回归测试，形成结果一。", now)
  ];
  const secondProject = ResumeItemV2Schema.parse({
    id: "p47c-rich-project-2",
    sectionType: "project",
    title: "跨境运营分析项目",
    role: "分析与流程协作",
    organization: "课程实践小组",
    startDate: "2025-02",
    endDate: "2025-05",
    tools: ["Excel", "SQL"],
    background: "围绕跨境订单数据建立分析流程。",
    description: "负责数据整理、指标定义与结论汇报。",
    highlights: ["清理订单数据", "定义核心指标", "分析异常原因"],
    outcomes: ["形成运营分析看板并完成课堂汇报"],
    customFields: []
  }) as Extract<ResumeItemV2, { sectionType: "project" }>;
  const secondProjectFacts = [
    richFact("fact-p47c-project-2-1", "清理跨境订单数据并统一时间与渠道字段。", now),
    richFact("fact-p47c-project-2-2", "使用 Excel 与 SQL 定义并计算核心运营指标。", now),
    richFact("fact-p47c-project-2-3", "分析异常原因，形成运营分析看板并完成课堂汇报。", now)
  ];
  const research = ResumeItemV2Schema.parse({
    id: "p47c-rich-research",
    sectionType: "research",
    title: "职业适配研究",
    authorRole: "研究成员",
    institution: "示例大学",
    startDate: "2025-09",
    methods: ["访谈", "回归分析"],
    samples: "31 个省级样本",
    publication: "职业适配研究报告",
    publicationStatus: "已提交",
    description: "研究职责保留。",
    highlights: ["形成研究结论"],
    customFields: []
  }) as Extract<ResumeItemV2, { sectionType: "research" }>;
  const researchFact = richFact("fact-p47c-research", projectResumeItemV2(research), now);
  return CareerProfileSchema.parse({
    ...base,
    experiences: [
      ...base.experiences,
      {
        id: education.id,
        type: "education",
        organization: education.school ?? "示例大学",
        role: education.degree ?? "本科",
        major: education.major,
        courses: education.courses,
        startDate: education.startDate,
        endDate: education.endDate,
        facts: educationFacts,
        resumeDrafts: [{ id: "draft-p47c-education", text: projectResumeItemV2(education), factIds: educationFacts.map((fact) => fact.id), createdAt: now, updatedAt: now }],
        tags: ["education"],
        evidenceIds: [],
        createdAt: now,
        updatedAt: now
      },
      {
        id: work.id,
        type: "work",
        organization: work.organization ?? "示例数据团队",
        role: work.role ?? "数据运营实习生",
        startDate: work.startDate,
        endDate: work.endDate,
        facts: workFacts,
        resumeDrafts: [{ id: "draft-p47c-work", text: projectResumeItemV2(work), factIds: workFacts.map((fact) => fact.id), createdAt: now, updatedAt: now }],
        tags: ["work"],
        evidenceIds: [],
        createdAt: now,
        updatedAt: now
      },
      {
        id: project.id,
        type: "project",
        organization: project.organization ?? "CareerAdapt",
        role: project.role ?? "项目成员",
        startDate: project.startDate,
        facts: projectFacts,
        resumeDrafts: [{ id: "draft-p47c-project", text: projectResumeItemV2(project), factIds: projectFacts.map((fact) => fact.id), createdAt: now, updatedAt: now }],
        tags: ["project"],
        evidenceIds: [],
        createdAt: now,
        updatedAt: now
      },
      {
        id: secondProject.id,
        type: "project",
        organization: secondProject.organization ?? "课程实践小组",
        role: secondProject.role ?? "分析与流程协作",
        startDate: secondProject.startDate,
        endDate: secondProject.endDate,
        facts: secondProjectFacts,
        resumeDrafts: [{ id: "draft-p47c-project-2", text: projectResumeItemV2(secondProject), factIds: secondProjectFacts.map((fact) => fact.id), createdAt: now, updatedAt: now }],
        tags: ["project"],
        evidenceIds: [],
        createdAt: now,
        updatedAt: now
      },
      {
        id: research.id,
        type: "other",
        organization: research.institution ?? "示例大学",
        role: research.authorRole ?? "研究成员",
        startDate: research.startDate,
        facts: [researchFact],
        resumeDrafts: [{ id: "draft-p47c-research", text: projectResumeItemV2(research), factIds: [researchFact.id], createdAt: now, updatedAt: now }],
        tags: ["research"],
        evidenceIds: [],
        createdAt: now,
        updatedAt: now
      }
    ],
    structuredFacts: [
      ...(base.structuredFacts ?? []),
      ProfileStructuredFactSchema.parse({
        data: project,
        factIds: projectFacts.map((fact) => fact.id),
        sourceBlockIds: ["block-p47c-project"],
        sourceExcerpt: "项目完整来源摘录",
        mappingTrace: [],
        provenance: [{ kind: "source_turn", sourceTurnId: "turn-p47c-project", fieldNames: ["background", "description", "highlights", "outcomes", "tools"] }]
      }),
      ProfileStructuredFactSchema.parse({
        data: research,
        factIds: [researchFact.id],
        sourceBlockIds: ["block-p47c-research"],
        sourceExcerpt: "研究完整来源摘录",
        mappingTrace: [],
        provenance: [{ kind: "source_turn", sourceTurnId: "turn-p47c-research", fieldNames: ["methods", "samples", "publication", "publicationStatus", "description", "highlights"] }]
      }),
      ProfileStructuredFactSchema.parse({
        data: education,
        factIds: educationFacts.map((fact) => fact.id),
        sourceBlockIds: ["block-p47c-education"],
        sourceExcerpt: "教育经历完整来源摘录",
        mappingTrace: [],
        provenance: [{ kind: "source_turn", sourceTurnId: "turn-p47c-education", fieldNames: ["school", "major", "degree", "courses", "honors", "description", "highlights"] }]
      }),
      ProfileStructuredFactSchema.parse({
        data: work,
        factIds: workFacts.map((fact) => fact.id),
        sourceBlockIds: ["block-p47c-work"],
        sourceExcerpt: "工作经历完整来源摘录",
        mappingTrace: [],
        provenance: [{ kind: "source_turn", sourceTurnId: "turn-p47c-work", fieldNames: ["description", "highlights"] }]
      }),
      ProfileStructuredFactSchema.parse({
        data: secondProject,
        factIds: secondProjectFacts.map((fact) => fact.id),
        sourceBlockIds: ["block-p47c-project-2"],
        sourceExcerpt: "第二个项目完整来源摘录",
        mappingTrace: [],
        provenance: [{ kind: "source_turn", sourceTurnId: "turn-p47c-project-2", fieldNames: ["background", "description", "highlights", "outcomes", "tools"] }]
      })
    ]
  });
}

function richFact(id: string, statement: string, now: string, category: "basic" | "education" | "experience" | "skill" | "certificate" | "achievement" | "language" | "other" = "experience"): FactStatement {
  return {
    id,
    statement,
    category,
    provenance: [{ sourceType: "imported_text", sourceId: `source-${id}`, sourceText: statement, confidence: 1, confirmedByUser: true, riskLevel: "low", createdAt: now }],
    confirmedByUser: true,
    riskLevel: "low",
    createdAt: now,
    updatedAt: now
  };
}

import { afterEach, expect, it } from "vitest";
import {
  CareerProfileSchema,
  ImportedResumeDraftSchema,
  ResumeBranchSchema,
  ResumeContentItemV2Schema,
  ResumeItemV2Schema,
  type CareerProfile,
  type ImportedResumeDraft,
  type ResumeBranch
} from "@/domain/schemas";
import {
  applyProfileRecoveryItems,
  buildProfileRecoveryCandidates
} from "@/domain/profile/profileContentRecovery";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

const NOW = "2026-08-19T00:00:00.000Z";
const PROFILE_ID = "profile-5PV7uCZWGh";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  db?.close();
  if (db) await db.delete();
  db = undefined;
});

function currentProfile(): CareerProfile {
  const projectIds = ["project-1", "project-2", "project-3", "project-4"];
  const structuredFacts = [
    ...projectIds.map((id, index) => ({
      data: ResumeItemV2Schema.parse({
        id,
        sectionType: "project",
        title: `项目 ${index + 1}`,
        role: "工程师",
        highlights: [],
        outcomes: [],
        tools: [],
        customFields: []
      }),
      factIds: [`fact-${id}`],
      sourceBlockIds: [],
      sourceRanges: [],
      mappingTrace: []
    })),
    {
      data: ResumeItemV2Schema.parse({
        id: "work-1",
        sectionType: "work",
        organization: "CareerAdapt",
        role: "工程师",
        highlights: [],
        customFields: []
      }),
      factIds: ["fact-work-1"],
      sourceBlockIds: [],
      sourceRanges: [],
      mappingTrace: []
    }
  ];
  const experiences = [
    ...projectIds.map((id, index) => ({
      id,
      type: "project" as const,
      organization: `项目 ${index + 1}`,
      role: "工程师",
      facts: [fact(`fact-${id}`, `已有项目 ${index + 1} 占位事实`)],
      resumeDrafts: [],
      tags: [],
      evidenceIds: [],
      createdAt: NOW,
      updatedAt: NOW
    })),
    {
      id: "work-1",
      type: "work" as const,
      organization: "CareerAdapt",
      role: "工程师",
      facts: [fact("fact-work-1", "已有工作经历占位事实")],
      resumeDrafts: [],
      tags: [],
      evidenceIds: [],
      createdAt: NOW,
      updatedAt: NOW
    }
  ];

  return CareerProfileSchema.parse({
    id: PROFILE_ID,
    personId: "person-5PV7uCZWGh",
    profileVersionNumber: 5,
    isCurrent: true,
    versionCreatedReason: "initial",
    schemaVersion: "career-profile-v2",
    name: "真实恢复夹具",
    basics: { name: "真实恢复夹具", links: [] },
    structuredBasics: { name: "真实恢复夹具", otherLinks: [], customFields: [] },
    preference: { targetRoles: [], targetCities: [], industries: [] },
    version: 5,
    experiences,
    skills: [],
    certificates: [],
    evidences: [],
    unclassifiedBlocks: [],
    structuredFacts,
    createdAt: NOW,
    updatedAt: NOW
  });
}

function fact(id: string, statement: string) {
  return {
    id,
    statement,
    category: "experience" as const,
    provenance: [{
      sourceType: "user_input" as const,
      sourceId: id,
      sourceText: statement,
      confidence: 1,
      confirmedByUser: false,
      riskLevel: "low" as const,
      createdAt: NOW
    }],
    confirmedByUser: false,
    riskLevel: "low" as const,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function importedDraft(profileId = PROFILE_ID): ImportedResumeDraft {
  const projects = ["project-1", "project-2", "project-3", "project-4"].map((id, index) => {
    const data = ResumeItemV2Schema.parse({
      id,
      sectionType: "project",
      title: `项目 ${index + 1}`,
      role: "工程师",
      highlights: [1, 2, 3, 4].map((bullet) => `项目 ${index + 1} 成果 ${bullet}`),
      outcomes: [],
      tools: [],
      customFields: []
    });
    return importedItem(data, index);
  });
  const work = ResumeItemV2Schema.parse({
    id: "work-1",
    sectionType: "work",
    organization: "CareerAdapt",
    role: "工程师",
    highlights: ["工作成果 1", "工作成果 2"],
    customFields: []
  });

  return ImportedResumeDraftSchema.parse({
    id: "import-authoritative-real-profile",
    schemaVersion: "resume-import-v1",
    importId: "import-authoritative-real-profile",
    revision: 5,
    status: "confirmed",
    confirmedProfileId: profileId,
    confirmedRevisionId: "import-revision-5",
    confirmedAt: NOW,
    sourceKind: "standard_json",
    source: {
      fileName: "confirmed-real-profile.json",
      mimeType: "application/json",
      fileHash: "0123456789abcdef0123456789abcdef",
      pageCount: 1,
      extractedAt: NOW
    },
    basics: { links: [] },
    sections: [
      {
        id: "projects",
        sectionType: "project",
        category: "project",
        detectedTitle: "项目经历",
        included: true,
        order: 0,
        confidence: "high",
        items: projects
      },
      {
        id: "work",
        sectionType: "work",
        category: "work",
        detectedTitle: "工作经历",
        included: true,
        order: 1,
        confidence: "high",
        items: [importedItem(work, 0)]
      }
    ],
    pages: [],
    unclassifiedBlocks: [],
    warnings: [],
    parserVersion: "p45c1c24-test",
    createdAt: NOW,
    updatedAt: NOW
  });
}

function importedItem(data: ReturnType<typeof ResumeItemV2Schema.parse>, order: number) {
  return {
    id: data.id,
    rawText: `来源 ${data.id}`,
    normalizedText: `来源 ${data.id}`,
    included: true,
    order,
    pageRefs: [],
    confidence: "high" as const,
    sourceStatus: "located" as const,
    userEdited: false,
    sourceBlockIds: [],
    structuredItem: data,
    structuredMappingTrace: []
  };
}

function generalResume(profileId = PROFILE_ID): ResumeBranch {
  const dataItems = [
    ...["project-1", "project-2", "project-3", "project-4"].map((id, index) => ResumeItemV2Schema.parse({
      id,
      sectionType: "project",
      title: `项目 ${index + 1}`,
      role: "工程师",
      highlights: [`通用简历项目 ${index + 1} 成果`],
      outcomes: [],
      tools: [],
      customFields: []
    })),
    ResumeItemV2Schema.parse({
      id: "work-1",
      sectionType: "work",
      organization: "CareerAdapt",
      role: "工程师",
      highlights: ["通用简历工作成果"],
      customFields: []
    })
  ];
  const structuredContentItems = dataItems.map((data, order) => {
    const legacyText = `${data.id}\n${"highlights" in data ? data.highlights.join("\n") : ""}`;
    const factRefs = [{ type: "experience_fact" as const, experienceId: data.id, factId: `fact-${data.id}` }];
    return ResumeContentItemV2Schema.parse({
      id: data.id,
      schemaVersion: "resume-content-item-v2",
      data,
      factRefs,
      source: "resume_import",
      order,
      visible: true,
      guardMode: "rule_verified",
      guardStatus: "pass",
      guardFindings: [],
      legacyTextProjection: legacyText,
      sourceBlockIds: [],
      sourceRanges: [],
      mappingTrace: []
    });
  });
  const contentItems = structuredContentItems.map((item) => ({
    id: item.id,
    itemType: "experience" as const,
    source: "resume_import" as const,
    text: item.legacyTextProjection!,
    originalText: item.legacyTextProjection!,
    order: item.order,
    visible: item.visible,
    requirementIds: [],
    sourceSuggestionIds: [],
    factRefs: item.factRefs,
    guardMode: item.guardMode,
    guardStatus: item.guardStatus,
    guardRiskLevel: "low" as const,
    guardFindings: []
  }));

  return ResumeBranchSchema.parse({
    id: "general-resume-real-profile",
    schemaVersion: "resume-branch-v2",
    branchPurpose: "general",
    profileId,
    sourceImportId: "import-general-resume",
    name: "General Resume",
    sourceProfileVersion: 5,
    sourceDraftRevision: 0,
    matcherVersion: "p45c1c24-test",
    sourceMatchSetHash: "0123456789abcdef",
    revision: 1,
    currentRevisionId: "general-resume-revision-1",
    lifecycleStatus: "active",
    migrationStatus: "verified",
    syncStatusCache: {
      status: "in_sync",
      sourceProfileVersion: 5,
      currentProfileVersion: 5,
      checkedAt: NOW,
      message: "test"
    },
    contentItems,
    structuredContentItems,
    tailoringAppliedCount: 0,
    createdAt: NOW,
    updatedAt: NOW
  });
}

it("recovers exact confirmed import content into the same five Profile identities", () => {
  const profile = currentProfile();
  const draft = importedDraft();
  const [candidate] = buildProfileRecoveryCandidates({ profile, importedDraft: draft });

  expect(candidate).toMatchObject({
    sourceType: "imported_resume_draft",
    sourceRevisionId: "import-revision-5",
    candidateType: "authoritative_exact",
    confidence: "high",
    requiresUserConfirmation: true,
    projectCount: 4,
    projectBulletCount: 16,
    workCount: 1,
    workBulletCount: 2,
    affectedEntityCount: 5
  });
  expect(candidate.targetIds).toEqual(expect.arrayContaining(["project-1", "project-2", "project-3", "project-4", "work-1"]));
  expect(candidate.items.map((item) => item.targetExperienceId)).toEqual(expect.arrayContaining(["project-1", "project-2", "project-3", "project-4", "work-1"]));

  const repaired = applyProfileRecoveryItems({ profile, items: candidate.items, now: NOW });
  expect(repaired.id).toBe(profile.id);
  expect(repaired.structuredFacts).toHaveLength(5);
  expect(repaired.experiences.map((experience) => experience.id)).toEqual(profile.experiences.map((experience) => experience.id));
  expect(repaired.structuredFacts?.filter((entry) => entry.data.sectionType === "project").reduce((total, entry) => total + ("highlights" in entry.data ? entry.data.highlights.length : 0), 0)).toBe(16);
  expect(repaired.structuredFacts?.filter((entry) => entry.data.sectionType === "work").reduce((total, entry) => total + ("highlights" in entry.data ? entry.data.highlights.length : 0), 0)).toBe(2);
});

it("keeps General Resume recovery as a lower-confidence confirmation candidate", () => {
  const profile = currentProfile();
  const [candidate] = buildProfileRecoveryCandidates({ profile, generalResume: generalResume() });

  expect(candidate).toMatchObject({
    sourceType: "general_resume",
    sourceResumeId: "general-resume-real-profile",
    sourceRevisionId: "general-resume-revision-1",
    candidateType: "presentation_recovery",
    confidence: "medium",
    requiresUserConfirmation: true,
    projectCount: 4,
    workCount: 1
  });
  expect(candidate.targetIds).toEqual(expect.arrayContaining(["project-1", "project-2", "project-3", "project-4", "work-1"]));
  expect(candidate.targetExperienceIds).toEqual(expect.arrayContaining(["project-1", "project-2", "project-3", "project-4", "work-1"]));
});

it("writes an explicitly confirmed recovery as revision plus one on the same Profile", async () => {
  db = new CareerAdaptDb(`CareerAdaptP45C1C24-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const profile = currentProfile();
  await repository.saveProfile(profile);
  await repository.setActiveCareerContext({ personId: profile.personId!, profileId: profile.id });
  await repository.saveImportedResumeDraft(importedDraft(profile.id), 0);

  const persistedDraft = await repository.getLatestImportedResumeDraftForProfile(profile.id);
  expect(persistedDraft?.confirmedProfileId).toBe(profile.id);
  const [candidate] = buildProfileRecoveryCandidates({ profile, importedDraft: persistedDraft });
  const result = await repository.repairProfileContent({
    profileId: profile.id,
    expectedProfileVersion: profile.version,
    operationId: "profile-recovery-real-profile-op-1",
    sourceType: candidate.sourceType,
    items: candidate.items
  });

  expect(result).toMatchObject({
    profileId: profile.id,
    profileVersion: 6,
    sourceType: "imported_resume_draft",
    idempotent: false
  });
  const readback = await repository.getProfile(profile.id);
  expect(readback?.id).toBe(profile.id);
  expect(readback?.version).toBe(6);
  expect(readback?.profileVersionNumber).toBe(5);
  expect((await repository.getProfilesForPerson(profile.personId!))).toHaveLength(1);
  expect((await repository.repairProfileContent({
    profileId: profile.id,
    expectedProfileVersion: profile.version,
    operationId: "profile-recovery-real-profile-op-1",
    sourceType: candidate.sourceType,
    items: candidate.items
  })).idempotent).toBe(true);
});

import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { CareerProfileSchema, ResumeItemV2Schema } from "@/domain/schemas";
import { projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import { demoCareerProfile } from "@/data/demoProfile";

export async function researchSeedPayload() {
  const db = new CareerAdaptDb(`research-pagination-${crypto.randomUUID()}`);
  const repo = new WorkspaceRepository(db);
  try {
    const profile = await repo.saveProfile(CareerProfileSchema.parse({ ...demoCareerProfile, id: `research-profile-${crypto.randomUUID()}`, experiences: [], skills: [], certificates: [], evidences: [], structuredFacts: [] }));
    if (!profile.personId) throw new Error("fixture_person_missing");
    await repo.setActiveCareerContext({ personId: profile.personId, profileId: profile.id });
    const created = await repo.createGeneralResumeBranch({ profileId: profile.id, operationId: "research-create", name: "匿名分页简历", includeProfileFacts: false, includeProfileBasics: true });
    const seed = { branchId: created.branch.id, profileId: profile.id, personId: profile.personId };
    let revision = created.branch.revision;
    for (let i = 1; i <= 4; i++) {
      const title = `《匿名研究${i}：基于机器学习的非线性数据分析框架》`;
      const highlights = Array.from({ length: 5 }, (_, n) => `研究${i}成果${n + 1}：运用多种方法核验数据，整理研究过程并形成可复核的分析报告。`.repeat(2));
      const structuredItem = ResumeItemV2Schema.parse({ id: `research-${i}`, sectionType: "research", title, authorRole: "第一作者", startDate: "2025-03", endDate: "2025-11", current: false, methods: [], highlights, customFields: [] });
      const result = await repo.addResumeContentItem({ branchId: seed.branchId, expectedRevision: revision, operationId: `research-fixture-${i}`, section: "research", itemType: "custom", text: projectResumeItemV2(structuredItem), structuredItem });
      revision = result.branch.revision;
    }
    const branch = await repo.getResumeBranch(seed.branchId);
    if (!branch?.currentRevisionId) throw new Error("fixture_branch_missing");
    const config = await repo.getResumePresentationConfig(seed.branchId);
    await repo.saveResumePresentationConfig({ branchId: seed.branchId, expectedBranchRevision: branch.revision, expectedRevisionId: branch.currentRevisionId, expectedPresentationRevision: config.presentationRevision, operationId: "research-fixture-presentation", nextConfig: { ...config, templateId: "campus-reference", precision: { fontSizePx: 14.8, entryStyle: "inline", lineHeight: 1.56, sectionGapPx: 10, titleStyle: "tint" }, presentationRevision: config.presentationRevision + 1 } });
    return { databaseName: "CareerAdaptDb", expectedProfileId: seed.profileId, expectedPersonId: seed.personId, expectedBranchId: seed.branchId, rows: { profiles: [profile], resumeBranches: [branch], resumeRevisions: await db.resumeRevisions.where("branchId").equals(seed.branchId).toArray(), appMeta: await db.appMeta.toArray() } };
  } finally { db.close(); await db.delete(); }
}

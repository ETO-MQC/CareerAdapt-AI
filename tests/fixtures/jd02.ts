import { demoCareerProfile } from "@/data/demoProfile";
import { buildGeneralBranchFromProfile } from "@/domain/branch/profileBranch";
import { createResumeRevision } from "@/domain/branch/revision";
import { migrateCareerProfileToV2, projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import { analyzeJobDescriptionV4, projectJobGraphV4ToAnalyzerOutput } from "@/domain/jobOptimization";
import { JobDescriptionSchema } from "@/domain/schemas";
export function jd02Fixture() {
  const base = structuredClone(demoCareerProfile);
  base.experiences = [{ ...base.experiences[1], id: "jd02-exp", tags: [], facts: ["Python", "JavaScript"].map((name, i) => ({ ...base.experiences[1].facts[0], id: `jd02-f${i+1}`, statement: `使用 ${name} 完成项目开发`, maturity: "demonstrated" as const, confirmedByUser: true, provenance: [{ ...base.experiences[1].facts[0].provenance[0], sourceText: `使用 ${name} 完成项目开发`, confirmedByUser: true }] })) }];
  base.skills = []; base.certificates = []; base.evidences = []; base.basics.summary = undefined;
  const profile = migrateCareerProfileToV2(base);
  const branches = [0, 1].map(index => {
    const { branch } = buildGeneralBranchFromProfile({ profile, operationId: `jd02-${index}`, name: `JD02 来源 ${index+1}`, includeProfileFacts: true, includeProfileBasics: true });
    branch.id = `jd02-branch-${index+1}`;
    const item = branch.structuredContentItems![0];
    item.factRefs = [{ type: "experience_fact", experienceId: "jd02-exp", factId: `jd02-f${index+1}` }];
    if (item.data.sectionType === "project") { item.data.highlights = [profile.experiences[0].facts[index].statement]; item.data.description = undefined; }
    const text = projectResumeItemV2(item.data); item.legacyTextProjection = text;
    branch.contentItems = [{ ...branch.contentItems[0], text, originalText: text, factRefs: item.factRefs }];
    branch.structuredContentItems = [item];
    const revision = createResumeRevision({ branch, source: "created_from_profile", operationId: `jd02-${index}` });
    branch.currentRevisionId = revision.id;
    return { branch, revision };
  });
  const jobs = ["熟悉 Python 或 SQL", "熟悉 Java 和 Spring Boot"].map((text, index) => {
    const rawText = `任职要求\n${text}`;
    const graph = analyzeJobDescriptionV4({ rawText }).graph;
    const output = projectJobGraphV4ToAnalyzerOutput({ graph, title: `JD02 岗位 ${index+1}`, company: "合成公司", now: profile.updatedAt });
    return JobDescriptionSchema.parse({ id: `jd02-job-${index+1}`, title: `JD02 岗位 ${index+1}`, company: "合成公司", source: "manual", rawText, requirements: output.requirements.map(requirement => ({ ...requirement, confidence: 1, createdAt: profile.createdAt, updatedAt: profile.updatedAt })), requirementGraph: graph, createdAt: profile.createdAt, updatedAt: profile.updatedAt });
  });
  return { profile, branches, jobs };
}

import { expect, it } from 'vitest';
import { jd02Fixture } from '../fixtures/jd02';
import { buildCareerIntelligence, capabilityGapView } from '@/domain/jobOptimization/careerIntelligence';
import { analyzeJobDescriptionV4, projectJobGraphV4ToAnalyzerOutput } from '@/domain/jobOptimization';
import { JobDescriptionSchema } from '@/domain/schemas';
import { buildGeneralBranchFromProfile } from '@/domain/branch/profileBranch';
import { demoCareerProfile } from '@/data/demoProfile';
import { migrateCareerProfileToV2 } from '@/domain/migrations/resumeV2';

function analyze(rawText: string) {
  const f = jd02Fixture();
  const base = structuredClone(demoCareerProfile);
  base.experiences = [{ ...base.experiences[1], facts: [base.experiences[1].facts[0]], tags: [] }];
  base.skills = []; base.certificates = []; base.evidences = []; base.basics.summary = undefined;
  const fact = base.experiences[0].facts[0];
  fact.statement = '使用 R 完成数据清洗';
  fact.provenance = fact.provenance.map(source => ({ ...source, sourceText: fact.statement }));
  const profile = migrateCareerProfileToV2(base);
  // Rebuild both legacy/V2 projections through the normal branch builder.
  const branch = buildGeneralBranchFromProfile({ profile, operationId: 'rp011-evidence', name: '合成简历', includeProfileFacts: true, includeProfileBasics: true }).branch;
  const graph = analyzeJobDescriptionV4({ rawText }).graph;
  const projection = projectJobGraphV4ToAnalyzerOutput({ graph, title: '当前合成岗位', company: '合成企业', now: profile.updatedAt });
  const job = JobDescriptionSchema.parse({ ...f.jobs[0], id: 'rp011-current-job', rawText, requirementGraph: graph,
    requirements: projection.requirements.map(req => ({ ...req, confidence: 1, createdAt: profile.createdAt, updatedAt: profile.updatedAt })) });
  return buildCareerIntelligence({ profile, branch, job });
}

it('SQL without evidence stays Unknown, never confirmed inability or Covered', () => {
  const result = analyze('任职要求\n必须熟悉 SQL');
  expect(result.candidateEvidenceMatrix.rows).toHaveLength(1);
  expect(result.candidateEvidenceMatrix.rows[0].evidenceStatus).toBe('unknown');
  expect(capabilityGapView(result, result.graph.nodes[0].id).status).toBe('insufficient');
});

it('R satisfies Python OR R while AND still requires both', () => {
  const any = analyze('任职要求\n熟悉 Python 或 R');
  const all = analyze('任职要求\n熟悉 Python 和 R');
  expect(any.matrix.evaluations[0].matchLevel).toBe('direct');
  expect(all.matrix.evaluations[0].matchLevel).not.toBe('direct');
});

it('Preferred SQL is optional while Must SQL remains an evidence gap', () => {
  const preferred = analyze('优先条件\n熟悉 SQL 优先');
  const must = analyze('必备条件\n必须熟悉 SQL');
  expect(preferred.report.blockingGaps).toEqual([]);
  expect(must.candidateEvidenceMatrix.rows[0].evidenceStatus).toBe('unknown');
  expect(must.graph.nodes[0].priority).toBe('must');
});

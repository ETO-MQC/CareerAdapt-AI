"use client";

// Installed ONLY in the harness's isolated source tree; never a product route.
import { useState } from "react";
import { analyzeJobDescriptionV4 } from "@/domain/jobOptimization";
import { CareerProfileSchema, type FactStatement } from "@/domain/schemas";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { careerAdaptDb } from "@/services/storage/db";
import { resolveCareerAgentContext } from "@/agent/runtime/careerContextBindingResolver";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";

export default function H1qRepositoryFixture() {
  const [result, setResult] = useState("waiting");
  const [sessionId, setSessionId] = useState("");
  const [inspection, setInspection] = useState("");
  async function inspect() {
    const repository = new WorkspaceRepository(careerAdaptDb);
    const session = await repository.getAgentSession(sessionId);
    if (!session) throw new Error("fixture_session_missing");
    setInspection(JSON.stringify(await resolveCareerAgentContext(session, repository)));
  }
  async function seed() {
    const repository = new WorkspaceRepository(careerAdaptDb);
    const now = new Date().toISOString();
    const fact = (id: string, statement: string, category: FactStatement["category"]): FactStatement => ({
      id, statement, category, confirmedByUser: true, riskLevel: "low", createdAt: now, updatedAt: now,
      provenance: [{ sourceType: "demo", sourceId: "h1q-synthetic-source", sourceText: statement,
        confidence: 1, confirmedByUser: true, riskLevel: "low", createdAt: now }]
    });
    const { profile } = await repository.createPerson("H1Q合成人物");
    const experiences = [
      { id: "h1q-education", type: "education", organization: "合成大学", role: "计算机本科", degree: "本科", major: "计算机科学",
        statements: ["在合成大学完成计算机科学本科课程。"] },
      { id: "h1q-project", type: "project", organization: "合成数据分析项目", role: "项目成员",
        statements: ["使用 SQL 清洗数据并核对查询结果。", "使用 Python 整理数据并编写自动化测试。"] },
      { id: "h1q-internship", type: "internship", organization: "合成技术团队", role: "开发实习生",
        statements: ["参与产品测试与缺陷记录。"] }
    ].map(({ statements, ...experience }) => ({ ...experience, startDate: "2025-01", endDate: "2025-06",
      facts: statements.map((statement, index) => fact(`${experience.id}-${index}`, statement, "experience")),
      resumeDrafts: [], tags: [], evidenceIds: [], createdAt: now, updatedAt: now }));
    // Build this synthetic input through the official legacy-to-v2 converter;
    // createPerson's empty v2 canonical facts must not mask the seeded facts.
    const saved = await repository.saveProfile(migrateCareerProfileToV2(CareerProfileSchema.parse({ ...profile, schemaVersion: undefined, version: profile.version + 1,
      experiences, skills: ["SQL", "Python"].map(name => ({ id: `h1q-${name}`, name, level: "familiar",
        evidenceIds: [], fact: fact(`h1q-skill-${name}`, `使用 ${name} 处理数据。`, "skill"), createdAt: now, updatedAt: now })) })));
    await repository.setActiveCareerContext({ personId: saved.personId!, profileId: saved.id });
    await repository.createGeneralResumeBranch({ profileId: saved.id, operationId: "h3-general", name: "合成通用简历", includeProfileFacts: true, includeProfileBasics: true });
    const rawText = "公司：华为\n岗位：AI大模型应用开发工程师\n职责：参与模型应用开发与测试。\n要求：必须熟悉 Python 和 SQL。";
    for (const [id, title] of [["h3-job-ai", "AI大模型应用开发工程师"], ["h3-job-dev", "开发工程师2"]]) {
      await repository.saveJobDescription({ id, title, company: "华为", rawText, source: "manual", requirements: [], requirementGraph: analyzeJobDescriptionV4({ rawText }).graph, createdAt: now, updatedAt: now });
    }
    setResult(saved.id);
  }
  return <main><button onClick={() => { void seed().catch(error => setResult(`ERROR: ${String(error)}`)); }}>Seed confirmed Profile</button><output data-testid="seed-result">{result}</output><label>Session ID<input value={sessionId} onChange={event => setSessionId(event.target.value)} /></label><button onClick={() => { void inspect().catch(error => setInspection(`ERROR: ${String(error)}`)); }}>Inspect context</button><output data-testid="context-result">{inspection}</output></main>;
}

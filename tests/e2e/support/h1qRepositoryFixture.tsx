"use client";

// Installed ONLY in the harness's isolated source tree; never a product route.
import { useState } from "react";
import { CareerProfileSchema, type FactStatement } from "@/domain/schemas";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { careerAdaptDb } from "@/services/storage/db";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";

export default function H1qRepositoryFixture() {
  const [result, setResult] = useState("waiting");
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
    setResult(saved.id);
  }
  return <main><button onClick={() => { void seed().catch(error => setResult(`ERROR: ${String(error)}`)); }}>Seed confirmed Profile</button><output data-testid="seed-result">{result}</output></main>;
}

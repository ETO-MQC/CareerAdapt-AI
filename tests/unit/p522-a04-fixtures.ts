import { afterEach } from "vitest";
import { CareerProfileSchema, type CareerProfile } from "@/domain/schemas/profile";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { ProfileQueryService } from "@/services/profile/profileQueryService";

const NOW = "2026-11-06T09:00:00.000Z";
const databases: CareerAdaptDb[] = [];
afterEach(() => { for (const db of databases) db.close(); databases.length = 0; });
export function syntheticProfile(id = "A", count = 65): CareerProfile {
  return CareerProfileSchema.parse({ id, name: `Synthetic ${id}`, schemaVersion: "career-profile-v2",
    personId: `person-${id}`, profileVersionNumber: 1, versionCreatedReason: "initial", isCurrent: true,
    version: 1, createdAt: NOW, updatedAt: NOW, basics: { name: "Synthetic", phone: "PRIVATE_PHONE" }, preference: {},
    structuredBasics: { name: "Synthetic" },
    structuredFacts: Array.from({ length: count }, (_, index) => ({
      data: index % 2 ? { id: `item-${index}`, sectionType: "skills", name: `Skill ${index}`, description: "TypeScript" }
        : { id: `item-${index}`, sectionType: "project", title: `Project ${index}`, highlights: [index === 0 ? "x".repeat(5000) : "Implemented synthetic feature"] },
      factIds: [`fact-${index}`], sourceBlockIds: [`block-${index}`], sourceRanges: [{ blockId: `block-${index}`, start: 0, end: 5 }],
      provenance: [{ kind: index === 2 ? "ai_proposal" : "source_turn", sourceTurnId: `turn-${index}` }]
    })),
    experiences: count ? [{ id: "experience", type: "project", organization: "Synthetic", role: "Developer", createdAt: NOW, updatedAt: NOW,
      evidenceIds: ["evidence-1"], facts: Array.from({ length: count }, (_, index) => ({ id: `fact-${index}`, statement: "Synthetic fact", category: "experience",
        createdAt: NOW, updatedAt: NOW, confirmedByUser: index !== 2, riskLevel: "low",
        provenance: [{ sourceType: "user_input", sourceId: "evidence-1", sourceText: "PRIVATE_SOURCE", confidence: 1,
          confirmedByUser: index !== 2, riskLevel: "low", createdAt: NOW }] })) }] : [],
    evidences: [{ id: "evidence-1", type: "file", title: "Private file", filePath: "C:\\private\\secret.pdf", privacyLevel: "private", createdAt: NOW, updatedAt: NOW }]
  });
}
export async function setupRead() {
  const db = new CareerAdaptDb(`P522-A04-synthetic-${crypto.randomUUID()}`);
  databases.push(db);
  const repository = new WorkspaceRepository(db);
  for (const profile of [syntheticProfile(), syntheticProfile("B", 2), syntheticProfile("empty", 0)]) {
    // Fixture setup only: never opens the default/user database.
    await db.profiles.put(profile);
    await db.appMeta.put({ key: `careerPerson:v1:${profile.personId}`, updatedAt: NOW,
      value: { id: profile.personId, displayName: "Synthetic", currentProfileId: profile.id, createdAt: NOW, updatedAt: NOW } });
  }
  return { db, repository, service: new ProfileQueryService(repository),
    scope: { workspaceId: "synthetic-workspace", personId: "person-A", profileId: "A" } };
}

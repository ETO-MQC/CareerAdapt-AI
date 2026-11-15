"use client";

import { useState } from "react";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { CareerProfileSchema } from "@/domain/schemas";
import { WorkspaceRepository } from "@/services/storage/repositories";

/** Installed only in the isolated browser test source tree. */
export default function PreferenceFixture() {
  const [result, setResult] = useState("waiting");
  async function seed() {
    const repository = new WorkspaceRepository();
    const { profile } = await repository.createPerson("合成候选人");
    const saved = await repository.saveProfile(migrateCareerProfileToV2(CareerProfileSchema.parse({
      ...demoCareerProfile, id: profile.id, personId: profile.personId, profileVersionNumber: 1,
      isCurrent: true, versionCreatedReason: "initial", version: profile.version + 1,
      preference: { targetRoles: ["供应链助理"], targetCities: ["郑州"], industries: [] }
    })));
    await repository.setActiveCareerContext({ personId: saved.personId!, profileId: saved.id });
    const resume = await repository.createGeneralResumeBranch({ profileId: saved.id, operationId: "h4b1c-general",
      name: "合成通用简历", includeProfileFacts: true, includeProfileBasics: true });
    await repository.saveJobDescription(demoJobDescriptions[0]);
    setResult(JSON.stringify({ profileId: saved.id, revision: saved.version,
      profileVersionNumber: saved.profileVersionNumber, resumeId: resume.branch.id, revisionId: resume.revision?.id }));
  }
  return <main><button onClick={() => { void seed().catch(error => setResult(`ERROR: ${String(error)}`)); }}>Seed preference fixture</button>
    <output data-testid="seed-result">{result}</output></main>;
}

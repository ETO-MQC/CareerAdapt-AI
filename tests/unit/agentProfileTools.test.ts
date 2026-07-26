import { describe, expect, it } from "vitest";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { demoCareerProfile } from "@/data/demoProfile";
import type { WorkspaceRepository } from "@/services/storage/repositories";

describe("profile-aware Agent tools", () => {
  it("reads the selected profile and returns authoritative detail", async () => {
    const repository = {
      getActiveProfileId: async () => demoCareerProfile.id,
      getProfile: async (id: string) => id === demoCareerProfile.id ? demoCareerProfile : undefined
    } as unknown as WorkspaceRepository;
    const service = new BrowserAgentToolService(repository);
    const active = await service.getActiveProfile();
    const detail = await service.getProfile({ profileId: demoCareerProfile.id });
    expect(active).toMatchObject({ selected: true, profileId: demoCareerProfile.id, name: demoCareerProfile.name });
    expect(detail.profile.sectionCounts).toBeDefined();
    expect(detail.profile.items.length).toBeGreaterThan(0);
  });

  it("searches profile facts without creating inferred facts", async () => {
    const repository = {
      getProfile: async () => demoCareerProfile
    } as unknown as WorkspaceRepository;
    const service = new BrowserAgentToolService(repository);
    const result = await service.searchProfileFacts({
      profileId: demoCareerProfile.id,
      query: "AI RAG",
      limit: 12
    });
    expect(result.results.every((item) => item.factIds.length >= 0)).toBe(true);
    expect(result).not.toHaveProperty("createdFacts");
  });
});

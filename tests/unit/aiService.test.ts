import { describe, expect, it } from "vitest";
import { AiService } from "@/ai/service";
import { PersistentAiService } from "@/ai/persistentService";
import { MockAiProvider } from "@/ai/providers/mockProvider";
import { DemoCacheProvider } from "@/ai/providers/demoCacheProvider";
import { FallbackAiProvider } from "@/ai/providers/fallbackProvider";
import type { AiProvider } from "@/ai/provider";
import { promptVersions } from "@/ai/prompts/versions";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { AiHealthCheckSchema, CareerProfileSchema, JobDescriptionSchema } from "@/domain/schemas";

class ThrowingProvider implements AiProvider {
  readonly name = "throwing";

  constructor(private readonly message = "provider exploded") {}

  async invoke(): Promise<unknown> {
    throw new Error(this.message);
  }
}

describe("AiService", () => {
  it("returns valid structured output from the mock provider", async () => {
    const service = new AiService(new MockAiProvider());

    const result = await service.invokeStructured({
      task: "health-check",
      input: { email: "student@example.com", phone: "13812345678" },
      outputSchema: AiHealthCheckSchema,
      promptVersion: promptVersions.healthCheck
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.status).toBe("ok");
      expect(result.logs[0].inputSummary).toContain("[redacted-email]");
      expect(result.logs[0].inputSummary).toContain("[redacted-phone]");
    }
  });

  it("retries once when schema validation fails and accepts the repaired output", async () => {
    const provider = new MockAiProvider({
      outputs: {
        "health-check": {
          status: "not-ok"
        }
      },
      repairOutputs: {
        "health-check": {
          status: "ok",
          provider: "mock",
          checkedAt: "2026-07-01T10:00:00.000Z"
        }
      }
    });
    const service = new AiService(provider);

    const result = await service.invokeStructured({
      task: "health-check",
      input: { task: "retry validation" },
      outputSchema: AiHealthCheckSchema,
      promptVersion: promptVersions.healthCheck
    });

    expect(result.ok).toBe(true);
    expect(result.logs.map((log) => log.status)).toEqual(["validation_failed", "success"]);
  });

  it("returns a fallback error after two invalid outputs", async () => {
    const provider = new MockAiProvider({
      outputs: {
        "health-check": {
          status: "bad"
        }
      },
      repairOutputs: {
        "health-check": {
          status: "still-bad"
        }
      }
    });
    const service = new AiService(provider);

    const result = await service.invokeStructured({
      task: "health-check",
      input: { task: "fail validation" },
      outputSchema: AiHealthCheckSchema,
      promptVersion: promptVersions.healthCheck
    });

    expect(result.ok).toBe(false);
    expect(result.logs.map((log) => log.status)).toEqual(["validation_failed", "validation_failed"]);
  });

  it("records provider_failed when the provider throws before returning output", async () => {
    const service = new AiService(new ThrowingProvider());

    const result = await service.invokeStructured({
      task: "health-check",
      input: { task: "provider failure" },
      outputSchema: AiHealthCheckSchema,
      promptVersion: promptVersions.healthCheck
    });

    expect(result.ok).toBe(false);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].status).toBe("provider_failed");
    expect(result.logs[0].provider).toBe("throwing");
  });

  it("validates profile-builder structured output with CareerProfile schema", async () => {
    const service = new AiService(new MockAiProvider());

    const result = await service.invokeStructured({
      task: "profile-builder",
      input: { resumeText: "阶段A结构化输出探针" },
      outputSchema: CareerProfileSchema,
      promptVersion: promptVersions.profileBuilder
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(demoCareerProfile.id);
      expect(result.data.experiences.length).toBeGreaterThan(0);
    }
  });

  it("validates jd-analyzer structured output with JobDescription schema", async () => {
    const service = new AiService(new MockAiProvider());

    const result = await service.invokeStructured({
      task: "jd-analyzer",
      input: { jdText: "阶段A JD结构化输出探针" },
      outputSchema: JobDescriptionSchema,
      promptVersion: promptVersions.jdAnalyzer
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(demoJobDescriptions[0].id);
      expect(result.data.requirements.length).toBeGreaterThan(0);
    }
  });

  it("persists AI logs through PersistentAiService and exports them in workspace JSON", async () => {
    const db = new CareerAdaptDb(`CareerAdaptAiLogTestDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const service = new PersistentAiService(new AiService(new MockAiProvider()), repository);

    try {
      const result = await service.invokeStructured({
        task: "health-check",
        input: { task: "persist logs" },
        outputSchema: AiHealthCheckSchema,
        promptVersion: promptVersions.healthCheck
      });

      expect(result.ok).toBe(true);

      const exported = await repository.exportWorkspaceJson();
      expect(exported.aiLogs).toHaveLength(1);
      expect(exported.aiLogs[0].status).toBe("success");
      expect(exported.aiLogs[0].task).toBe("health-check");
    } finally {
      db.close();
      await db.delete();
    }
  });
});

describe("DemoCacheProvider", () => {
  it("returns cached output on cache hit", async () => {
    const provider = new DemoCacheProvider({
      "health-check:health-check.v1": {
        status: "ok",
        provider: "cached",
        checkedAt: "2026-07-01T10:00:00.000Z"
      }
    });

    const output = await provider.invoke({
      task: "health-check",
      input: {},
      outputSchema: AiHealthCheckSchema,
      promptVersion: promptVersions.healthCheck
    });

    expect(output).toMatchObject({ provider: "cached" });
  });

  it("uses the fallback provider on cache miss", async () => {
    const provider = new DemoCacheProvider({}, new MockAiProvider());

    const output = await provider.invoke({
      task: "health-check",
      input: {},
      outputSchema: AiHealthCheckSchema,
      promptVersion: promptVersions.healthCheck
    });

    expect(output).toMatchObject({ provider: "mock" });
  });

  it("bypasses cache during repair and uses the fallback provider", async () => {
    const provider = new DemoCacheProvider(
      {
        "health-check:health-check.v1": {
          status: "ok",
          provider: "cached",
          checkedAt: "2026-07-01T10:00:00.000Z"
        }
      },
      new MockAiProvider()
    );

    const output = await provider.invoke({
      task: "health-check",
      input: {},
      outputSchema: AiHealthCheckSchema,
      promptVersion: promptVersions.healthCheck,
      repair: {
        previousOutput: { status: "bad" },
        validationError: "bad status"
      }
    });

    expect(output).toMatchObject({ provider: "mock" });
  });

  it("surfaces the underlying fallback failure", async () => {
    const provider = new DemoCacheProvider({}, new ThrowingProvider("fallback failed"));

    await expect(
      provider.invoke({
        task: "health-check",
        input: {},
        outputSchema: AiHealthCheckSchema,
        promptVersion: promptVersions.healthCheck
      })
    ).rejects.toThrow("fallback failed");
  });
});

describe("FallbackAiProvider", () => {
  it("uses DemoCacheProvider when the primary provider fails", async () => {
    const provider = new FallbackAiProvider(
      new ThrowingProvider("primary failed"),
      new DemoCacheProvider({
        "health-check:health-check.v1": {
          status: "ok",
          provider: "demo-cache",
          checkedAt: "2026-07-01T10:00:00.000Z"
        }
      })
    );
    const service = new AiService(provider);

    const result = await service.invokeStructured({
      task: "health-check",
      input: { task: "fallback" },
      outputSchema: AiHealthCheckSchema,
      promptVersion: promptVersions.healthCheck
    });

    expect(result.ok).toBe(true);
    expect(result.logs[0].provider).toBe("throwing->demo-cache");
  });

  it("returns a clear failure when primary provider fails and cache is unavailable", async () => {
    const provider = new FallbackAiProvider(new ThrowingProvider("primary failed"), new DemoCacheProvider());
    const service = new AiService(provider);

    const result = await service.invokeStructured({
      task: "health-check",
      input: { task: "fallback unavailable" },
      outputSchema: AiHealthCheckSchema,
      promptVersion: promptVersions.healthCheck
    });

    expect(result.ok).toBe(false);
    expect(result.logs[0].status).toBe("provider_failed");
    expect(result.logs[0].error).toContain("demo cache fallback is unavailable");
  });
});

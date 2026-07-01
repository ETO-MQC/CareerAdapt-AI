import { describe, expect, it } from "vitest";
import { AiService } from "@/ai/service";
import { MockAiProvider } from "@/ai/providers/mockProvider";
import { promptVersions } from "@/ai/prompts/versions";
import { AiHealthCheckSchema } from "@/domain/schemas";

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
});

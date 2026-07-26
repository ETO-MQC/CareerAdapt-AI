import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentToolRegistry } from "@/agent/tools/registry";
import type { ExternalToolProvider } from "@/agent/tools/externalToolProvider";

describe("external tool abstraction", () => {
  it("merges and executes a mock external provider without changing the registry contract", async () => {
    const execute = vi.fn(async () => ({ operationId: "external-operation-1", value: "ok" }));
    const provider: ExternalToolProvider = {
      listTools: async () => [{
        name: "external_read",
        description: "Read a mock external resource.",
        risk: "read",
        requiresConfirmation: false,
        idempotent: true,
        resumable: true,
        category: "external",
        dataScope: "mock",
        producesArtifact: false,
        external: true,
        inputSchema: z.object({}).strict(),
        outputSchema: z.object({ operationId: z.string(), value: z.string() }),
        execute: async () => ({ operationId: "unused", value: "unused" })
      }],
      execute
    };
    const merged = await new AgentToolRegistry([]).mergeExternal(provider);
    expect(merged.manifest()[0]).toMatchObject({ name: "external_read", external: true });
    expect((await merged.execute("external_read", {}, "external-operation-1")).ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

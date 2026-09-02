import { createRequire } from "node:module";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  classifyStartupStage,
  sanitizedLaunchSummary,
  allocateLocalRuntimeUrl
} = require("../../electron/hermesCompanion.js") as {
  classifyStartupStage: (message: string, output: { stdout: string[]; stderr: string[] }) => string;
  sanitizedLaunchSummary: (
    launch: { kind: string; command: string; args: string[]; cwd: string },
    environment: Record<string, string>,
    runtime: { baseUrl: string }
  ) => Record<string, unknown>;
  allocateLocalRuntimeUrl: (
    environment: Record<string, string>,
    options?: { maxAttempts?: number }
  ) => Promise<{ runtime: { port: number }; error?: string }>;
};

const servers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("Hermes companion startup diagnostics", () => {
  it("classifies exact startup stages from captured process evidence", () => {
    expect(classifyStartupStage("Hermes exited", {
      stdout: [],
      stderr: ["ModuleNotFoundError: No module named 'hermes_cli'"]
    })).toBe("module_import");
    expect(classifyStartupStage("Hermes exited", {
      stdout: [],
      stderr: ["Another gateway instance is already running; use --replace"]
    })).toBe("gateway_process_ownership");
    expect(classifyStartupStage("health check timed out", { stdout: [], stderr: [] }))
      .toBe("api_server_startup");
  });

  it("records launch presence without exposing provider credentials", () => {
    const summary = sanitizedLaunchSummary({
      kind: "bundled",
      command: "C:/runtime/python/python.exe",
      args: ["-m", "hermes_cli.main", "gateway", "run", "--replace", "--force"],
      cwd: "C:/runtime/python"
    }, {
      HERMES_RUNTIME_ROOT: "C:/runtime",
      HERMES_HOME: "C:/data/hermes",
      PYTHONHOME: "C:/runtime/python",
      PYTHONPATH: "C:/runtime/source",
      PATH: "C:/runtime/bin",
      OPENAI_BASE_URL: "https://provider.example/v1",
      HERMES_CUSTOM_CAREERADAPT_API_KEY: "never-log-this-secret",
      HERMES_INFERENCE_MODEL: "model-a"
    }, { baseUrl: "http://127.0.0.1:8642" });

    expect(summary).toMatchObject({
      launchKind: "bundled",
      pathEntryCount: 1,
      runtimePathEntries: ["C:/runtime/bin"],
      providerPresent: true,
      providerKeyPresent: true,
      modelPresent: true
    });
    expect(JSON.stringify(summary)).not.toContain("never-log-this-secret");
  });

  it("keeps a free default port and reallocates around an unrelated listener without terminating it", async () => {
    const free = await allocateLocalRuntimeUrl({ HERMES_RUNTIME_URL: "http://127.0.0.1:18642" }, { maxAttempts: 10 });
    expect(free.runtime.port).toBe(18642);

    const unrelated = net.createServer();
    servers.push(unrelated);
    await new Promise<void>((resolve, reject) => {
      unrelated.once("error", reject);
      unrelated.listen(0, "127.0.0.1", () => resolve());
    });
    const address = unrelated.address();
    if (!address || typeof address === "string") throw new Error("listener_port_unavailable");
    const allocated = await allocateLocalRuntimeUrl({ HERMES_RUNTIME_URL: `http://127.0.0.1:${address.port}` }, { maxAttempts: 10 });
    expect(allocated.runtime.port).not.toBe(address.port);
    expect(unrelated.listening).toBe(true);
  });
});

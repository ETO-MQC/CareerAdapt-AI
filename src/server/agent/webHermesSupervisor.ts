import path from "node:path";
import type {
  HermesConfigSchema,
  HermesConfigSnapshot,
  HermesControlOwner,
  HermesLogs,
  HermesStartSettings,
  HermesSupervisorSnapshot
} from "@/services/agent/hermesControl";

type WebHermesSupervisor = {
  rendererHostReady(settings?: HermesStartSettings): Promise<HermesSupervisorSnapshot>;
  ensureStarted(settings?: HermesStartSettings): Promise<HermesSupervisorSnapshot>;
  stop(): Promise<HermesSupervisorSnapshot>;
  restart(options?: { auto?: boolean; reason?: string }): Promise<HermesSupervisorSnapshot>;
  recover(): Promise<HermesSupervisorSnapshot>;
  getStatus(): HermesSupervisorSnapshot;
  getLogs(): Promise<HermesLogs>;
  getConfig(): Promise<HermesConfigSnapshot>;
  getConfigSchema(): Promise<HermesConfigSchema>;
  updateConfig(settings: HermesStartSettings): Promise<HermesSupervisorSnapshot>;
  reloadConfigFromEnvironment(): Promise<HermesSupervisorSnapshot>;
  resetConfig(): Promise<HermesSupervisorSnapshot>;
  shutdown(): Promise<HermesSupervisorSnapshot>;
};

type HermesSupervisorModule = {
  HermesSupervisor: new (options: Record<string, unknown>) => WebHermesSupervisor;
};

type HermesCompanionModule = {
  applyEnvironment(environment: Record<string, string>): void;
  createEphemeralRuntimeApiKey(): string;
  loadCareerAdaptEnvironment(projectRoot: string): Record<string, string>;
};

type WebHermesSupervisorGlobalState = {
  supervisor?: WebHermesSupervisor;
  supervisorOrigin?: string;
  shutdownHooksInstalled: boolean;
};

// Next development can reload this module while the Node process and the
// supervised Hermes child remain alive. Keep the process owner at the same
// application-global boundary used by the MCP bridge registry.
const supervisorGlobal = globalThis as typeof globalThis & {
  __careeradaptWebHermesSupervisor?: WebHermesSupervisorGlobalState;
};
const state = supervisorGlobal.__careeradaptWebHermesSupervisor ??= {
  shutdownHooksInstalled: false
};

export function webHermesControlEnabled() {
  return process.env.NODE_ENV !== "production"
    && process.env.HERMES_WEB_CONTROL_ENABLED?.trim().toLowerCase() === "true";
}

export function webHermesControlOwner(): HermesControlOwner {
  return "web_supervisor";
}

export function getWebHermesSupervisor(appOrigin: string): WebHermesSupervisor {
  if (!webHermesControlEnabled()) throw new Error("web_hermes_control_disabled");
  if (state.supervisorOrigin && state.supervisorOrigin !== appOrigin) throw new Error("web_hermes_origin_mismatch");
  if (state.supervisor) return state.supervisor;

  const projectRoot = process.env.CAREERADAPT_PROJECT_ROOT?.trim() || process.cwd();
  const companion = loadHermesCompanionModule();
  const hermesSupervisor = loadHermesSupervisorModule();
  const loadedEnvironment = companion.loadCareerAdaptEnvironment(projectRoot);
  const environment: Record<string, string> = {
    ...loadedEnvironment,
    CAREERADAPT_BASE_URL: appOrigin,
    HERMES_RUNTIME_URL: loadedEnvironment.HERMES_RUNTIME_URL?.trim() || "http://127.0.0.1:8642",
    HERMES_RUNTIME_ROOT: loadedEnvironment.HERMES_RUNTIME_ROOT?.trim()
      || ".electron-build/hermes-runtime-v4"
  };
  if (!hasRuntimeApiKey(environment)) environment.HERMES_RUNTIME_API_KEY = companion.createEphemeralRuntimeApiKey();
  companion.applyEnvironment(environment);

  state.supervisor = new hermesSupervisor.HermesSupervisor({
    projectRoot,
    appBaseUrl: appOrigin,
    environment,
    hermesHome: environment.HERMES_HOME || ".next/dev/hermes",
    hermesRuntimeRoot: environment.HERMES_RUNTIME_ROOT,
    runtimeCwd: projectRoot,
    logPath: ".next/dev/logs/hermes-runtime.log",
    requireBundledRuntime: false,
    watchMcpBridge: false
  });
  state.supervisorOrigin = appOrigin;
  installShutdownHooks();
  return state.supervisor;
}

export function currentWebHermesSupervisor() {
  return state.supervisor;
}

export function webHermesSupervisorSnapshot(): HermesSupervisorSnapshot | undefined {
  return state.supervisor?.getStatus();
}

export async function shutdownWebHermesSupervisor() {
  if (!state.supervisor) return;
  await state.supervisor.shutdown();
  state.supervisor = undefined;
  state.supervisorOrigin = undefined;
}

function installShutdownHooks() {
  if (state.shutdownHooksInstalled) return;
  state.shutdownHooksInstalled = true;
  const shutdown = () => {
    void shutdownWebHermesSupervisor().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function loadHermesSupervisorModule() {
  return loadCommonJsModule("hermesSupervisor.js") as HermesSupervisorModule;
}

function loadHermesCompanionModule() {
  return loadCommonJsModule("hermesCompanion.js") as HermesCompanionModule;
}

function loadCommonJsModule(fileName: string) {
  const modulePath = path.join(process.cwd(), "electron", fileName);
  // Keep this development-only bridge outside the bundler's static module
  // graph. `node:module` is replaced by an empty webpack context in dev
  // bundles, so obtain the native loader from Node at runtime instead.
  const builtinModule = typeof process.getBuiltinModule === "function"
    ? process.getBuiltinModule("node:module") as { createRequire(filename: string): NodeRequire }
    : undefined;
  const runtimeRequire = builtinModule?.createRequire(path.join(process.cwd(), "package.json"))
    ?? Function("return require")() as NodeRequire;
  return runtimeRequire(modulePath);
}

function hasRuntimeApiKey(environment: Record<string, string>) {
  return Boolean(
    environment.HERMES_RUNTIME_API_KEY?.trim()
    || environment.HERMES_API_KEY?.trim()
    || environment.API_SERVER_KEY?.trim()
  );
}

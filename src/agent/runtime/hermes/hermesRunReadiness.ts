import type { HermesRunFailureDiagnostics } from "./hermesRunReliability";

export type HermesRunReadinessSnapshot = {
  ready: boolean;
  checkedAt: string;
  safeErrorCode?: string;
};

const CACHE_TTL_MS = 15_000;
const readinessByRuntime = new Map<string, HermesRunReadinessSnapshot>();

export function recordHermesRunStartSuccess(runtimeUrl?: string) {
  if (!runtimeUrl) return;
  readinessByRuntime.set(normalize(runtimeUrl), {
    ready: true,
    checkedAt: new Date().toISOString()
  });
}

export function recordHermesRunStartFailure(
  runtimeUrl: string | undefined,
  diagnostics?: Partial<HermesRunFailureDiagnostics> & { safeErrorCode?: string }
) {
  if (!runtimeUrl) return;
  readinessByRuntime.set(normalize(runtimeUrl), {
    ready: false,
    checkedAt: new Date().toISOString(),
    ...(diagnostics?.safeErrorCode ? { safeErrorCode: diagnostics.safeErrorCode } : {})
  });
}

export function readHermesRunReadiness(runtimeUrl?: string): HermesRunReadinessSnapshot | undefined {
  if (!runtimeUrl) return undefined;
  const value = readinessByRuntime.get(normalize(runtimeUrl));
  if (!value) return undefined;
  if (Date.now() - Date.parse(value.checkedAt) > CACHE_TTL_MS) {
    readinessByRuntime.delete(normalize(runtimeUrl));
    return undefined;
  }
  return value;
}

export function clearHermesRunReadiness(runtimeUrl?: string) {
  if (runtimeUrl) readinessByRuntime.delete(normalize(runtimeUrl));
  else readinessByRuntime.clear();
}

function normalize(value: string) {
  return value.replace(/\/$/u, "");
}

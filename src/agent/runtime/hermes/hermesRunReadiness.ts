import {
  classifyHermesRunFailure,
  type HermesRunFailureDiagnostics,
  type HermesRunFailureInput
} from "./hermesRunReliability";

export type HermesRunReadinessSnapshot = {
  ready: boolean;
  checkedAt: string;
  safeErrorCode?: string;
  runtimeFailureDiagnostics?: HermesRunFailureDiagnostics;
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
  diagnostics?: Partial<HermesRunFailureInput> & { safeErrorCode?: string; safeErrorMessage?: string }
) {
  if (!runtimeUrl) return;
  const failure = classifyHermesRunFailure({
    ...diagnostics,
    code: diagnostics?.code ?? diagnostics?.safeErrorCode,
    message: diagnostics?.message ?? diagnostics?.safeErrorMessage
  });
  readinessByRuntime.set(normalize(runtimeUrl), {
    ready: false,
    checkedAt: new Date().toISOString(),
    safeErrorCode: failure.safeErrorCode,
    runtimeFailureDiagnostics: failure
  });
}

export function readHermesRunReadiness(runtimeUrl?: string): HermesRunReadinessSnapshot | undefined {
  if (!runtimeUrl) return undefined;
  const value = readinessByRuntime.get(normalize(runtimeUrl));
  if (!value) return undefined;
  // A real run-start failure remains authoritative over a stale upstream
  // `runReady=true` report.  It is cleared only by a later real run_start
  // success (or an explicit process-level clear), not by wall-clock expiry.
  if (!value.ready) return value;
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

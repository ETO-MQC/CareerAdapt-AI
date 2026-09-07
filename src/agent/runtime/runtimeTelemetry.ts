export type RuntimeTurnTelemetry = {
  runtimeId: string;
  turnId: string;
  model?: string;
  latencyMs: number;
  toolCalls: number;
  toolFailures: number;
  autonomousRecoveries: number;
  fallbackUsed: boolean;
  artifactUpdates: number;
  completionStatus: "completed" | "failed" | "paused" | "interrupted";
  /** Counts and durations observed at the Hermes Runs boundary. */
  providerRequestCount?: number;
  providerRequestDurationMs?: number;
  skillViewCount?: number;
  careerFacadeCount?: number;
  readToolCount?: number;
  failedToolCount?: number;
  phaseLatencyMs?: {
    runStartToFirstProviderRequestMs?: number;
    providerRequestDurationMs?: number;
    skillLoadRequestMs?: number;
    toolSelectionDelayMs?: number;
    mcpRequestToDomainResultMs?: number;
    postToolProviderRequestMs?: number;
    firstVisibleAssistantTokenMs?: number;
    terminalCompletionMs?: number;
  };
  /** Hermes does not expose its internal provider-call count over /v1/runs. */
  providerRequestScope?: "hermes_run_start_proxy" | "unobservable";
};

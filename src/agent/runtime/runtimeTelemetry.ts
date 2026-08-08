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
};

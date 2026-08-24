import { TurnController } from "./TurnController";
export type { SessionExecution, SessionExecutionStatus } from "./TurnController";

/**
 * Boundary for a future Tauri/Rust runner. The browser implementation keeps
 * the same session-scoped contract while its fetches remain browser-bound.
 */
export type AgentExecutionAdapter = {
  run?(input: { sessionId: string; turnId?: string; signal: AbortSignal }): Promise<unknown>;
  recover?(input: { sessionId: string; checkpoint?: unknown }): Promise<unknown>;
};

/**
 * Compatibility export for tests and older adapters. The implementation is
 * the same single TurnController; there is no second runtime owner.
 */
export class AgentExecutionCoordinator extends TurnController {}

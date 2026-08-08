import { z } from "zod";
import type { AgentRuntime } from "./agentRuntime";

export const AgentRuntimeIdSchema = z.enum(["native", "hermes"]);
export type AgentRuntimeId = z.infer<typeof AgentRuntimeIdSchema>;

export const AgentRuntimeConfigurationSchema = z.object({
  agentRuntime: AgentRuntimeIdSchema.default("native")
}).strict();
export type AgentRuntimeConfiguration = z.infer<typeof AgentRuntimeConfigurationSchema>;

/** Selects a runtime by configuration without coupling the app to Hermes. */
export class AgentRuntimeRouter {
  private configuration: AgentRuntimeConfiguration;
  private readonly runtimes = new Map<AgentRuntimeId, AgentRuntime>();

  constructor(input: {
    native: AgentRuntime;
    hermes?: AgentRuntime;
    configuration?: Partial<AgentRuntimeConfiguration>;
  }) {
    this.runtimes.set("native", input.native);
    if (input.hermes) this.runtimes.set("hermes", input.hermes);
    this.configuration = AgentRuntimeConfigurationSchema.parse(input.configuration ?? {});
  }

  get configurationSnapshot() {
    return this.configuration;
  }

  configure(configuration: AgentRuntimeConfiguration) {
    this.configuration = AgentRuntimeConfigurationSchema.parse(configuration);
    return this.configuration;
  }

  register(id: AgentRuntimeId, runtime: AgentRuntime) {
    this.runtimes.set(id, runtime);
  }

  resolve(id = this.configuration.agentRuntime) {
    const runtime = this.runtimes.get(id);
    if (!runtime) {
      throw Object.assign(new Error(`Agent runtime is unavailable: ${id}`), {
        code: "agent_runtime_unavailable",
        runtimeId: id
      });
    }
    return runtime;
  }

  active() {
    return this.resolve();
  }
}

export function createAgentRuntimeRouter(input: ConstructorParameters<typeof AgentRuntimeRouter>[0]) {
  return new AgentRuntimeRouter(input);
}

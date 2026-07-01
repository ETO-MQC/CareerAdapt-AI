import type { AiTask } from "@/domain/schemas";
import { demoJobDescriptions } from "@/data/demoJobs";
import { demoCareerProfile } from "@/data/demoProfile";
import type { AiInvokeRequest, AiProvider } from "../provider";

type MockProviderOptions = {
  outputs?: Partial<Record<AiTask, unknown>>;
  repairOutputs?: Partial<Record<AiTask, unknown>>;
};

export class MockAiProvider implements AiProvider {
  readonly name = "mock";

  constructor(private readonly options: MockProviderOptions = {}) {}

  async invoke<TOutput>(request: AiInvokeRequest<TOutput>): Promise<unknown> {
    if (request.repair && this.options.repairOutputs?.[request.task] !== undefined) {
      return this.options.repairOutputs[request.task];
    }

    if (this.options.outputs?.[request.task] !== undefined) {
      return this.options.outputs[request.task];
    }

    return this.defaultOutput(request.task);
  }

  private defaultOutput(task: AiTask): unknown {
    const checkedAt = new Date().toISOString();

    if (task === "health-check") {
      return {
        status: "ok",
        provider: this.name,
        checkedAt
      };
    }

    if (task === "profile-builder") {
      return demoCareerProfile;
    }

    if (task === "jd-analyzer") {
      return demoJobDescriptions[0];
    }

    return {
      status: "ok",
      provider: this.name,
      checkedAt
    };
  }
}

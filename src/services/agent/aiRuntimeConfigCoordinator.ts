import {
  clearAiSettings,
  readAiSettings,
  writeAiSettings,
  type AiSettings
} from "@/services/storage/aiSettings";
import {
  requestHermesConfigReset,
  requestHermesConfigUpdate,
  requestHermesEnvironmentReload,
  requestHermesProviderTest,
  type CandidateProviderTestResult,
  type HermesControlResult
} from "@/services/agent/hermesControl";
import {
  normalizeAiRuntimeConfigDraft,
  validateAiRuntimeConfigDraft,
  type AiRuntimeConfigActive,
  type AiRuntimeConfigApplyStatus,
  type AiRuntimeConfigDraft,
  type AiRuntimeConfigState
} from "./aiRuntimeConfiguration";

export type AiRuntimeConfigCoordinatorOptions = {
  readActive?: () => AiRuntimeConfigActive | undefined;
  refreshActive?: () => Promise<void>;
  recordCandidateTest?: (result: CandidateProviderTestResult) => void;
  recordControlResult?: (result: HermesControlResult | undefined) => void;
};

export type AiRuntimeConfigApplyOptions = {
  beforeApply?: () => Promise<void>;
};

/**
 * The renderer-facing configuration boundary. Supervisor remains the only
 * process owner; this class only sequences draft persistence and control-plane
 * requests so Settings cannot accidentally create a second runtime state
 * machine.
 */
export class AiRuntimeConfigCoordinator {
  private readonly options: AiRuntimeConfigCoordinatorOptions;
  private state: AiRuntimeConfigState = { applyStatus: "idle", rollbackOccurred: false };
  private inFlight?: Promise<HermesControlResult>;

  constructor(options: AiRuntimeConfigCoordinatorOptions = {}) {
    this.options = options;
  }

  readDraft(): AiRuntimeConfigDraft {
    return readAiSettings();
  }

  readDesired(): AiRuntimeConfigDraft {
    return readAiSettings();
  }

  readActive(): AiRuntimeConfigActive | undefined {
    return this.options.readActive?.();
  }

  readApplyState(): AiRuntimeConfigState {
    return { ...this.state, ...(this.state.active ? { active: { ...this.state.active } } : {}), ...(this.state.desired ? { desired: { ...this.state.desired } } : {}) };
  }

  async testCandidate(settings: AiRuntimeConfigDraft): Promise<CandidateProviderTestResult> {
    const result = await requestHermesProviderTest(normalizeAiRuntimeConfigDraft(settings));
    this.options.recordCandidateTest?.(result);
    return result;
  }

  async applyDesired(settings: AiRuntimeConfigDraft, options: AiRuntimeConfigApplyOptions = {}): Promise<HermesControlResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.applyDesiredInternal(settings, options);
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  async reloadEnvironment(options: AiRuntimeConfigApplyOptions = {}): Promise<HermesControlResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.reloadEnvironmentInternal(options);
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  async resetToEnvironment(options: AiRuntimeConfigApplyOptions = {}): Promise<HermesControlResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.resetToEnvironmentInternal(options);
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  private async applyDesiredInternal(settings: AiRuntimeConfigDraft, options: AiRuntimeConfigApplyOptions) {
    const draft = normalizeAiRuntimeConfigDraft(settings);
    this.setApplyStatus("validating");
    const validationError = validateAiRuntimeConfigDraft(draft);
    if (validationError) {
      this.setApplyStatus("failed", validationError);
      return { ok: false, reason: validationError } satisfies HermesControlResult;
    }

    try {
      await options.beforeApply?.();
      writeAiSettings(draft);
      this.setApplyStatus("saving");
      this.setApplyStatus("restarting_runtime");
      const result = await requestHermesConfigUpdate(draft);
      this.options.recordControlResult?.(result);
      return this.finishControlResult(result);
    } catch (error) {
      this.setApplyStatus("failed", safeCoordinatorReason(error));
      throw error;
    }
  }

  private async reloadEnvironmentInternal(options: AiRuntimeConfigApplyOptions) {
    try {
      await options.beforeApply?.();
      clearAiSettings();
      this.setApplyStatus("saving");
      this.setApplyStatus("restarting_runtime");
      const result = await requestHermesEnvironmentReload();
      this.options.recordControlResult?.(result);
      return this.finishControlResult(result);
    } catch (error) {
      this.setApplyStatus("failed", safeCoordinatorReason(error));
      throw error;
    }
  }

  private async resetToEnvironmentInternal(options: AiRuntimeConfigApplyOptions) {
    try {
      await options.beforeApply?.();
      clearAiSettings();
      this.setApplyStatus("saving");
      this.setApplyStatus("restarting_runtime");
      const result = await requestHermesConfigReset();
      this.options.recordControlResult?.(result);
      return this.finishControlResult(result);
    } catch (error) {
      this.setApplyStatus("failed", safeCoordinatorReason(error));
      throw error;
    }
  }

  private async finishControlResult(result: HermesControlResult) {
    const supervisorConfig = result.snapshot?.runtimeConfig ?? result.controlSnapshot?.runtimeConfig;
    if (supervisorConfig) this.state = { ...supervisorConfig, updatedAt: new Date().toISOString() };
    if (result.receipt?.applyStatus === "deferred") this.setApplyStatus("deferred", result.receipt.reasonCode ?? result.reason);
    else if (result.receipt?.applyStatus === "rolled_back") this.setApplyStatus("rolled_back", result.receipt.reasonCode ?? result.reason);
    else if (result.receipt?.applyStatus === "failed" || (!result.ok && result.receipt?.action === "update_config")) this.setApplyStatus("failed", result.receipt?.reasonCode ?? result.reason);
    else if (result.receipt?.applyStatus === "applied" || result.snapshot?.runtimeConfig?.applyStatus === "applied") this.setApplyStatus("applied", result.receipt?.reasonCode ?? result.reason);
    else if (result.ok) {
      await this.options.refreshActive?.();
      this.setApplyStatus("applied", result.reason);
    } else {
      this.setApplyStatus("failed", result.reason);
    }
    return result;
  }

  private setApplyStatus(status: AiRuntimeConfigApplyStatus, reasonCode?: string) {
    this.state = {
      ...this.state,
      applyStatus: status,
      ...(reasonCode ? { reasonCode } : {}),
      updatedAt: new Date().toISOString()
    };
  }
}

function safeCoordinatorReason(error: unknown) {
  const reason = error instanceof Error ? error.message : "ai_runtime_configuration_failed";
  return reason.replace(/[^A-Za-z0-9_.:-]/gu, "_").slice(0, 160) || "ai_runtime_configuration_failed";
}

export type { AiRuntimeConfigActive, AiRuntimeConfigApplyStatus, AiRuntimeConfigDraft, AiRuntimeConfigState, AiSettings };

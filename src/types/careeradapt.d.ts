export {};

import type {
  HermesConfigSchema,
  HermesConfigSnapshot,
  HermesControlResult,
  HermesLogs,
  HermesSupervisorSnapshot,
  HermesStartSettings,
  ProviderCredentialStatus,
ProviderCredentialWrite,
  ProviderCredentialWriteResult
} from "@/services/agent/hermesControl";

declare global {
  interface Window {
    careerAdaptDesktop?: {
      getHermesStatus(): Promise<HermesSupervisorSnapshot | undefined>;
      notifyHermesRendererReady(settings?: HermesStartSettings): Promise<HermesControlResult>;
      startHermes(settings?: HermesStartSettings): Promise<HermesControlResult>;
      stopHermes(): Promise<HermesControlResult>;
      restartHermes(options?: { auto?: boolean; reason?: string }): Promise<HermesControlResult>;
      recoverHermes(): Promise<HermesControlResult>;
      getHermesLogs(): Promise<HermesLogs>;
      openHermesLogs(): Promise<HermesControlResult>;
      getHermesConfig(): Promise<HermesConfigSnapshot | undefined>;
      getHermesConfigSchema(): Promise<HermesConfigSchema | undefined>;
      updateHermesConfig(settings: HermesStartSettings): Promise<HermesControlResult>;
      reloadHermesConfig(): Promise<HermesControlResult>;
      resetHermesConfig(): Promise<HermesControlResult>;
      /**
       * Secure credential channel (V4-P0 S-0). There is intentionally no getter that returns the
       * stored key: `describeProviderCredential` reports availability/presence only, and the two
       * mutating calls resolve to the same status shape.
       */
      describeProviderCredential(): Promise<ProviderCredentialStatus>;
      setProviderCredential(credential: ProviderCredentialWrite): Promise<ProviderCredentialWriteResult>;
      clearProviderCredential(): Promise<ProviderCredentialStatus>;
      subscribeHermesStatus(listener: (snapshot: HermesSupervisorSnapshot) => void): () => void;
    };
  }
}

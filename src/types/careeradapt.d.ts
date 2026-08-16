export {};

import type {
  HermesConfigSchema,
  HermesConfigSnapshot,
  HermesControlResult,
  HermesLogs,
  HermesSupervisorSnapshot,
  HermesStartSettings
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
      resetHermesConfig(): Promise<HermesControlResult>;
      subscribeHermesStatus(listener: (snapshot: HermesSupervisorSnapshot) => void): () => void;
    };
  }
}

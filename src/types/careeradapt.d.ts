export {};

declare global {
  interface Window {
    careerAdaptDesktop?: {
      startHermes(settings?: {
        baseUrl: string;
        apiKey: string;
        model: string;
        provider: string;
      }): Promise<{ ok: boolean; reason?: string; runtimeUrl?: string }>;
    };
  }
}

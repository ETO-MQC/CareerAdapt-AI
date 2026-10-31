export function isAmdQwenRoute(settings: { baseUrl: string; model: string }): boolean;
export function resolveQualityGenerationPolicy(settings: { baseUrl: string; model: string; qualityMaxTokens?: number }): {
  temperature: number; reasoningEffort?: "low"; maxTokens?: number;
};

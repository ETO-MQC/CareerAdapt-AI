/** The Radeon gateway has different reasoning controls from self-hosted Qwen. */
function isAmdQwenRoute({ baseUrl, model }) {
  if (model !== "Qwen3.8-27B") return false;
  try { return new URL(baseUrl).hostname.toLowerCase() === "developer.amd.com.cn"; }
  catch { return false; }
}

function resolveQualityGenerationPolicy(settings) {
  if (settings.qualityMaxTokens !== undefined && (!Number.isSafeInteger(settings.qualityMaxTokens) || settings.qualityMaxTokens <= 0)) {
    throw new Error("quality_max_tokens_invalid");
  }
  return isAmdQwenRoute(settings)
    ? { temperature: 0, reasoningEffort: "low", maxTokens: settings.qualityMaxTokens ?? 2048 }
    : { temperature: 0 };
}

module.exports = { isAmdQwenRoute, resolveQualityGenerationPolicy };

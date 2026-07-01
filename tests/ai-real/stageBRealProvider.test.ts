import { describe, expect, it } from "vitest";
import { OpenAiCompatibleProvider } from "@/ai/providers/openAiCompatibleProvider";

const hasRealAiConfig = Boolean(process.env.AI_API_KEY && process.env.AI_MODEL);

describe("stage B real AI smoke test", () => {
  (hasRealAiConfig ? it : it.skip)("returns JSON for a redacted non-personal sample", async () => {
    const provider = new OpenAiCompatibleProvider();
    const result = await provider.invoke({
      systemPrompt: "Return only JSON: {\"status\":\"ok\"}.",
      userPrompt: "This is a redacted test sample with no real contact details.",
      maxOutputChars: 2_000,
      signal: AbortSignal.timeout(20_000)
    });

    expect(result.provider).toBeTruthy();
    expect(result.model).toBeTruthy();
    expect(result.output).toMatchObject({ status: "ok" });
  });
});

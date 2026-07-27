import { describe, expect, it } from "vitest";
import { parseOpenAiCompatibleSse } from "@/ai/providers/openAiSse";

function streamFrames(parts: string[]) {
  const body = parts.map((content) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
  ).join("") + "data: [DONE]\n\n";
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  });
}

async function normalized(parts: string[]) {
  let output = "";
  for await (const delta of parseOpenAiCompatibleSse(streamFrames(parts))) output += delta;
  return output;
}

describe("P4.2a.3e OpenAI-compatible delta defense", () => {
  it("preserves normal incremental deltas", async () => {
    await expect(normalized(["你", "好"])).resolves.toBe("你好");
  });

  it("drops an exact duplicate frame", async () => {
    await expect(normalized(["你好", "你好"])).resolves.toBe("你好");
  });

  it("converts cumulative snapshots to suffix deltas", async () => {
    await expect(normalized(["你", "你好", "你好，今天"])).resolves.toBe("你好，今天");
  });
});

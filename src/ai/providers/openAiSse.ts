export async function* parseOpenAiCompatibleSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let frameEnd = buffer.indexOf("\n\n");
    while (frameEnd >= 0) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      const delta = parseOpenAiFrame(frame);
      if (delta) yield delta;
      frameEnd = buffer.indexOf("\n\n");
    }
  }
  buffer += decoder.decode();
  const delta = parseOpenAiFrame(buffer);
  if (delta) yield delta;
}

function parseOpenAiFrame(frame: string) {
  const dataLines = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  let text = "";
  for (const data of dataLines) {
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data);
      const delta = parsed?.choices?.[0]?.delta?.content
        ?? parsed?.choices?.[0]?.message?.content
        ?? "";
      if (typeof delta === "string") text += delta;
    } catch {
      continue;
    }
  }
  return text;
}

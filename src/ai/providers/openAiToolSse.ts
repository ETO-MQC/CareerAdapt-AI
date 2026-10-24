export async function* parseOpenAiJsonSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let delimiter = /\r?\n\r?\n/.exec(buffer);
      while (delimiter) {
        const frame = buffer.slice(0, delimiter.index);
        buffer = buffer.slice(delimiter.index + delimiter[0].length);
        const data = frame.split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (data === "[DONE]") return;
        if (data) yield objectRecord(JSON.parse(data)) ?? {};
        delimiter = /\r?\n\r?\n/.exec(buffer);
      }
    }
    buffer += decoder.decode();
    const data = buffer.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (data && data !== "[DONE]") yield objectRecord(JSON.parse(data)) ?? {};
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

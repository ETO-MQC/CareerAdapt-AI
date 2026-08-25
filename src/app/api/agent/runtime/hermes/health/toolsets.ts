export type HermesToolsetSnapshot = {
  ok: boolean;
  registeredToolsets: string[];
  visibleTools: string[];
};

/** Parse the official Hermes `/v1/toolsets` payload without trusting labels. */
export function parseHermesToolsetsPayload(value: unknown): HermesToolsetSnapshot {
  const root = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rows = Array.isArray(root.data) ? root.data : [];
  const registeredToolsets: string[] = [];
  const visibleTools: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    const enabled = record.enabled === true;
    if (!enabled) continue;
    if (typeof record.name === "string" && record.name.trim()) registeredToolsets.push(record.name.trim());
    const tools = Array.isArray(record.tools)
      ? record.tools
      : Array.isArray(record.resolved_tools) ? record.resolved_tools : [];
    for (const tool of tools) {
      if (typeof tool === "string" && tool.trim()) visibleTools.push(tool.trim());
    }
  }
  return {
    ok: typeof root.object === "string" || Array.isArray(root.data),
    registeredToolsets: [...new Set(registeredToolsets)].sort(),
    visibleTools: [...new Set(visibleTools)].sort()
  };
}

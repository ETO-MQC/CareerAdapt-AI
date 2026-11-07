// Test-provider interpretation of the locked Hermes MCP envelope; no writes or fake receipts.
export function hasVerifiedJobCommit(value, depth = 0) {
  if (depth > 10 || value == null) return false;
  if (typeof value === "string") {
    const start = value.indexOf("{"), end = value.lastIndexOf("}");
    try { return hasVerifiedJobCommit(JSON.parse(value.slice(start, end + 1)), depth + 1); }
    catch { return false; }
  }
  if (Array.isArray(value)) return value.some(item => hasVerifiedJobCommit(item, depth + 1));
  if (typeof value !== "object") return false;
  const cp = value.workflowCheckpoint;
  if (cp?.kind === "job_intake" && cp.persistenceVerified === true && cp.businessStatus === "committed" && typeof cp.jobId === "string") return true;
  return ["result", "data", "structuredContent", "content", "text"].some(key => hasVerifiedJobCommit(value[key], depth + 1));
}

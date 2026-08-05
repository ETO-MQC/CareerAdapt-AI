/** A single runtime date boundary shared by prompts and deterministic guards. */
export function currentRuntimeDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

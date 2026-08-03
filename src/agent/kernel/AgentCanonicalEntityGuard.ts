const CANONICAL_KEYS = new Set([
  "name", "personName", "school", "company", "jobTitle", "title",
  "projectTitle", "email", "phone", "url", "date"
]);

export class AgentCanonicalEntityGuard {
  private readonly values = new Set<string>();

  observe(value: unknown) {
    collectCanonicalValues(value, this.values);
  }

  preserve(text: string) {
    let result = text;
    for (const value of this.values) {
      if (!/^[\p{Script=Han}]{3,8}$/u.test(value) || result.includes(value)) continue;
      const shortened = value.slice(0, -1);
      if (shortened.length >= 2) {
        result = result.replace(
          new RegExp(`${escapeRegExp(shortened)}(?!${escapeRegExp(value.slice(-1))})`, "gu"),
          value
        );
      }
      result = result.replace(/^((?:你好|您好)[，, ]?)[\p{Script=Han}]{2,8}([！!。.]?)$/u, `$1${value}$2`);
    }
    return result;
  }
}

function collectCanonicalValues(value: unknown, target: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectCanonicalValues(item, target);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (CANONICAL_KEYS.has(key) && (typeof entry === "string" || typeof entry === "number")) {
      target.add(String(entry));
    }
    collectCanonicalValues(entry, target);
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

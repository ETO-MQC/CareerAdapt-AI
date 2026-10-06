// V4-P0 A1: shared pepper resolution for the credential fingerprint used by
// both fingerprint implementations of one launch (electron/hermesCompanion.js
// for the supervisor, src/services/agent/aiRuntimeConfiguration.ts for the
// Next health/test routes). Every launch path must call
// ensureCredentialFingerprintPepper() BEFORE the Next server starts so all
// module graphs of that launch read the same value from process.env:
// - packaged Electron / `electron .`: electron/main.js (Next runs in-process);
// - `pnpm dev` (scripts/dev-with-hermes.mjs): the value travels through the
//   spawned Next process environment;
// - CAREERADAPT_CREDENTIAL_PEPPER can also be pinned explicitly (tests,
//   future split-process launches).
// Uses globalThis.crypto so the module stays loadable in the renderer bundle,
// where it only serves the display-only fingerprint fallback.

function isValidPepper(value) {
  return typeof value === "string" && value.trim().length >= 16;
}

function ensureCredentialFingerprintPepper(configured) {
  const candidate = isValidPepper(configured)
    ? configured.trim()
    : (typeof process !== "undefined" && process.env ? process.env.CAREERADAPT_CREDENTIAL_PEPPER : undefined);
  if (isValidPepper(candidate)) {
    const pepper = candidate.trim();
    if (typeof process !== "undefined" && process.env) process.env.CAREERADAPT_CREDENTIAL_PEPPER = pepper;
    return pepper;
  }
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const pepper = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (typeof process !== "undefined" && process.env) process.env.CAREERADAPT_CREDENTIAL_PEPPER = pepper;
  return pepper;
}

function credentialFingerprintPepper() {
  const configured = typeof process !== "undefined" && process.env ? process.env.CAREERADAPT_CREDENTIAL_PEPPER : undefined;
  if (isValidPepper(configured)) return configured.trim();
  return ensureCredentialFingerprintPepper();
}

module.exports = {
  ensureCredentialFingerprintPepper,
  credentialFingerprintPepper
};

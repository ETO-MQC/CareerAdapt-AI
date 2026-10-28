/* eslint-disable @typescript-eslint/no-require-imports -- Electron main-process CommonJS fixture, matching the production store. */
const { app, safeStorage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { createUserDataCredentialStore, restoreProviderCredential } = require("../../electron/providerCredentialStore");

// Synthetic fixture only; this value is never sent to any Provider.
const fixture = "synthetic-r1-dpapi-test-only";
app.setPath("userData", process.env.R1_PROFILE);
app.whenReady().then(() => {
  try {
    const store = createUserDataCredentialStore(app.getPath("userData"), safeStorage);
    assert.equal(store.available(), true);
    if (process.env.R1_PHASE === "write") assert.equal(store.write(fixture).ok, true);
    const environment = { AI_PROVIDER: "openai-compatible", AI_BASE_URL: "https://provider.example/v1" };
    const status = restoreProviderCredential(environment, store);
    assert.equal(environment.AI_API_KEY, fixture);
    assert.equal(fs.readFileSync(path.join(app.getPath("userData"), "provider-credentials.json"), "utf8").includes(fixture), false);
    console.log(JSON.stringify({ phase: process.env.R1_PHASE, nativeElectronVersion: process.versions.electron, status, restored: true, encryptedAtRest: true }));
    // Use normal Chromium shutdown so its OS-encryption Local State is flushed.
    setTimeout(() => app.quit(), 1000);
  } catch (error) {
    console.log(JSON.stringify({ phase: process.env.R1_PHASE, error: error.code || "native_credential_check_failed" }));
    process.exitCode = 1;
    app.quit();
  }
});

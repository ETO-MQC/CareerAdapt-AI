import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { HermesModelConfigClient } = createRequire(import.meta.url)("../../electron/hermesModelConfigClient.js");

describe("Hermes model readback timeout", () => {
  it("requires an explicit runtime selection readback and refuses old inventory responses", async () => {
    const urls: string[] = [];
    const client = new HermesModelConfigClient({ runtimeUrl: "http://127.0.0.1:1", fetchImpl: async (url: string) => {
      urls.push(url);
      return { ok: true, json: async () => ({ provider: "custom:careeradapt", model: "target" }) };
    } });
    await expect(client.readModelOptions()).rejects.toMatchObject({ code: "hermes_model_selection_readback_unsupported" });
    expect(urls).toEqual(["http://127.0.0.1:1/api/model/options?selection_only=true"]);
  });

  it("returns only the runtime-confirmed selection", async () => {
    const client = new HermesModelConfigClient({ runtimeUrl: "http://127.0.0.1:1", fetchImpl: async () => ({
      ok: true, json: async () => ({ selection_only: true, provider: "custom:careeradapt", model: "target" })
    }) });
    await expect(client.readModelOptions()).resolves.toEqual({ provider: "custom:careeradapt", model: "target" });
  });
  it("maps the actual DOM TimeoutError code 23 to a stable safe code without retrying", async () => {
    const timeout = new DOMException("sensitive endpoint details", "TimeoutError");
    expect(timeout.code).toBe(23);
    let calls = 0;
    const client = new HermesModelConfigClient({ runtimeUrl: "http://127.0.0.1:1", fetchImpl: async () => {
      calls += 1;
      throw timeout;
    } });
    await expect(client.readModelOptions()).rejects.toMatchObject({ code: "hermes_model_config_timeout", message: "hermes_model_config_timeout" });
    expect(calls).toBe(1);
  });
});

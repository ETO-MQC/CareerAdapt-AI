import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { HermesModelConfigClient } = createRequire(import.meta.url)("../../electron/hermesModelConfigClient.js");

describe("Hermes model readback timeout", () => {
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

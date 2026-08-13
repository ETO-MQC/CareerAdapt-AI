import { describe, expect, it } from "vitest";
import {
  aiProviderErrorCode,
  classifyAiTransportError,
  isProviderTransportFailureCode
} from "@/ai/providers/transportError";

describe("AI provider transport classification", () => {
  it.each([
    [{ cause: { code: "ENOTFOUND" } }, "provider_dns_failed", "dns"],
    [{ cause: { code: "ECONNRESET" } }, "provider_connection_failed", "tcp"],
    [{ cause: { code: "ERR_TLS_CERT_ALTNAME_INVALID" } }, "provider_tls_certificate_invalid", "tls"],
    [{ cause: { code: "ERR_SSL_PROTOCOL_ERROR" } }, "provider_tls_failed", "tls"],
    [{ name: "TimeoutError" }, "provider_timeout", "unknown"]
  ])("maps safe cause %j without exposing raw error text", (error, code, phase) => {
    const diagnostic = classifyAiTransportError(error);
    expect(diagnostic).toMatchObject({ safeErrorCode: code, phase });
    expect(JSON.stringify(diagnostic)).not.toContain("Authorization");
    expect(JSON.stringify(diagnostic)).not.toContain("api-key");
  });

  it("preserves known provider diagnostics and never turns credentials into diagnostics", () => {
    const error = Object.assign(new Error("TLS stack / secret-token should not be returned"), {
      code: "provider_tls_failed",
      diagnostic: {
        safeErrorCode: "provider_tls_failed",
        phase: "tls",
        safeCauseCode: "ERR_SSL_PROTOCOL_ERROR"
      }
    });
    expect(aiProviderErrorCode(error)).toBe("provider_tls_failed");
    expect(JSON.stringify(classifyAiTransportError(error))).not.toContain("secret-token");
  });

  it("marks only safe provider transport errors as retryable", () => {
    expect(isProviderTransportFailureCode("provider_tls_failed")).toBe(true);
    expect(isProviderTransportFailureCode("provider_http_503")).toBe(true);
    expect(isProviderTransportFailureCode("model_schema_invalid")).toBe(false);
  });
});

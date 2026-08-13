import "server-only";
import { lookup } from "node:dns/promises";
import { createConnection } from "node:net";
import { connect as connectTls } from "node:tls";
import type { EffectiveAiConfiguration } from "./effectiveConfiguration";
import { classifyAiTransportError, type AiTransportPhase, type SafeAiTransportDiagnostic } from "./transportError";

export type AiProviderConnectionDiagnostics = {
  runtime: string;
  dns: NetworkProbe;
  tcp: NetworkProbe;
  tls: TlsProbe;
  http: HttpProbe;
  latencyMs: number;
};

type NetworkProbe = {
  status: "ok" | "failed" | "skipped";
  latencyMs?: number;
  addressCount?: number;
  safeErrorCode?: string;
  phase?: AiTransportPhase;
};

type TlsProbe = NetworkProbe & {
  authorized?: boolean;
  protocol?: string;
};

type HttpProbe = {
  status: "not_attempted" | "not_reached" | "reached";
  latencyMs?: number;
  statusCode?: number;
  safeErrorCode?: string;
  phase?: "http" | "unknown";
};

export async function probeAiProviderTransport(
  configuration: EffectiveAiConfiguration,
  signal?: AbortSignal
): Promise<{ diagnostics: AiProviderConnectionDiagnostics; failureCode?: string }> {
  const startedAt = Date.now();
  const base = emptyDiagnostics();
  let endpoint: URL;
  try {
    endpoint = new URL(`${configuration.baseUrl.replace(/\/$/u, "")}/chat/completions`);
  } catch {
    return {
      diagnostics: {
        ...base,
        dns: failedProbe("provider_protocol_mismatch", "unknown"),
        tcp: skippedProbe(),
        tls: skippedProbe(),
        latencyMs: Date.now() - startedAt
      },
      failureCode: "provider_protocol_mismatch"
    };
  }

  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    return {
      diagnostics: {
        ...base,
        dns: failedProbe("provider_protocol_mismatch", "unknown"),
        tcp: skippedProbe(),
        tls: skippedProbe(),
        latencyMs: Date.now() - startedAt
      },
      failureCode: "provider_protocol_mismatch"
    };
  }

  const port = Number(endpoint.port) || (endpoint.protocol === "https:" ? 443 : 80);
  const dnsStartedAt = Date.now();
  let addresses: Array<{ address: string; family: number }>;
  try {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    addresses = await lookup(endpoint.hostname, { all: true, verbatim: true });
    base.dns = {
      status: "ok",
      latencyMs: Date.now() - dnsStartedAt,
      addressCount: addresses.length,
      phase: "dns"
    };
  } catch (error) {
    const diagnostic = classifyAiTransportError(error, { requestSignal: signal });
    base.dns = failedProbe(diagnostic.safeErrorCode, diagnostic.phase, Date.now() - dnsStartedAt);
    return { diagnostics: { ...base, latencyMs: Date.now() - startedAt }, failureCode: diagnostic.safeErrorCode };
  }

  const tcp = await probeTcp(endpoint.hostname, port, signal);
  base.tcp = tcp;
  if (tcp.status !== "ok") {
    return { diagnostics: { ...base, tls: skippedProbe(), latencyMs: Date.now() - startedAt }, failureCode: tcp.safeErrorCode };
  }

  if (endpoint.protocol === "https:") {
    const tls = await probeTls(endpoint.hostname, port, signal);
    base.tls = tls;
    if (tls.status !== "ok") {
      return { diagnostics: { ...base, latencyMs: Date.now() - startedAt }, failureCode: tls.safeErrorCode };
    }
  } else {
    base.tls = skippedProbe();
  }

  return { diagnostics: { ...base, latencyMs: Date.now() - startedAt } };
}

export function connectionDiagnosticsWithHttp(
  diagnostics: AiProviderConnectionDiagnostics,
  input: { status: "not_reached" | "reached"; statusCode?: number; latencyMs?: number; error?: SafeAiTransportDiagnostic }
) {
  return {
    ...diagnostics,
    http: {
      status: input.status,
      ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
      ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
      ...(input.error?.safeErrorCode ? { safeErrorCode: input.error.safeErrorCode } : {}),
      ...(input.error?.phase === "http" || input.error?.phase === "unknown" ? { phase: input.error.phase } : {})
    } satisfies HttpProbe,
    latencyMs: diagnostics.latencyMs + (input.latencyMs ?? 0)
  } satisfies AiProviderConnectionDiagnostics;
}

function emptyDiagnostics(): AiProviderConnectionDiagnostics {
  return {
    runtime: process.version,
    dns: skippedProbe(),
    tcp: skippedProbe(),
    tls: skippedProbe(),
    http: { status: "not_attempted" },
    latencyMs: 0
  };
}

function skippedProbe(): NetworkProbe {
  return { status: "skipped" };
}

function failedProbe(code: string, phase: AiTransportPhase, latencyMs?: number): NetworkProbe {
  return {
    status: "failed",
    safeErrorCode: code,
    phase,
    ...(latencyMs !== undefined ? { latencyMs } : {})
  };
}

function probeTcp(hostname: string, port: number, signal?: AbortSignal): Promise<NetworkProbe> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = createConnection({ host: hostname, port });
    let settled = false;
    const finish = (probe: NetworkProbe) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(probe);
    };
    const timer = setTimeout(() => finish(failedProbe("provider_timeout", "tcp", Date.now() - startedAt)), 10_000);
    const abort = () => finish(failedProbe("request_cancelled", "tcp", Date.now() - startedAt));
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    socket.once("connect", () => {
      cleanup();
      finish({ status: "ok", latencyMs: Date.now() - startedAt, phase: "tcp" });
    });
    socket.once("error", (error) => {
      cleanup();
      const diagnostic = classifyAiTransportError(error, { requestSignal: signal });
      finish(failedProbe(diagnostic.safeErrorCode, "tcp", Date.now() - startedAt));
    });
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function probeTls(hostname: string, port: number, signal?: AbortSignal): Promise<TlsProbe> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = connectTls({ host: hostname, port, servername: hostname, rejectUnauthorized: true });
    let settled = false;
    const finish = (probe: TlsProbe) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(probe);
    };
    const timer = setTimeout(() => finish({ ...failedProbe("provider_timeout", "tls", Date.now() - startedAt), authorized: false }), 10_000);
    const abort = () => finish({ ...failedProbe("request_cancelled", "tls", Date.now() - startedAt), authorized: false });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    socket.once("secureConnect", () => {
      cleanup();
      if (!socket.authorized) {
        finish({
          ...failedProbe("provider_tls_certificate_invalid", "tls", Date.now() - startedAt),
          authorized: false,
          ...(socket.getProtocol() ? { protocol: socket.getProtocol()! } : {})
        });
        return;
      }
      finish({
        status: "ok",
        latencyMs: Date.now() - startedAt,
        phase: "tls",
        authorized: true,
        ...(socket.getProtocol() ? { protocol: socket.getProtocol()! } : {})
      });
    });
    socket.once("error", (error) => {
      cleanup();
      const diagnostic = classifyAiTransportError(error, { requestSignal: signal });
      finish({ ...failedProbe(diagnostic.safeErrorCode, "tls", Date.now() - startedAt), authorized: false });
    });
    signal?.addEventListener("abort", abort, { once: true });
  });
}

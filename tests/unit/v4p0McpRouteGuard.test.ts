import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, POST } from "@/app/api/agent/mcp/route";

const LOOPBACK = "http://127.0.0.1:3000/api/agent/mcp";

function mcpRequest(method: "GET" | "POST" | "DELETE", url: string, headers: Record<string, string>, body?: string) {
  return new NextRequest(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body })
  });
}

describe("V4-P0 C MCP route loopback guard", () => {
  it("rejects non-loopback callers on every method", async () => {
    const getResponse = await GET(mcpRequest("GET", "http://192.168.1.20:3000/api/agent/mcp", { host: "192.168.1.20:3000" }));
    expect(getResponse.status).toBe(403);
    expect(await getResponse.json()).toMatchObject({ error: { code: -32001 } });

    const postResponse = await POST(mcpRequest("POST", "http://192.168.1.20:3000/api/agent/mcp", { host: "192.168.1.20:3000" }, "{}"));
    expect(postResponse.status).toBe(403);

    const deleteResponse = await DELETE(mcpRequest("DELETE", "http://192.168.1.20:3000/api/agent/mcp", { host: "192.168.1.20:3000" }));
    expect(deleteResponse.status).toBe(403);
  });

  it("rejects a cross-origin browser caller", async () => {
    const response = await GET(mcpRequest("GET", LOOPBACK, {
      host: "127.0.0.1:3000",
      origin: "https://evil.example"
    }));
    expect(response.status).toBe(403);
  });

  it("rejects a rebinding Host that is not loopback even when the request URL is", async () => {
    const response = await POST(mcpRequest("POST", LOOPBACK, {
      host: "evil.example",
      "content-type": "application/json"
    }, "{}"));
    expect(response.status).toBe(403);
  });

  it("accepts a loopback process caller without an Origin header (Hermes gateway)", async () => {
    const response = await GET(mcpRequest("GET", LOOPBACK, { host: "127.0.0.1:3000" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ server: "careeradapt" });
  });

  it("accepts a loopback same-origin browser caller", async () => {
    const response = await POST(mcpRequest("POST", LOOPBACK, {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json"
    }, "not-json"));
    // The guard passed; the JSON-RPC layer answers with its own parse error.
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32700 } });
  });
});

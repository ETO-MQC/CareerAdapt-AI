import { describe, expect, it } from "vitest";
import {
  AgentToolProtocolError,
  normalizeAgentToolProtocol
} from "@/agent/model/AgentToolProtocolAdapter";

const allowed = [{ name: "get_profile" }, { name: "list_profiles" }];

describe("P4.3h AgentToolProtocolAdapter", () => {
  it("keeps native OpenAI tool_calls authoritative", () => {
    const result = normalizeAgentToolProtocol({
      stopReason: "tool_calls",
      toolCalls: [{ id: "call-1", name: "get_profile", arguments: { profileId: "profile-1" } }]
    }, allowed);

    expect(result).toMatchObject({ protocol: "native_openai", repairApplied: false, stopReason: "tool_calls" });
    expect(result.toolCalls[0]).toMatchObject({ name: "get_profile", arguments: { profileId: "profile-1" } });
  });

  it("repairs Hermes-style XML parameters", () => {
    const result = normalizeAgentToolProtocol({
      stopReason: "final",
      text: "<tool_call><function=get_profile><parameter=profileId>profile-1</parameter></function></tool_call>"
    }, allowed);

    expect(result.protocol).toBe("textual_xml");
    expect(result.repairApplied).toBe(true);
    expect(result.toolCalls[0]?.arguments).toEqual({ profileId: "profile-1" });
  });

  it("repairs JSON embedded in a tool_call wrapper", () => {
    const result = normalizeAgentToolProtocol({
      stopReason: "final",
      text: '<tool_call>{"name":"get_profile","arguments":{"profileId":"profile-1"}}</tool_call>'
    }, allowed);

    expect(result.protocol).toBe("textual_json");
    expect(result.toolCalls[0]?.name).toBe("get_profile");
  });

  it("repairs function JSON and structured-actions JSON", () => {
    const functionResult = normalizeAgentToolProtocol({
      stopReason: "final",
      text: '<function=get_profile>{"profileId":"profile-1"}</function>'
    }, allowed);
    const structuredResult = normalizeAgentToolProtocol({
      stopReason: "final",
      text: JSON.stringify({
        toolCalls: [{ name: "get_profile", arguments: { profileId: "profile-1" } }],
        stopReason: "tool_calls"
      })
    }, allowed);

    expect(functionResult.toolCalls[0]?.arguments).toEqual({ profileId: "profile-1" });
    expect(structuredResult.protocol).toBe("structured_json");
    expect(structuredResult.toolCalls).toHaveLength(1);
  });

  it("does not execute or silently discard unknown tools", () => {
    const native = normalizeAgentToolProtocol({
      stopReason: "tool_calls",
      toolCalls: [{ id: "call-unknown", name: "delete_everything", arguments: {} }]
    }, allowed);
    expect(native.toolCalls).toHaveLength(1);
    expect(native.diagnostics.unknownToolNames).toEqual(["delete_everything"]);

    const structured = normalizeAgentToolProtocol({
      stopReason: "final",
      text: JSON.stringify({ toolCalls: [{ name: "delete_everything", arguments: {} }], stopReason: "tool_calls" })
    }, allowed);
    expect(structured.toolCalls).toEqual([]);
    expect(structured.diagnostics.safeErrorCode).toBe("unknown_agent_tool");
  });

  it("turns malformed textual markers into one safe repair error", () => {
    expect(() => normalizeAgentToolProtocol({
      stopReason: "final",
      text: "<tool_call><function=get_profile><parameter=profileId>profile-1"
    }, allowed)).toThrowError(AgentToolProtocolError);
  });
});

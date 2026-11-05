"""Synthetic tools: no network, files, environment, subprocesses or user data."""
import json
import sys

COUNTS = {}

def emit(kind, value):
    print("A02_EVIDENCE " + json.dumps({"kind": kind, **value}, default=str), file=sys.stderr, flush=True)

def echo(args, **kwargs):
    if args != {"value": "A02_SYNTHETIC"}:
        raise ValueError("Only fixed synthetic input is allowed")
    COUNTS["echo"] = COUNTS.get("echo", 0) + 1
    result = {"ok": True, "value": "A02_SYNTHETIC", "checksum": "fixed-v1"}
    emit("handler", {"name": "a02_qualification_echo", "handler_invocation_count": COUNTS["echo"], "result": result})
    return json.dumps(result)

def failure(args, **kwargs):
    if args != {"value": "A02_SYNTHETIC"}:
        raise ValueError("Only fixed synthetic input is allowed")
    COUNTS["failure"] = COUNTS.get("failure", 0) + 1
    emit("handler", {"name": "a02_qualification_failure", "handler_invocation_count": COUNTS["failure"], "error": "A02_DETERMINISTIC_FAILURE"})
    raise ValueError("A02_DETERMINISTIC_FAILURE")

def observe(kind):
    def callback(**kwargs):
        keys = ("session_id", "turn_id", "task_id", "api_request_id", "model", "response_model", "tool_name", "tool_call_id", "arguments", "result", "error", "response", "request", "tool_calls")
        selected = {k: kwargs[k] for k in keys if k in kwargs}
        # Native sanitized request view: omit headers entirely.
        if isinstance(selected.get("request"), dict):
            selected["request"] = {k: v for k, v in selected["request"].items() if k in ("body", "url", "method")}
        emit(kind, selected)
    return callback

def register(ctx):
    parameters = {"type": "object", "properties": {"value": {"type": "string", "enum": ["A02_SYNTHETIC"]}}, "required": ["value"], "additionalProperties": False}
    for name, handler in (("a02_qualification_echo", echo), ("a02_qualification_failure", failure)):
        ctx.register_tool(name=name, toolset="a02_qualification", schema={"name": name, "description": "Synthetic qualification only. Call exactly once with value A02_SYNTHETIC. " + ("Returns ok true, value and checksum fixed-v1." if name.endswith("echo") else "Raises deterministic A02_DETERMINISTIC_FAILURE."), "parameters": parameters}, handler=handler)
    for hook in ("pre_api_request", "post_api_request", "pre_tool_call", "post_tool_call"):
        ctx.register_hook(hook, observe(hook))
    emit("registered", {"tools": ["a02_qualification_echo", "a02_qualification_failure"]})


"""D3 native plugin: no Repository, Dexie, database, profile facts or grant issuer."""
import contextvars
import hashlib
import hmac
import json
import os
import struct

_context = contextvars.ContextVar("career_d3_context", default=None)
_retained = {}


def encode(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def exchange(pipe, request):
    raw = encode(request)
    mac = hmac.new(os.environ['CAREERADAPT_D3_SECRET'].encode(), raw.encode(), hashlib.sha256).hexdigest()
    body = encode({"request": request, "mac": mac}).encode()
    pipe.write(struct.pack(">I", len(body)) + body)
    def exact(size):
        data = b""
        while len(data) < size:
            part = pipe.read(size - len(data))
            if not part:
                raise EOFError("D3_UNKNOWN_LOST_ACK")
            data += part
        return data
    length = struct.unpack(">I", exact(4))[0]
    if length > 280000:
        raise ValueError("D3_RESULT_TOO_LARGE")
    return json.loads(exact(length))


def call(tool, args, **kwargs):
    context = _context.get()
    if not context:
        return encode({"ok": False, "error": {"code": "UNBOUND_CONTEXT"}})
    keys = {'sectionTypes', 'limit', 'cursor'} | ({'query'} if tool.endswith('search_facts') else set())
    if not isinstance(args, dict) or set(args) - keys:
        return encode({"ok": False, "error": {"code": "INVALID_REQUEST"}})
    request = {"kind": "invoke", **context, "tool": tool, "args": args}
    # The invocation identity must not change when arguments change. Payload
    # changes under the same native call are conflicts, never fresh executions.
    operation = hashlib.sha256(encode(context).encode()).hexdigest()
    request = {"kind": "invoke", "operationId": operation, **context, "tool": tool, "args": args}
    _retained[operation] = request
    from tools.interrupt import is_interrupted
    try:
        with open(os.environ['CAREERADAPT_D3_PIPE'], 'r+b', buffering=0) as pipe:
            response = exchange(pipe, request)
            if response.get('status') != 'READY':
                return encode({"ok": False, "operationId": operation, "error": {"code": response.get('error', response.get('status', 'UNKNOWN'))}})
            # Cooperatively discard after native Stop; this does not kill reads.
            action = 'cancel' if is_interrupted() else 'release'
            released = exchange(pipe, {"kind": action, "operationId": operation})
            if action == 'cancel' or released.get('status') != 'CANDIDATE':
                return encode({"ok": False, "operationId": operation, "error": {"code": released.get('error', 'CANCELLED')}})
            # Candidate bytes are not a model result. Revalidate AFTER receiving
            # them, so a queued candidate crossing revoke cannot be delivered.
            action = 'cancel' if is_interrupted() else 'commit-delivery'
            committed = exchange(pipe, {"kind": action, "operationId": operation})
            if committed.get('status') != 'AUTHORIZED':
                return encode({"ok": False, "operationId": operation, "error": {"code": committed.get('error', 'CANCELLED')}})
            return encode({"operationId": operation, **released['result']})
    except (EOFError, OSError):
        # No retry, fallback, fresh operation ID, or implicit status execution.
        return encode({"ok": False, "operationId": operation, "error": {"code": "UNKNOWN"}})


def get(args, **kwargs):
    return call('career.profile.get', args, **kwargs)


def search(args, **kwargs):
    return call('career.profile.search_facts', args, **kwargs)


def execution(*, tool_name, session_id, turn_id, tool_call_id, args, next_call, **kwargs):
    if tool_name not in ('career.profile.get', 'career.profile.search_facts'):
        return next_call(args)
    if not session_id or not turn_id or not tool_call_id:
        return encode({"ok": False, "error": {"code": "UNBOUND_CONTEXT"}})
    token = _context.set({"sessionId": session_id, "turnId": turn_id, "toolCallId": tool_call_id})
    try:
        return next_call(args)
    finally:
        _context.reset(token)


def register(ctx):
    if os.environ.get('CAREERADAPT_D3') != '1':
        return
    properties = {"sectionTypes": {"type": "array", "items": {"type": "string"}}, "limit": {"type": "integer", "minimum": 1, "maximum": 20}, "cursor": {"type": "string"}}
    for name, handler in [('career.profile.get', get), ('career.profile.search_facts', search)]:
        props = dict(properties)
        if name.endswith('search_facts'):
            props['query'] = {"type": "string", "minLength": 1}
        ctx.register_tool(name=name, toolset='career_d3', schema={"name": name, "description": "Read isolated synthetic Profile facts. Never invent facts or treat unconfirmed content as confirmed.", "parameters": {"type": "object", "properties": props, "additionalProperties": False}}, handler=handler)
    ctx.register_middleware('tool_execution', execution)

"""Offline managed-config -> locked Hermes -> actual SDK JSON -> loopback capture."""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
import yaml
from openai import OpenAI
from hermes_constants import resolve_reasoning_config
from agent.transports.chat_completions import ChatCompletionsTransport

home, output, mode = sys.argv[1:4]
config = yaml.safe_load((Path(home) / "config.yaml").read_text(encoding="utf8"))
assert config["agent"]["max_iterations"] == 42
assert config["agent"]["reasoning_overrides"]["OtherModel"] == "medium"
assert config["agent"]["reasoning_overrides"]["Qwen3.8-27B"] == "low"
captured = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        captured.append(payload)
        body = json.dumps({"id": "offline", "object": "chat.completion", "created": 0,
                           "model": payload["model"], "choices": [{"index": 0, "message": {"role": "assistant", "content": "OK"}, "finish_reason": "stop"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()


class LoopbackOnly(httpx.BaseTransport):
    def __init__(self):
        self.inner = httpx.HTTPTransport()

    def handle_request(self, request):
        # All requests are forced to the local capture server; no DNS/upstream access.
        url = request.url.copy_with(scheme="http", host="127.0.0.1", port=server.server_port)
        return self.inner.handle_request(httpx.Request(request.method, url, headers=request.headers, content=request.content))

    def close(self):
        self.inner.close()


try:
    transport = ChatCompletionsTransport()
    checks = [("https://developer.amd.com.cn/radeon/api/v1", "Qwen3.8-27B", None)]
    if mode == "patched":
        checks += [("https://developer.amd.com.cn/radeon/api/v1", "Qwen3.8-27B", effort) for effort in ["medium", "xhigh"]]
        checks += [("https://developer.amd.com.cn/radeon/api/v1", "OtherModel", None), ("https://self-hosted.invalid/v1", "Qwen3.8-27B", None)]
    rows = []
    for base, model, explicit in checks:
        reasoning = resolve_reasoning_config(config, model)
        if explicit:
            reasoning = {"enabled": True, "effort": explicit}
        kwargs = transport.build_kwargs(model=model, messages=[{"role": "user", "content": "Synthetic offline wire capture"}],
                                        base_url=base, reasoning_config=reasoning, is_custom_provider=True,
                                        max_tokens=7777, max_tokens_param_fn=lambda count: {"max_tokens": count})
        with OpenAI(api_key="offline-synthetic-key", base_url=base, max_retries=0,
                    http_client=httpx.Client(transport=LoopbackOnly())) as client:
            client.chat.completions.create(**kwargs)
        payload = captured[-1]
        expected = explicit or "low"
        targeted = base.startswith("https://developer.amd.com.cn/") and model == "Qwen3.8-27B"
        if mode == "unpatched":
            assert reasoning == {"enabled": True, "effort": "low"}, reasoning
            assert "reasoning_effort" not in payload, payload
        elif targeted:
            assert payload.get("reasoning_effort") == expected, payload
            assert not payload.get("reasoning"), payload
        else:
            assert "reasoning_effort" not in payload, payload
        assert payload.get("max_tokens") == 7777, payload
        rows.append({"baseUrl": base, "model": model, "resolvedReasoning": reasoning, "wireBody": payload})
    if mode == "patched":
        for effort in ["none", "high"]:
            try:
                transport.build_kwargs(model="Qwen3.8-27B", messages=[], base_url=checks[0][0], reasoning_config={"effort": effort})
                raise AssertionError("unsupported AMD tier accepted")
            except ValueError as error:
                assert str(error) == "careeradapt_amd_reasoning_effort_unsupported"
    Path(output).write_text(json.dumps({"status": "PASS", "mode": mode, "network": "loopback only; SDK transport rewrites all upstream URLs",
        "scope": "CareerAdapt managed YAML -> bundled Hermes resolver and transport -> real OpenAI SDK serialization -> local HTTP server; not a full CareerAdapt Run", "requests": rows}, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"status": "PASS", "mode": mode, "captured": len(rows)}))
finally:
    server.shutdown()
    server.server_close()

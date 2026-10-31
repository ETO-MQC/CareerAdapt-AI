"""Real locked Hermes conversation + SDK stream, with all HTTP confined to loopback."""
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import httpx
import yaml
from hermes_constants import resolve_reasoning_config
from hermes_cli.timeouts import get_provider_request_timeout, get_provider_stale_timeout
from run_agent import AIAgent

home, output = sys.argv[1:3]
path = Path(home) / "config.yaml"
original = yaml.safe_load(path.read_text(encoding="utf8"))
records = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if not payload.get("model"):
            body = b"{}"
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        records.append({"model": payload.get("model"), "stream": payload.get("stream"),
                        "reasoning_effort": payload.get("reasoning_effort"), "max_tokens": payload.get("max_tokens"),
                        "tools_present": bool(payload.get("tools")), "at": time.monotonic()})
        time.sleep(3)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            chunk = {"id": "delayed-local", "object": "chat.completion.chunk", "created": 0,
                     "model": payload["model"], "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Delayed synthetic completion"}, "finish_reason": "stop"}]}
            self.wfile.write(("data: " + json.dumps(chunk) + "\n\ndata: [DONE]\n\n").encode())
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # Expected when the old socket read deadline has closed this test connection.


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
send = httpx.HTTPTransport.handle_request


def loopback_only(transport, request):
    if request.url.host == "developer.amd.com.cn":
        local = request.url.copy_with(scheme="http", host="127.0.0.1", port=server.server_port)
        request = httpx.Request(request.method, local, headers=request.headers, content=request.content, extensions=request.extensions)
    elif request.url.host not in {"127.0.0.1", "localhost"}:
        raise httpx.ConnectError("external_network_disabled_for_offline_test", request=request)
    return send(transport, request)


results = []
create_request_client = AIAgent._create_request_openai_client


def client_without_sdk_retries(agent, **kwargs):
    client = create_request_client(agent, **kwargs)
    client.max_retries = 0
    return client


try:
    for mode in ["legacy", "scoped"]:
        config = json.loads(json.dumps(original))
        if mode == "legacy":
            config.pop("providers", None)
        else:
            target = config["providers"]["custom:careeradapt"]["models"]["Qwen3.8-27B"]
            assert target["timeout_seconds"] == 480 and target["stale_timeout_seconds"] == 480
            target.update(timeout_seconds=4.8, stale_timeout_seconds=4.8)
        path.write_text(yaml.safe_dump(config), encoding="utf8")
        resolved = {"request": get_provider_request_timeout("custom", "Qwen3.8-27B"), "stale": get_provider_stale_timeout("custom", "Qwen3.8-27B")}
        assert resolved == ({"request": None, "stale": None} if mode == "legacy" else {"request": 4.8, "stale": 4.8}), resolved
        offset = len(records)
        with patch.object(httpx.HTTPTransport, "handle_request", loopback_only), patch("agent.reasoning_timeouts.get_reasoning_stale_timeout_floor", return_value=1.8), patch.object(AIAgent, "_create_request_openai_client", client_without_sdk_retries), patch.object(AIAgent, "_try_recover_primary_transport", return_value=False):
            agent = AIAgent(model="Qwen3.8-27B", provider="custom", requested_provider="custom:careeradapt",
                            base_url="https://developer.amd.com.cn/radeon/api/v1", api_key="synthetic-offline-key",
                            enabled_toolsets=[], max_iterations=2, quiet_mode=True, save_trajectories=False,
                            skip_context_files=True, skip_memory=True, reasoning_config=resolve_reasoning_config(config))
            agent._api_max_retries = 1
            agent.tools = [{"type": "function", "function": {"name": "synthetic_read", "description": "Offline read", "parameters": {"type": "object", "properties": {}}}}]
            started = time.monotonic()
            result = agent.run_conversation("Synthetic latency test", system_message="Respond briefly.")
            elapsed = time.monotonic() - started
        wire = records[offset:]
        success = result.get("final_response") == "Delayed synthetic completion"
        results.append({"mode": mode, "resolved": resolved, "elapsedSeconds": elapsed,
                        "success": success, "actualProviderId": agent.provider, "wire": wire,
                        "completed": result.get("completed"), "errorType": result.get("error") and "MODEL_REQUEST_FAILED"})
        assert wire and all(row["stream"] is True and row["reasoning_effort"] == "low" for row in wire), wire
        assert len(wire) == 1, len(wire)
        assert success == (mode == "scoped"), results[-1]
    # The named key cannot bleed into a different host/model even in the same Hermes home.
    assert get_provider_request_timeout("custom", "OtherModel") is None
    config["model"]["base_url"] = "https://other.invalid/v1"
    path.write_text(yaml.safe_dump(config), encoding="utf8")
    assert get_provider_request_timeout("custom", "Qwen3.8-27B") is None
    Path(output).write_text(json.dumps({"status": "PASS", "scope": "CareerAdapt managed config -> real bundled AIAgent.run_conversation -> OpenAI SDK stream -> delayed loopback Provider", "scale": {"legacyStale": 1.8, "newStale": 4.8, "firstResponse": 3.0}, "cases": results}, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"status": "PASS", "cases": len(results)}))
finally:
    path.write_text(yaml.safe_dump(original), encoding="utf8")
    server.shutdown()
    server.server_close()

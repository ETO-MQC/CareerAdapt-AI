"""Isolated fixture broker. No Repository, database, production config or retries."""
import atexit
import importlib.util
import subprocess
import sys
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException

_service_file = Path(__file__).with_name("fake_service.py")
_spec = importlib.util.spec_from_file_location("fixture_protocol", _service_file)
protocol = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(protocol)
router = APIRouter()


class Broker:
    def __init__(self):
        self.process = None
        self.state = "STOPPED"
        self.transitions = ["STOPPED"]
        self.lock = threading.Lock()

    def transition(self, state):
        self.state = state
        self.transitions.append(state)

    def close(self):
        with self.lock:
            if self.process is None:
                return {"state": self.state, "transitions": self.transitions}
            self.transition("DRAINING")
            self.process.stdin.close()
            try:
                code = self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
                self.transition("FAILED")
                raise
            self.process.stdout.close()
            self.process = None
            self.transition("STOPPED" if code == 0 else "FAILED")
            return {"state": self.state, "exitCode": code, "transitions": self.transitions}

    def open(self):
        with self.lock:
            if self.state not in ("STOPPED", "FAILED") or self.process is not None:
                raise HTTPException(409, "BROKER_NOT_STOPPED")
            self.transition("STARTING")
            self.process = subprocess.Popen([sys.executable, "-u", str(_service_file)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            self.transition("READY")
            return {"state": self.state, "pid": self.process.pid}

    def call(self, request):
        with self.lock:
            if self.state != "READY":
                raise HTTPException(503, "SERVICE_UNAVAILABLE")
            if self.process.poll() is not None:
                self.transition("FAILED")
                raise HTTPException(503, "SERVICE_EXITED")
            deadline = threading.Timer(5, self.process.kill)
            deadline.start()
            try:
                protocol.write_frame(self.process.stdin, request)
                response = protocol.read_frame(self.process.stdout)
                if response is None:
                    raise EOFError("SERVICE_DISCONNECTED")
                if response.get("requestId") != request.get("requestId"):
                    raise ValueError("RESPONSE_CORRELATION_ERROR")
                return response
            except (OSError, ValueError, EOFError) as exc:
                self.transition("FAILED")
                raise HTTPException(502, str(exc)) from exc
            finally:
                deadline.cancel()


broker = Broker()
atexit.register(broker.close)


@router.post("/open")
def open_broker():
    return broker.open()


@router.post("/close")
def close_broker():
    return broker.close()


@router.post("/rpc")
def rpc(request: dict):
    return broker.call(request)

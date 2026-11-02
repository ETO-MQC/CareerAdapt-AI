import json
import struct
import sys
import uuid

MAX_FRAME = 1024 * 1024
SCOPE = {"workspaceId": "fixture-workspace", "profileId": "fixture-profile"}
PROFILE = {"id": "fixture-profile", "name": "Synthetic Candidate", "revision": 0}
BRANCH = {"id": "fixture-general", "profileId": "fixture-profile", "revision": 0, "purpose": "general"}


def respond(request, epoch):
    rid = request.get("requestId")
    def error(code):
        return {"requestId": rid, "serviceEpoch": epoch, "error": {"code": code}}
    if set(request) != {"apiVersion", "requestId", "method", "scope", "expectedServiceEpoch", "payload"}:
        return error("INVALID_REQUEST")
    if type(request["apiVersion"]) is not int or request["apiVersion"] != 1:
        return error("UNSUPPORTED_VERSION")
    if not isinstance(rid, str) or not rid or not isinstance(request["payload"], dict):
        return error("INVALID_REQUEST")
    if request["scope"] != SCOPE:
        return error("FORBIDDEN")
    method, payload = request["method"], request["payload"]
    if method != "hello" and request["expectedServiceEpoch"] != epoch:
        return error("SERVICE_RESTARTED")
    if method == "hello" and payload == {}:
        result = {"apiVersion": 1, "serviceEpoch": epoch, "capabilities": ["fixture.read"]}
    elif method == "health" and payload == {}:
        result = {"state": "READY"}
    elif method == "profile.get" and payload == {}:
        result = PROFILE
    elif method == "branch.list" and payload == {}:
        result = [BRANCH]
    elif method == "branch.get" and set(payload) == {"branchId"}:
        if payload["branchId"] != BRANCH["id"]:
            return error("NOT_FOUND")
        result = BRANCH
    elif method == "operation.getStatus" and set(payload) == {"operationId"} and isinstance(payload["operationId"], str):
        result = {"status": "notFound"}
    else:
        return error("INVALID_REQUEST")
    return {"requestId": rid, "serviceEpoch": epoch, "result": result}


def read_frame(stream):
    header = stream.read(4)
    if not header:
        return None
    if len(header) != 4:
        raise ValueError("TRUNCATED_HEADER")
    size = struct.unpack(">I", header)[0]
    if size > MAX_FRAME:
        raise ValueError("FRAME_TOO_LARGE")
    body = stream.read(size)
    if len(body) != size:
        raise ValueError("TRUNCATED_FRAME")
    value = json.loads(body)
    if not isinstance(value, dict):
        raise ValueError("INVALID_ENVELOPE")
    return value


def write_frame(stream, value):
    body = json.dumps(value, separators=(",", ":")).encode()
    if len(body) > MAX_FRAME:
        raise ValueError("FRAME_TOO_LARGE")
    stream.write(struct.pack(">I", len(body)) + body)
    stream.flush()


if __name__ == "__main__":
    epoch = str(uuid.uuid4())
    while (request := read_frame(sys.stdin.buffer)) is not None:
        write_frame(sys.stdout.buffer, respond(request, epoch))

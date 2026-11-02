import io
import json
import struct
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fake_service import MAX_FRAME, SCOPE, read_frame, respond, write_frame


class ProtocolTests(unittest.TestCase):
    def request(self, method="health", payload=None):
        return dict(apiVersion=1, requestId="test-id", method=method, scope=SCOPE, expectedServiceEpoch="epoch", payload={} if payload is None else payload)

    def test_six_methods(self):
        for method, payload in [("health", {}), ("hello", {}), ("profile.get", {}), ("branch.list", {}), ("branch.get", {"branchId": "fixture-general"}), ("operation.getStatus", {"operationId": "fixture-op"})]:
            with self.subTest(method=method):
                response = respond(self.request(method, payload), "epoch")
                self.assertEqual(response["requestId"], "test-id")
                self.assertIn("result", response)

    def test_scope_version_epoch_and_unknown_keys(self):
        for key, value, code in [("scope", {**SCOPE, "profileId": "other"}, "FORBIDDEN"), ("apiVersion", 2, "UNSUPPORTED_VERSION"), ("apiVersion", True, "UNSUPPORTED_VERSION"), ("expectedServiceEpoch", "old", "SERVICE_RESTARTED"), ("confirmed", True, "INVALID_REQUEST")]:
            with self.subTest(key=key):
                request = self.request()
                request[key] = value
                self.assertEqual(respond(request, "epoch")["error"]["code"], code)

    def test_untrusted_confirmation_never_supported(self):
        # These prove read-only refusal, NOT validation of trusted receipts.
        for payload in [{"confirmed": True}, {"proposalHash": "wrong"}, {"profileId": "other"}, {"receipt": "replayed"}, {"revision": -1}, {"cancelled": True}]:
            with self.subTest(payload=payload):
                response = respond(self.request("proposal.confirm", payload), "epoch")
                self.assertEqual(response["error"]["code"], "INVALID_REQUEST")
                self.assertNotIn("result", response)

    def test_frames_and_bounds(self):
        stream = io.BytesIO()
        write_frame(stream, self.request())
        stream.seek(0)
        self.assertEqual(read_frame(stream), self.request())
        for frame in [b"\0", struct.pack(">I", MAX_FRAME + 1), struct.pack(">I", 10) + b"{}", struct.pack(">I", 2) + b"[]", struct.pack(">I", 1) + b"!"]:
            with self.subTest(frame=frame[:4]):
                with self.assertRaises(ValueError):
                    read_frame(io.BytesIO(frame))

    def test_real_child_eof_and_bad_frame_exit(self):
        script = str(Path(__file__).with_name("fake_service.py"))
        for frame, expected in [(b"", 0), (struct.pack(">I", MAX_FRAME + 1), 1)]:
            result = subprocess.run([sys.executable, script], input=frame, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, expected)
            if expected:
                self.assertIn(b"FRAME_TOO_LARGE", result.stderr)
                self.assertEqual(result.stdout, b"")


if __name__ == "__main__":
    unittest.main(verbosity=2)

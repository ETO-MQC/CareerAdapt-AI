"""Exercise the exact MCP projection block installed in the pinned source."""
import json
import sys
import textwrap
from pathlib import Path
from types import SimpleNamespace

source = (Path(sys.argv[1]) / "tools/mcp_tool.py").read_text(encoding="utf8")
start = source.index("            # Combine content + structuredContent")
end = source.index("\n        def _call_once", start)
body = textwrap.dedent(source[start:end])
namespace = {"json": json}
exec("def project(server_name, text_result, result):\n" + textwrap.indent(body, "    "), namespace)
project = namespace["project"]
primary = {"ok": True, "data": {"sourceTurnIds": ["turn-1"], "revision": 7, "ownership": "assisted", "confirmed": False},
           "receipt": {"operationId": "op-1"}, "diagnostics": {"boundary": "host"}}
secondary = json.loads(json.dumps(primary))
same = json.loads(project("careeradapt", json.dumps(primary), SimpleNamespace(structuredContent=secondary)))
assert "structuredContent" not in same
assert json.loads(same["result"]) == primary
secondary["diagnostics"] = {"boundary": "mcp", "responseSent": True}
compacted = json.loads(project("careeradapt", json.dumps(primary), SimpleNamespace(structuredContent=secondary)))
assert json.loads(compacted["result"]) == primary
assert compacted["structuredContent"] == {"diagnostics": secondary["diagnostics"]}
secondary["data"]["ownership"] = "lead"
different = json.loads(project("careeradapt", json.dumps(primary), SimpleNamespace(structuredContent=secondary)))
assert different["structuredContent"] == secondary
other = json.loads(project("other-server", json.dumps(primary), SimpleNamespace(structuredContent=primary)))
assert other["structuredContent"] == primary
invalid = json.loads(project("careeradapt", "not JSON", SimpleNamespace(structuredContent=primary)))
assert invalid["structuredContent"] == primary
print(json.dumps({"status": "PASS", "projectionCases": 5, "provenanceRevisionOwnershipConfirmationRetained": True}))

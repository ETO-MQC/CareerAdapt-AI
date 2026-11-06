"""Locked native registry/dispatcher integration; NOT Electron Host evidence."""
import json
import os
import pathlib
import sys

sys.path.insert(0, os.environ['D3_LOCKED_ROOT'])
from hermes_cli.plugins import discover_plugins
discover_plugins()
from model_tools import get_tool_definitions, handle_function_call
from tools.registry import registry
schemas = get_tool_definitions(enabled_toolsets=['career_d3'], quiet_mode=True)
assert {row['function']['name'] for row in schemas} == {'career.profile.get', 'career.profile.search_facts'}
for row in schemas:
    keys = set(row['function']['parameters']['properties'])
    assert not keys.intersection({'workspaceId', 'personId', 'profileId', 'sessionId', 'grantId', 'epoch', 'authority', 'confirmed'})

def invoke(tool, args, session, call):
    return json.loads(handle_function_call(tool, args, task_id='d3-native-task', session_id=session, turn_id='d3-native-turn-'+call, tool_call_id=call, enabled_tools=['career.profile.get', 'career.profile.search_facts'], enabled_toolsets=['career_d3']))

a = invoke('career.profile.get', {'sectionTypes': ['project']}, 'native-A', 'call-A')
b = invoke('career.profile.get', {}, 'native-B', 'call-B')
miss = invoke('career.profile.search_facts', {'query': 'NONEXISTENT_D3_KEYWORD'}, 'native-A', 'call-miss')
duplicate = invoke('career.profile.get', {'sectionTypes': ['project']}, 'native-A', 'call-A')
mutated = invoke('career.profile.get', {'limit': 1}, 'native-A', 'call-A')
invalid = invoke('career.profile.get', {'profileId': 'B'}, 'native-A', 'call-invalid')
assert a['ok'] and a['data']['profileId'] == 'A', a
assert b['ok'] and b['data']['profileId'] == 'B', b
assert miss['ok'] and not miss['data']['items'], miss
assert not duplicate['ok'] and duplicate['error']['code'] == 'UNKNOWN', duplicate
assert not mutated['ok'] and mutated['error']['code'] == 'OPERATION_CONFLICT', mutated
assert not invalid['ok'] and invalid['error']['code'] == 'INVALID_REQUEST', invalid
report = {'status': 'PASS_SYNTHETIC_NATIVE_REGISTRY_NOT_HOST', 'schemas': schemas, 'a': a, 'b': b, 'miss': miss, 'duplicate': duplicate, 'mutatedOriginalCall': mutated, 'invalid': invalid, 'handlerClosureCaptured': callable(registry.get_entry('career.profile.get').handler)}
pathlib.Path(os.environ['D3_REGISTRY_OUTPUT']).write_text(json.dumps(report, indent=2)+'\n', encoding='utf8')
print('D3_NATIVE_REGISTRY_PIPE_ADAPTER_PASS')

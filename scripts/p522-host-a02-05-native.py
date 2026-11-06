"""Deterministic native tool/SessionDB adapter qualification, no filesystem cleanup."""
import json
import os
import sys
import time
from pathlib import Path

project = Path.cwd()
native = Path(os.environ['LOCALAPPDATA']) / 'hermes/hermes-agent'
root = project / '.artifacts/p522-host-a02-05' / ('native-' + str(time.time_ns()))
root.mkdir(parents=True)
os.environ['HERMES_HOME'] = str(root / 'home')
os.environ['TERMINAL_CWD'] = str(root)
sys.path.insert(0, str(native))
from tools.file_tools import write_file_tool
from hermes_state import SessionDB

target = root / 'native-result.txt'
success = json.loads(write_file_tool(str(target), 'SYNTHETIC_NATIVE_ARTIFACT', task_id='artifact-qualification'))
assert not success.get('error'), success.get('error')
assert str(target) in success['files_modified']
assert target.read_text(encoding='utf-8') == 'SYNTHETIC_NATIVE_ARTIFACT'
updated = json.loads(write_file_tool(str(target), 'SYNTHETIC_NATIVE_UPDATED', task_id='artifact-qualification'))
assert not updated.get('error')
# Native structured-format validation must refuse malformed content before writing.
failed = json.loads(write_file_tool(str(root / 'invalid.json'), '{invalid JSON', task_id='artifact-qualification'))
assert failed.get('error')
db_path = root / 'fixture-state.db'
db = SessionDB(db_path)
db.create_session('synthetic-A', 'desktop')
db.create_session('synthetic-B', 'desktop')
user_id = db.append_message('synthetic-A', 'user', 'Synthetic explicit create')
tool_id = db.append_message('synthetic-A', 'tool', json.dumps(success), tool_call_id='synthetic-write')
db.append_message('synthetic-A', 'user', 'Synthetic update')
db.append_message('synthetic-A', 'tool', json.dumps(updated), tool_call_id='synthetic-update')
db.append_message('synthetic-A', 'user', 'Synthetic failure')
db.append_message('synthetic-A', 'tool', json.dumps(failed), tool_call_id='synthetic-failure')
db.close()
reopened = SessionDB(db_path, read_only=True)
messages = reopened.get_messages('synthetic-A')
assert messages[0]['id'] == user_id
assert messages[1]['id'] == tool_id
assert messages[1]['tool_call_id'] == 'synthetic-write'
assert json.loads(messages[-1]['content'])['error']
assert reopened.get_messages('synthetic-B') == []
reopened.close()
evidence = project / 'docs/architecture/evidence/p522-host-a02-05'
result = dict(status='PASS_L2_DETERMINISTIC_NATIVE_TOOL_AND_DB', realProvider=False,
              mockOnly='Synthetic session fixture through native SessionDB; not a generated Electron history',
              successfulNativeWrite=True, nativeUpdate=True, nativeFailure=True,
              stableDatabaseMessageIds=True, toolCallIdPreserved=True,
              sessionIsolation=True, failureRestoredAfterDbReopen=True,
              nativeTaskId=False, versionSnapshots=False, deletions=0)
(evidence / 'native-deterministic-verification.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
# Retain a local fixture for testing the projection against real native DB shapes.
(root / 'messages.json').write_text(json.dumps(messages, indent=2), encoding='utf-8')
print(json.dumps(result))

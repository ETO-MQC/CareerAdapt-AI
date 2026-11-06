"""Read-only disk proof for sessions created by the actual native Electron flow."""
import pathlib,json,sqlite3,hashlib,os
project=pathlib.Path.cwd();root=project/'.artifacts/p522-host-a02-04/run-1793898281301';out=project/'docs/architecture/evidence/p522-host-a02-04'
config=json.loads((project/'artifacts/p522-host-a02-01/provider.local.json').read_text(encoding='utf-8-sig'))
key=config['api_key']
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def clean(v):
 if isinstance(v,list):return [clean(x) for x in v]
 if isinstance(v,dict):return {k:clean(x) for k,x in v.items()}
 if isinstance(v,str):return v.replace(key,'[REDACTED]').replace(str(project),'[PROJECT]').replace(str(pathlib.Path.home()),'[USER]')
 return v
history=json.loads((out/'history-verification.json').read_text(encoding='utf8'));ids=[history['a']['after']['storedId'],history['b']['after']['storedId']]
db=root/'home/state.db';connection=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True);connection.row_factory=sqlite3.Row
rows=[dict(r) for r in connection.execute('SELECT id, session_id, role, content, timestamp, tool_name FROM messages WHERE session_id IN (?,?) ORDER BY id',ids)]
sessions=[dict(r) for r in connection.execute('SELECT id,title FROM sessions WHERE id IN (?,?)',ids)];connection.close()
assert len(sessions)==2
by={sid:[r for r in rows if r['session_id']==sid] for sid in ids}
assert 'SESSION_A_OK' in json.dumps(by[ids[0]]) and 'SESSION_B_OK' not in json.dumps(by[ids[0]])
assert 'SESSION_B_OK' in json.dumps(by[ids[1]]) and 'SESSION_A_OK' not in json.dumps(by[ids[1]])
assert all(r['timestamp'] is not None for r in rows)
staged=root/'workspace/.hermes/desktop-attachments/valid path.txt';original=root/'attachments/valid path.txt';moved=root/'attachments/valid path temporarily moved.txt'
assert staged.is_file() and sha(staged)==sha(original)
assert '@file:`.hermes/desktop-attachments/valid path.txt`' in json.dumps(by[ids[0]])
# Move only this explicitly named synthetic file, then restore it. No cleanup.
assert not moved.exists();os.rename(original,moved)
try:
 independent=(not original.exists()) and staged.is_file() and sha(staged)==sha(moved)
finally:os.rename(moved,original)
assert independent
result=dict(status='PASS_READ_ONLY_DISK',authority='Actual isolated native state.db, SQLite URI mode=ro; no SessionDB initialization or direct database writes',sessions=sessions,rows=rows,order='Monotonic AUTOINCREMENT id (native conversation reader ORDER BY id, not wall-clock timestamp)',staged=dict(exists=True,sha256=sha(staged),sameAsOriginal=True,readableAfterOriginalMoved=True),noCrossSessionContent=True,filesRetained=True,toolActivity='NOT_VERIFIED_NO_TOOL_ROWS')
(out/'disk-history-verification.json').write_text(json.dumps(clean(result),indent=2,ensure_ascii=False)+'\n',encoding='utf8')
print(json.dumps({'status':result['status'],'sessions':len(sessions),'messages':len(rows),'stagedReadableAfterOriginalMoved':independent}))

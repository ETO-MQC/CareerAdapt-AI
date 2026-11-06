"""Retained synthetic path fixtures, exact locked gateway resolver, no pytest cleanup."""
import os,sys,pathlib,json
project=pathlib.Path.cwd();host=pathlib.Path(os.environ['LOCALAPPDATA'])/'hermes/hermes-agent'
os.environ['HERMES_HOME']=str(project/'.artifacts/p522-host-a02-04/path-home')
sys.path.insert(0,str(host))
from tui_gateway.server import _resolve_gateway_attachment_path
root=project/'.artifacts/p522-host-a02-04/path-fixtures';root.mkdir(parents=True,exist_ok=True)
prefix=root/'prefix';prefix.write_text('WRONG PREFIX - NEVER ATTACH',encoding='utf8')
valid=root/'valid path.txt';valid.write_text('VALID PATH CONTENT',encoding='utf8')
missing=root/'prefix missing.txt'
a=_resolve_gateway_attachment_path('"'+str(valid)+'"')
b=_resolve_gateway_attachment_path('"'+str(missing)+'"')
c=_resolve_gateway_attachment_path(str(missing))
assert a==valid.resolve();assert b is None;assert prefix.exists()
out=project/'docs/architecture/evidence/p522-host-a02-04/path-resolution-verification.json'
out.write_text(json.dumps(dict(status='PASS_L2',level='Exact locked Python resolver; no upload/Provider',validQuotedMatches=True,missingQuotedRejected=True,prefixExists=True,originalUnquotedWrongPrefix=c==prefix.resolve(),electron='PENDING',filesRetained=True),indent=2)+'\n',encoding='utf8')
print('PASS quoted valid/missing/prefix resolver cases')

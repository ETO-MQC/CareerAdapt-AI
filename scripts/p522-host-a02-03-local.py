"""L0/L2 context audit using locked functions and synthetic fixtures only."""
import sys,os,pathlib,json,hashlib
project=pathlib.Path.cwd();host=pathlib.Path(os.environ['LOCALAPPDATA'])/'hermes/hermes-agent'
sys.path.insert(0,str(host));os.environ['HERMES_HOME']=str(project/'.artifacts/p522-host-a02-03/local-home')
from agent.context_references import preprocess_context_references
from agent.image_routing import decide_image_input_mode
fixture=project/'.artifacts/p522-host-a02-03/fixtures'
manifest=json.loads((fixture/'manifest.local.json').read_text(encoding='utf8'))
records=[]
for name,ref in [('txt','@file:sample.txt'),('pdf','@file:sample.pdf'),('empty','@file:empty.txt'),('unsupported','@file:unsupported.xyz'),('corrupt','@file:corrupt.png'),('folder','@folder:folder'),('empty-folder','@folder:empty-folder'),('missing-folder','@folder:missing'),('folder-is-file','@folder:sample.txt'),('missing-file','@file:missing.txt')]:
 r=preprocess_context_references('Inspect '+ref,cwd=fixture,context_length=100000)
 records.append(dict(name=name,expanded=r.expanded,warnings=r.warnings,message=r.message,blocked=r.blocked))
by={r['name']:r for r in records}
assert manifest['markers']['txt'] in by['txt']['message']
assert manifest['markers']['pdf'] not in by['pdf']['message'] and 'binary file' in by['pdf']['message']
assert 'inside.txt' in by['folder']['message'] and manifest['markers']['folder'] not in by['folder']['message']
assert by['missing-folder']['warnings'] and by['missing-file']['warnings']
def clean(v):
 if isinstance(v,list):return [clean(x) for x in v]
 if isinstance(v,dict):return {k:clean(x) for k,x in v.items()}
 if isinstance(v,str):return v.replace(str(host),'[HERMES_ROOT]').replace(str(project),'[PROJECT]').replace(str(pathlib.Path.home()),'[USER]')
 return v
out=project/'docs/architecture/evidence/p522-host-a02-03'
(out/'context-reference-local.json').write_text(json.dumps(clean(dict(status='PASS',level='MOCK_ONLY_L2_NATIVE_CONTEXT_NO_PROVIDER',records=records,inaccessibleDirectory='NOT_VERIFIED_NO_ACL_MUTATION',url='NOT_VERIFIED_EXTERNAL_FETCH_DISABLED')),indent=2)+'\n',encoding='utf8')
print(json.dumps({'contextCases':len(records),'assertions':'PASS'}))

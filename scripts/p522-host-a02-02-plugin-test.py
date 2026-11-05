import os, sys, json, tempfile, shutil, pathlib
host=pathlib.Path(os.environ['LOCALAPPDATA'])/'hermes/hermes-agent'
sys.path.insert(0,str(host))
home=pathlib.Path(tempfile.mkdtemp(prefix='a02-plugin-'))
os.environ['HERMES_HOME']=str(home)
(home/'config.yaml').write_text('plugins:\n  enabled: [a02_qualification_echo]\n',encoding='utf8')
shutil.copytree('tests/fixtures/p522-host-a02-02/a02_qualification_echo',home/'plugins/a02_qualification_echo')
from hermes_cli.plugins import discover_plugins, get_plugin_manager
discover_plugins()
from model_tools import get_tool_definitions, handle_function_call
from tools.registry import registry
schemas=get_tool_definitions(enabled_toolsets=['a02_qualification'],quiet_mode=True)
assert {x['function']['name'] for x in schemas} == {'a02_qualification_echo','a02_qualification_failure'}, schemas
from jsonschema import validate
for schema in schemas:
    validate({'value':'A02_SYNTHETIC'},schema['function']['parameters'])
result=registry.dispatch('a02_qualification_echo',{'value':'A02_SYNTHETIC'})
if isinstance(result,str): result=json.loads(result)
assert result=={'ok':True,'value':'A02_SYNTHETIC','checksum':'fixed-v1'},result
failed=registry.dispatch('a02_qualification_failure',{'value':'A02_SYNTHETIC'})
assert 'A02_DETERMINISTIC_FAILURE' in str(failed),failed
unauthorized=handle_function_call('a02_qualification_unauthorized',{},enabled_tools=['a02_qualification_echo','a02_qualification_failure'],enabled_toolsets=['a02_qualification'])
assert 'error' in json.loads(unauthorized),unauthorized
report={'status':'PASS','level':'MOCK_ONLY_L2_NATIVE_REGISTRY','schemas':schemas,'echo':result,'failure':failed,'unauthorized':unauthorized}
out=pathlib.Path('docs/architecture/evidence/p522-host-a02-02')
(out/'plugin-registration.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
(out/'tool-schema.json').write_text(json.dumps(schemas,indent=2)+'\n',encoding='utf8')
(out/'unauthorized-tool-verification.json').write_text(json.dumps({'status':'PASS','level':'MOCK_ONLY_L2','absentFromAllowedSchemas':True,'result':unauthorized},indent=2)+'\n',encoding='utf8')
print(json.dumps({'status':'PASS','checks':5}))

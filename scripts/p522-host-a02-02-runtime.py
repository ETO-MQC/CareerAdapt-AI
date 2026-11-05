"""L3 real Provider/native AIAgent diagnostic; explicitly NOT Electron qualification."""
import os, sys, json, pathlib, shutil, io, contextlib, time
project=pathlib.Path.cwd()
host=pathlib.Path(os.environ['LOCALAPPDATA'])/'hermes/hermes-agent'
config=json.loads((project/'artifacts/p522-host-a02-01/provider.local.json').read_text(encoding='utf-8-sig'))
root=project/'.artifacts/p522-host-a02-02'/('runtime-'+str(int(time.time()*1000)))
home=root/'home';home.mkdir(parents=True)
allowed={'PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMFILES','PROGRAMDATA','SYSTEMDRIVE','HOMEDRIVE','HOMEPATH','USERNAME','OS','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE'}
for key in list(os.environ):
    if key.upper() not in allowed: del os.environ[key]
os.environ.update(HERMES_HOME=str(home),HERMES_IGNORE_RULES='1',HERMES_TUI_TOOLSETS='a02_qualification',HERMES_DUMP_REQUESTS='1',PYTHONIOENCODING='utf-8')
(home/'config.yaml').write_text('model:\n  provider: custom\n  default: '+json.dumps(config['model'])+'\n  base_url: '+json.dumps(config['base_url'])+'\n  api_key: '+json.dumps(config['api_key'])+'\nplugins:\n  enabled: [a02_qualification_echo]\nagent:\n  api_max_retries: 1\n',encoding='utf8')
(home/'.env').write_text('',encoding='utf8')
shutil.copytree(project/'tests/fixtures/p522-host-a02-02/a02_qualification_echo',home/'plugins/a02_qualification_echo')
sys.path.insert(0,str(host))
out=project/'docs/architecture/evidence/p522-host-a02-02'
report={'level':'L3_REAL_PROVIDER_NATIVE_AIAgent_NOT_ELECTRON','status':'RUNNING','records':[]}
def save():
    text=json.dumps(report,indent=2,default=str)
    for value,replacement in [(config['api_key'],'[REDACTED]'),(str(host),'[HERMES_ROOT]'),(str(project),'[PROJECT]'),(str(pathlib.Path.home()),'[USER]')]:
        text=text.replace(json.dumps(value)[1:-1],replacement).replace(value,replacement)
    (out/'runtime-l3.json').write_text(text+'\n',encoding='utf8')
stream=io.StringIO()
try:
    with contextlib.redirect_stderr(stream),contextlib.redirect_stdout(stream):
        from run_agent import AIAgent
        from hermes_cli.plugins import discover_plugins
        discover_plugins()
        for name in ['a02_qualification_echo','a02_qualification_failure']:
            agent=AIAgent(model=config['model'],base_url=config['base_url'],api_key=config['api_key'],provider='custom',enabled_toolsets=['a02_qualification'],max_iterations=3,max_tokens=2048,quiet_mode=True,skip_context_files=True,skip_memory=True,load_soul_identity=False,session_id='a02-l3-'+name,reasoning_config={'enabled':False})
            result=agent.run_conversation('Call '+name+' exactly once with value A02_SYNTHETIC. Then report its actual result including checksum if present. Do not retry or use other tools.')
            report['records'].append({'tool':name,'result':result})
    report['status']='EXECUTED_REQUIRES_ASSERTION'
except Exception as error:
    report['status']='FAIL';report['error']=str(error)
finally:
    report['observations']=[]
    for line in stream.getvalue().splitlines():
        if line.startswith('A02_EVIDENCE '):
            report['observations'].append(json.loads(line[len('A02_EVIDENCE '):]))
    report['nativeRequestDumps']=[]
    for file in (home/'sessions').glob('request_dump_*.json'):
        dump=json.loads(file.read_text(encoding='utf8'))
        if isinstance(dump.get('request'),dict):dump['request'].pop('headers',None)
        report['nativeRequestDumps'].append(dump)
    save()
    (home/'config.yaml').write_text('# Qualification complete; credential cleared. File retained.\n',encoding='utf8')
    print(json.dumps({'status':report['status'],'turns':len(report['records']),'observations':len(report['observations'])}))

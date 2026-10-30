# Diagnostic only: anonymous isolated config, bounded timing wrappers, 35s hard stop.
# Never logs arguments, headers, environment values, credentials, or user content.
import os
import sys
import time
import json
import tempfile
import threading
import functools
from pathlib import Path
from urllib.parse import urlsplit

root = Path(os.environ.get('HERMES_RUNTIME_ROOT', Path.cwd()/'.electron-build/hermes-runtime-v4'))
os.environ['HERMES_HOME'] = tempfile.mkdtemp(prefix='careerad-p518-inventory-')
sys.path[:0] = [str(root/'source'), str(root/'site-packages')]
started = time.perf_counter()

def emit(**row):
    print(json.dumps(dict(atMs=round((time.perf_counter()-started)*1000, 2), **row)), flush=True)

def stop():
    emit(event='bounded_stop', budgetMs=35000)
    os._exit(2)

threading.Timer(35, stop).start()

def timed(module, name):
    original = getattr(module, name)
    @functools.wraps(original)
    def wrapped(*args, **kwargs):
        begin = time.perf_counter()
        emit(event='start', module=module.__name__, function=name)
        try:
            return original(*args, **kwargs)
        finally:
            emit(event='end', module=module.__name__, function=name, ms=round((time.perf_counter()-begin)*1000, 2))
    setattr(module, name, wrapped)

import hermes_cli.inventory as inventory
import hermes_cli.model_switch as model_switch
import hermes_cli.models as models
import hermes_cli.model_catalog as catalog
import hermes_cli.config as config
import agent.models_dev as models_dev
import hermes_cli.urllib_security as security
import requests
emit(event='imports_complete')
for module, names in [(inventory, ['load_picker_context', 'build_model_options_payload', 'build_models_payload', '_apply_pricing', '_apply_capabilities']), (model_switch, ['list_authenticated_providers']), (config, ['load_config']), (models_dev, ['fetch_models_dev']), (catalog, ['get_catalog']), (models, ['get_curated_nous_model_ids', 'fetch_ollama_cloud_models'])]:
    for name in names:
        timed(module, name)

original_send = requests.sessions.Session.send

def send(self, request, **kwargs):
    begin = time.perf_counter()
    host = urlsplit(request.url).hostname
    emit(event='http_start', host=host)
    try:
        response = original_send(self, request, **kwargs)
        emit(event='http_headers', host=host, status=response.status_code)
        return response
    finally:
        emit(event='http_return', host=host, ms=round((time.perf_counter()-begin)*1000, 2))

requests.sessions.Session.send = send
context = inventory.load_picker_context().with_overrides(current_provider='custom:careeradapt', current_model='p518-anonymous', current_base_url='http://127.0.0.1:1/v1')
payload = inventory.build_model_options_payload(context, include_unconfigured=True, refresh=False)
emit(event='complete', model=payload['model'], provider=payload['provider'], rows=len(payload['providers']))
os._exit(0)

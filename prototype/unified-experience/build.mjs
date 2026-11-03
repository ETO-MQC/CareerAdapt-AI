import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const desktop = path.join(process.env.HERMES_SOURCE_DIR || path.join(process.env.LOCALAPPDATA, 'hermes/hermes-agent'), 'apps/desktop');
const { build } = createRequire(path.join(desktop, 'package.json'))('esbuild');
const outdir = path.resolve('.artifacts/p521-prototype');
fs.mkdirSync(outdir, { recursive: true });
const result = await build({ entryPoints: ['prototype/unified-experience/main.tsx'], outdir, bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', target: 'es2022', metafile: true, loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' } });
// Existing Profile CSS is embedded by its React component; the prototype imports its own CSS as text too.
fs.writeFileSync(path.join(outdir, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CareerAdapt · Unified Experience Prototype</title><div id="root"></div><script type="module" src="/main.js"></script></html>');
fs.writeFileSync(path.join(outdir, 'metafile.json'), JSON.stringify(result.metafile, null, 2));
console.log('Prototype built: ' + outdir);

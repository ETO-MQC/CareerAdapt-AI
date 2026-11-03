import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('.artifacts/p522-ux01-prototype');
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/main.js': ['main.js', 'text/javascript; charset=utf-8'] };
http.createServer((req, res) => {
  const entry = files[new URL(req.url, 'http://127.0.0.1').pathname];
  if (!entry) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; font-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'" });
  res.end(fs.readFileSync(path.join(root, entry[0])));
}).listen(5183, '127.0.0.1', () => console.log('Prototype: http://127.0.0.1:5183'));


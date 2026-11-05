// Bundles dist/ into a single Cloudflare Worker module and writes deploy/deploy-code.js
// (an async arrow function for the Cloudflare connector's `execute` tool, or run via API).
import fs from 'node:fs'
import path from 'node:path'
const DIST = 'dist'
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8' }
const BIN = new Set(['.png', '.ico', '.woff2', '.wasm'])
const files = {}
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : add(p) } }
function add(p) {
  const url = '/' + path.relative(DIST, p).split(path.sep).join('/')
  const ext = path.extname(p)
  const buf = fs.readFileSync(p)
  const hashed = url.startsWith('/assets/')
  files[url] = {
    t: TYPES[ext] || 'application/octet-stream',
    bin: BIN.has(ext) || !TYPES[ext],
    d: BIN.has(ext) || !TYPES[ext] ? buf.toString('base64') : buf.toString('utf8'),
    c: hashed ? 'public, max-age=31536000, immutable' : (url === '/sw.js' || url === '/index.html' || url.startsWith('/workbox-') || url === '/manifest.webmanifest') ? 'no-cache' : 'public, max-age=3600',
  }
}
walk(DIST)
const captionsSrc = fs.readFileSync('worker/captions.js', 'utf8').replace(/^export /gm, '')
const worker = captionsSrc + `\nconst FILES = ${JSON.stringify(files)};
const cache = new Map();
function body(p) {
  const f = FILES[p];
  if (!f.bin) return f.d;
  if (!cache.has(p)) { const s = atob(f.d); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); cache.set(p, u); }
  return cache.get(p);
}
export default {
  async fetch(req, env) {
    if (req.method !== 'GET' && req.method !== 'HEAD' && new URL(req.url).pathname !== '/api/captions') return new Response('Method Not Allowed', { status: 405 });
    let p = new URL(req.url).pathname;
    if (p === '/api/captions') return req.method === 'GET' ? handleCaptions(req, env) : new Response('Method Not Allowed', { status: 405 });
    if (p === '/') p = '/index.html';
    let status = 200;
    if (!FILES[p]) {
      if (/\\.[a-z0-9]+$/i.test(p)) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      p = '/index.html'; // SPA fallback
    }
    const f = FILES[p];
    const h = { 'content-type': f.t, 'cache-control': f.c, 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-robots-tag': 'noindex, nofollow' };
    if (p === '/sw.js') h['service-worker-allowed'] = '/';
    return new Response(req.method === 'HEAD' ? null : body(p), { status, headers: h });
  },
};
`
fs.writeFileSync('deploy/worker.js', worker)
const code = `async () => {
const SRC = ${JSON.stringify(worker)};
const form = new FormData();
form.append('metadata', new Blob([JSON.stringify({ main_module: 'worker.js', compatibility_date: '2026-01-01', bindings: [{ type: 'ai', name: 'AI' }] })], { type: 'application/json' }));
form.append('worker.js', new Blob([SRC], { type: 'application/javascript+module' }), 'worker.js');
const put = await cloudflare.request({ method: 'PUT', path: \`/accounts/\${accountId}/workers/scripts/lingotube\`, body: form });
return { success: put.success, errors: put.errors, id: put.result && put.result.id, size: SRC.length };
}`
fs.writeFileSync('deploy/deploy-code.js', code)
console.log(Object.keys(files).length, 'files;', worker.length, 'bytes')

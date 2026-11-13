// Bundles dist/ into a single Cloudflare Worker module and writes deploy/deploy-code.js
// (an async arrow function for the Cloudflare connector's `execute` tool, or run via API).
import fs from 'node:fs'
import path from 'node:path'

function loadEnvFile(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!m || m[1] in process.env) continue
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      process.env[m[1]] = v
    }
  } catch { /* no .env is fine */ }
}
loadEnvFile(path.resolve('.env'))

const DIST = 'dist'
const WORKER_NAME = process.env.LINGOTUBE_WORKER_NAME || 'lingotube'
const D1_DATABASE_ID = process.env.LINGOTUBE_D1_DATABASE_ID || ''
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
const limitsSrc = fs.readFileSync('worker/limits.js', 'utf8').replace(/^export /gm, '')
const captionsSrc = fs.readFileSync('worker/captions.js', 'utf8').replace(/^export /gm, '')
const aiSrc = fs.readFileSync('worker/ai.js', 'utf8').replace(/^export /gm, '')
const ttsSrc = fs.readFileSync('worker/tts.js', 'utf8').replace(/^export /gm, '')
const sttSrc = fs.readFileSync('worker/stt.js', 'utf8').replace(/^export /gm, '')
const syncSrc = fs.readFileSync('worker/sync.js', 'utf8').replace(/^export /gm, '')
const worker = limitsSrc + '\n' + captionsSrc + '\n' + aiSrc + '\n' + ttsSrc + '\n' + sttSrc + '\n' + syncSrc + `\nconst FILES = ${JSON.stringify(files)};
const cache = new Map();
function body(p) {
  const f = FILES[p];
  if (!f.bin) return f.d;
  if (!cache.has(p)) { const s = atob(f.d); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); cache.set(p, u); }
  return cache.get(p);
}
export default {
  async fetch(req, env) {
    const p = new URL(req.url).pathname;
    const isApiRoute = p === '/api/captions' || p === '/api/ai' || p === '/api/tts' || p === '/api/stt' || p === '/api/sync' || p.startsWith('/api/sync/');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    if (p === '/api/captions') return req.method === 'GET' ? handleCaptions(req, env) : new Response('Method Not Allowed', { status: 405 });
    if (p === '/api/ai') return handleAI(req, env);
    if (p === '/api/tts') return handleTTS(req, env);
    if (p === '/api/stt') return handleSTT(req, env);
    if (p === '/api/sync' || p.startsWith('/api/sync/')) return handleSync(req, env);
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });
    let fp = p === '/' ? '/index.html' : p;
    let status = 200;
    if (!FILES[fp]) {
      if (/\\.[a-z0-9]+$/i.test(fp)) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      fp = '/index.html'; // SPA fallback
    }
    const f = FILES[fp];
    const h = { 'content-type': f.t, 'cache-control': f.c, 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-robots-tag': 'noindex, nofollow' };
    if (fp === '/sw.js') h['service-worker-allowed'] = '/';
    return new Response(req.method === 'HEAD' ? null : body(fp), { status, headers: h });
  },
};
`
fs.writeFileSync('deploy/worker.js', worker)
if (!D1_DATABASE_ID) {
  console.warn('LINGOTUBE_D1_DATABASE_ID is not set. deploy/deploy-code.js will use a placeholder; set it in .env (see .env.example) before deploying with the API helper.')
}
const d1Id = D1_DATABASE_ID || 'YOUR_D1_DATABASE_ID'
const limitBindings = [
  { type: 'plain_text', name: 'STRUCTURE_70B_DAILY_CAP', text: process.env.STRUCTURE_70B_DAILY_CAP || '20' },
  { type: 'plain_text', name: 'AI_IP_LIMIT', text: process.env.AI_IP_LIMIT || '10' },
  { type: 'plain_text', name: 'STT_IP_LIMIT', text: process.env.STT_IP_LIMIT || '10' },
  { type: 'plain_text', name: 'TTS_IP_LIMIT', text: process.env.TTS_IP_LIMIT || '60' },
]
const code = `async () => {
const SRC = ${JSON.stringify(worker)};
const form = new FormData();
form.append('metadata', new Blob([JSON.stringify({ main_module: 'worker.js', compatibility_date: '2026-01-01', bindings: [{ type: 'ai', name: 'AI' }, { type: 'd1', name: 'SYNC_DB', database_id: ${JSON.stringify(d1Id)} }, ...${JSON.stringify(limitBindings)}] })], { type: 'application/json' }));
form.append('worker.js', new Blob([SRC], { type: 'application/javascript+module' }), 'worker.js');
const put = await cloudflare.request({ method: 'PUT', path: \`/accounts/\${accountId}/workers/scripts/${WORKER_NAME}\`, body: form });
return { success: put.success, errors: put.errors, id: put.result && put.result.id, size: SRC.length };
}`
fs.writeFileSync('deploy/deploy-code.js', code)
console.log(Object.keys(files).length, 'files;', worker.length, 'bytes')

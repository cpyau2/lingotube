#!/usr/bin/env node
// Tiny optional local helper: GET /captions?v=<youtubeId>  ->  { title, en: [...], zh: [...] }
// Browsers can't read YouTube captions (CORS), so this runs on YOUR computer and uses yt-dlp
// (https://github.com/yt-dlp/yt-dlp, must be on PATH). It listens on localhost only.
import http from 'node:http'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = Number(process.env.PORT || 8787)
const run = (cmd, args, opts = {}) => new Promise((res, rej) => execFile(cmd, args, { maxBuffer: 1 << 26, ...opts }, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so))))

function ts(s) { const m = s.trim().replace(',', '.').match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/); return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN }
function parse(raw) {
  const out = []
  for (const b of raw.replace(/\r/g, '').split(/\n{2,}/)) {
    const L = b.split('\n'); const i = L.findIndex((l) => l.includes('-->')); if (i < 0) continue
    const [a, r] = L[i].split('-->'); const start = ts(a), end = ts(r.trim().split(/\s+/)[0])
    const text = L.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (!text || isNaN(start) || /^(Translator|Reviewer):/.test(text)) continue
    const p = out.at(-1); if (p && p.text === text && start - p.end < 0.3) { p.end = end; continue }
    out.push({ start, end, text })
  }
  return out
}

async function captions(id) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lingotube-'))
  try {
    const url = `https://www.youtube.com/watch?v=${id}`
    // one yt-dlp call (fewer requests => fewer 429s): title + manual subs + auto captions fallback
    await run('yt-dlp', ['--skip-download', '--print-to-file', '%(title)s', path.join(dir, 'title.txt'), '--write-subs', '--write-auto-subs', '--sub-langs', 'en.*,zh-Hant,zh-TW,zh-HK,zh-Hans,zh', '--sub-format', 'vtt', ...(process.env.YT_COOKIES_FROM_BROWSER ? ['--cookies-from-browser', process.env.YT_COOKIES_FROM_BROWSER] : []), '-o', path.join(dir, '%(id)s'), url])
      .catch((e) => { if (!String(e.message).includes('.vtt')) throw new Error(String(e.message).split('\n').filter((l) => /ERROR|429/.test(l)).join(' ').slice(0, 250) || e.message.slice(0, 250)) })
    const files = await readdir(dir)
    const title = (await readFile(path.join(dir, 'title.txt'), 'utf8').catch(() => '')).trim() || id
    const pick = (re) => files.find((f) => re.test(f))
    const enF = pick(/\.en\.vtt$/) || pick(/\.en[-\w]*\.vtt$/)
    const zhF = pick(/\.zh-(Hant|TW|HK)\.vtt$/) || pick(/\.zh[-\w]*\.vtt$/)
    if (!enF) throw new Error('這部影片找不到英文字幕')
    return { title, en: parse(await readFile(path.join(dir, enF), 'utf8')), zh: zhF ? parse(await readFile(path.join(dir, zhF), 'utf8')) : [] }
  } finally { await rm(dir, { recursive: true, force: true }) }
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  if (u.pathname === '/captions') {
    const id = u.searchParams.get('v') || ''
    if (!/^[\w-]{11}$/.test(id)) { res.writeHead(400); return res.end('bad video id') }
    try { const j = await captions(id); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)) }
    catch (e) { res.writeHead(500); res.end(String(e.message).slice(0, 300)) }
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('LingoTube captions proxy OK')
}).listen(PORT, '127.0.0.1', () => console.log(`captions proxy on http://localhost:${PORT}`))

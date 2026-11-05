// LingoTube captions endpoint (runs inside the Cloudflare Worker, same origin as the app).
// GET /api/captions?v=<11-char id>  ->  { id, title, en:[{start,end,text}], zh:[{start,end,text}], enSource, zhSource, note? }
// yt-dlp / browser cookies can't run in a Worker (no subprocess), so this re-implements the useful parts in JS:
// InnerTube player call (several clients) -> captionTracks -> json3 -> cues, with watch-page scraping as fallback.

const CLIENTS = [
  { name: 'ANDROID', ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip', id: 3, ctx: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, osName: 'Android', osVersion: '11', hl: 'en', gl: 'US' } },
  { name: 'IOS', ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)', id: 5, ctx: { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82', hl: 'en', gl: 'US' } },
  { name: 'ANDROID_VR', ua: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip', id: 28, ctx: { clientName: 'ANDROID_VR', clientVersion: '1.60.19', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L', hl: 'en', gl: 'US' } },
  { name: 'TVHTML5_EMBED', ua: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version', id: 85, ctx: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'en', gl: 'US' }, embed: true },
]
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export class CapError extends Error {
  constructor(code, message, status = 502, detail) { super(message); this.code = code; this.status = status; this.detail = detail }
}

const MSG = {
  bad_id: '影片 ID 唔正確（要 11 個字元）',
  no_en: '這部影片找不到英文字幕',
  blocked: 'YouTube 暫時封鎖咗自動抓字幕，請遲啲再試或者匯入字幕檔',
  unavailable: '呢條片未能播放（私人／已刪除／地區限制），抓唔到字幕',
  no_captions: '這部影片找不到英文字幕',
  failed: '抓字幕失敗，請遲啲再試或者匯入字幕檔',
}

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } })

async function getPlayer(id, log) {
  let lastBlocked = false, unavailable = false
  for (const c of CLIENTS) {
    try {
      const body = { videoId: id, contentCheckOk: true, racyCheckOk: true, context: { client: c.ctx } }
      if (c.embed) { body.playbackContext = { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } }; body.context.thirdParty = { embedUrl: 'https://www.youtube.com/' } }
      const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': c.ua, 'x-youtube-client-name': String(c.id), 'x-youtube-client-version': c.ctx.clientVersion, origin: 'https://www.youtube.com' },
        body: JSON.stringify(body),
      })
      if (r.status === 429) { log.push(`${c.name}: HTTP 429`); lastBlocked = true; continue }
      const j = await r.json()
      const st = j.playabilityStatus?.status
      const tracks = j.captions?.playerCaptionsTracklistRenderer?.captionTracks
      log.push(`${c.name}: ${st}${j.playabilityStatus?.reason ? ' (' + j.playabilityStatus.reason + ')' : ''}, tracks=${tracks?.length ?? 0}`)
      if (st === 'OK' && tracks?.length) return { title: j.videoDetails?.title || id, tracks, ua: c.ua }
      if (st === 'OK' && j.videoDetails) { // playable but no captions: remember, maybe another client sees them
        unavailable = false; var noCaps = { title: j.videoDetails.title || id, tracks: [], ua: c.ua }
      }
      if (st === 'LOGIN_REQUIRED' || /bot|sign in/i.test(j.playabilityStatus?.reason || '')) lastBlocked = true
      if (st === 'UNPLAYABLE' || st === 'ERROR') unavailable = true
    } catch (e) { log.push(`${c.name}: ${e.message}`) }
  }
  // fallback: scrape the watch page
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en&bpctr=9999999999&has_verified=1`, { headers: { 'user-agent': BROWSER_UA, 'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=YES+1; SOCS=CAI' } })
    const html = await r.text()
    const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script>)/s)
    if (m) {
      const j = JSON.parse(m[1])
      const tracks = j.captions?.playerCaptionsTracklistRenderer?.captionTracks
      log.push(`WATCHPAGE: ${j.playabilityStatus?.status}, tracks=${tracks?.length ?? 0}`)
      if (tracks?.length) return { title: j.videoDetails?.title || id, tracks, ua: BROWSER_UA }
      if (j.videoDetails && !noCaps) noCaps = { title: j.videoDetails.title, tracks: [], ua: BROWSER_UA }
      if (/bot|sign in/i.test(j.playabilityStatus?.reason || '')) lastBlocked = true
    } else log.push(`WATCHPAGE: no player response (HTTP ${r.status}, ${/consent|captcha|unusual traffic/i.test(html) ? 'consent/captcha page' : 'unknown page'})`)
  } catch (e) { log.push(`WATCHPAGE: ${e.message}`) }
  if (typeof noCaps !== 'undefined') return noCaps
  if (lastBlocked) throw new CapError('blocked', MSG.blocked, 503, log)
  if (unavailable) throw new CapError('unavailable', MSG.unavailable, 404, log)
  throw new CapError('failed', MSG.failed, 502, log)
}

const isZhHant = (l) => /^zh-(Hant|TW|HK|MO)|^yue/i.test(l)
const isZhHans = (l) => /^zh(-(Hans|CN|SG))?$/i.test(l)
const isEn = (l) => /^en(-|$)/i.test(l)

function pickEnglish(tracks) {
  const en = tracks.filter((t) => isEn(t.languageCode))
  return en.find((t) => t.kind !== 'asr') || en.find((t) => t.kind === 'asr') || null
}
function pickZh(tracks) {
  const z = tracks.filter((t) => /^(zh|yue)/i.test(t.languageCode) && t.kind !== 'asr')
  return { hant: z.find((t) => isZhHant(t.languageCode)) || null, hans: z.find((t) => isZhHans(t.languageCode)) || null }
}

async function fetchTrack(baseUrl, ua, extra = '') {
  const u = baseUrl.replace(/&fmt=[^&]*/, '') + '&fmt=json3' + extra
  const r = await fetch(u, { headers: { 'user-agent': ua, 'accept-language': 'en-US,en;q=0.9' } })
  if (r.status === 429) throw new CapError('blocked', MSG.blocked, 503, `timedtext HTTP 429`)
  if (!r.ok) throw new CapError('failed', MSG.failed, 502, `timedtext HTTP ${r.status}`)
  const t = await r.text()
  if (!t.trim().startsWith('{')) {
    if (/Sorry|unusual traffic/i.test(t)) throw new CapError('blocked', MSG.blocked, 503, 'timedtext captcha page')
    if (!t.trim()) throw new CapError('failed', MSG.failed, 502, 'timedtext empty body')
    throw new CapError('failed', MSG.failed, 502, 'timedtext non-JSON: ' + t.slice(0, 80))
  }
  return JSON.parse(t)
}

const clean = (s) => s.replace(/\u200b/g, '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim()

/** json3 -> cues. Handles manual captions and rolling auto-captions (asr). */
export function json3ToCues(j, asr) {
  const raw = []
  for (const e of j.events || []) {
    if (!e.segs || e.aAppend) continue
    const text = clean(e.segs.map((s) => s.utf8 || '').join(''))
    if (!text || /^(Translator|Reviewer):/i.test(text)) continue
    raw.push({ start: e.tStartMs / 1000, end: (e.tStartMs + (e.dDurationMs || 2000)) / 1000, text })
  }
  raw.sort((a, b) => a.start - b.start)
  // clip overlaps (rolling captions) so each line ends when the next begins
  for (let i = 0; i < raw.length - 1; i++) if (raw[i].end > raw[i + 1].start) raw[i].end = Math.max(raw[i].start + 0.3, raw[i + 1].start)
  let cues = asr ? asrToSentences(j) : raw
  // dedupe consecutive repeats
  const out = []
  for (const c of cues) {
    const p = out[out.length - 1]
    if (p && p.text === c.text && c.start - p.end < 0.5) { p.end = Math.max(p.end, c.end); continue }
    out.push({ start: +c.start.toFixed(2), end: +c.end.toFixed(2), text: c.text })
  }
  return out
}

/** Auto-captions: rebuild sentences from word timings (segs[].tOffsetMs) instead of rolling 2-line windows. */
function asrToSentences(j) {
  const words = []
  for (const e of j.events || []) {
    if (!e.segs || e.aAppend) continue
    for (const sg of e.segs) {
      const w = (sg.utf8 || '').replace(/\s+/g, ' ').trim()
      if (!w) continue
      words.push({ t: (e.tStartMs + (sg.tOffsetMs || 0)) / 1000, w, evEnd: (e.tStartMs + (e.dDurationMs || 2000)) / 1000 })
    }
  }
  words.sort((a, b) => a.t - b.t)
  const out = []
  let cur = []
  const flush = () => {
    if (!cur.length) return
    const last = cur[cur.length - 1]
    out.push({ start: cur[0].t, end: Math.min(last.evEnd, last.t + 1.2), text: cur.map((x) => x.w).join(' ') })
    cur = []
  }
  for (const w of words) {
    cur.push(w)
    const len = cur.reduce((n, x) => n + x.w.length + 1, 0)
    const dur = w.t - cur[0].t
    if ((/[.?!]["')\]]?$/.test(w.w) && len >= 24) || len >= 120 || (len >= 70 && /,$/.test(w.w)) || dur >= 10) flush()
  }
  flush()
  // end each sentence when the next starts if there is only a small gap
  for (let i = 0; i < out.length - 1; i++) if (out[i + 1].start - out[i].end < 1.5) out[i].end = out[i + 1].start
  return out
}

function stripTags(s) { return s.replace(/<[^>]+>/g, '') }

async function googleTranslate(lines, log) {
  // public gtx endpoint, batched (a Worker has a small subrequest budget)
  const out = new Array(lines.length).fill('')
  const batches = []
  let cur = [], len = 0
  lines.forEach((t, i) => { if (len + t.length > 3500 && cur.length) { batches.push(cur); cur = []; len = 0 } cur.push(i); len += t.length + 1 })
  if (cur.length) batches.push(cur)
  if (batches.length > 25) throw new CapError('failed', MSG.failed, 502, 'too many cues to machine-translate')
  for (const b of batches) {
    const q = b.map((i) => lines[i].replace(/\n/g, ' ')).join('\n')
    const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': BROWSER_UA }, body: 'q=' + encodeURIComponent(q),
    })
    if (!r.ok) { log.push(`gtx: HTTP ${r.status}`); throw new CapError('blocked', MSG.blocked, 503, `gtx HTTP ${r.status}`) }
    const j = await r.json()
    const joined = (j[0] || []).map((x) => x[0] || '').join('')
    const parts = joined.split('\n')
    if (parts.length === b.length) b.forEach((i, k) => (out[i] = parts[k].trim()))
    else { log.push(`gtx: line count mismatch ${parts.length}/${b.length}`); b.forEach((i, k) => (out[i] = parts[k]?.trim() || '')) }
  }
  return out
}

const AI_MODELS = ['@cf/qwen/qwen3-30b-a3b-fp8', '@cf/meta/llama-3.1-8b-instruct-fast']

function aiText(r) {
  if (!r) return ''
  if (typeof r === 'string') return r
  if (r.choices && r.choices[0]) { const m = r.choices[0].message || {}; return m.content || r.choices[0].text || '' }
  return r.response || ''
}

async function aiTranslate(env, lines, log) {
  // Cloudflare Workers AI (LLM), batched: every AI call counts as a subrequest, and a Worker only gets ~50.
  const out = new Array(lines.length).fill('')
  const batches = []
  let cur = [], len = 0
  lines.forEach((t, i) => { if ((len + t.length > 1800 || cur.length >= 30) && cur.length) { batches.push(cur); cur = []; len = 0 } cur.push(i); len += t.length + 6; })
  if (cur.length) batches.push(cur)
  if (batches.length > 30) throw new CapError('failed', MSG.failed, 502, 'too many cues for AI translation')
  let model = 0, fails = 0, next = 0
  const run = async (b) => {
    const user = '/no_think\n' + b.map((i, k) => `${k + 1}|${lines[i].replace(/\s+/g, ' ')}`).join('\n')
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await env.AI.run(AI_MODELS[Math.min(model, AI_MODELS.length - 1)], {
          messages: [
            { role: 'system', content: 'You translate English video subtitles into Traditional Chinese (繁體中文, natural spoken Taiwan/Hong Kong wording). Input lines look like "N|English". Reply with exactly the same number of lines, each "N|中文". No explanations, no extra text.' },
            { role: 'user', content: user },
          ],
          max_tokens: 2048, temperature: 0.2,
        })
        const txt = aiText(r).replace(/<think>[\s\S]*?<\/think>/g, '')
        let got = 0
        for (const line of txt.split('\n')) {
          const m = line.match(/^\s*(\d+)\s*[|｜]\s*(.+)$/)
          if (m && b[Number(m[1]) - 1] !== undefined && !out[b[Number(m[1]) - 1]]) { out[b[Number(m[1]) - 1]] = m[2].trim(); got++ }
        }
        if (got >= b.length * 0.6) return
        log.push(`ai: parsed ${got}/${b.length}`)
      } catch (e) { log.push('ai: ' + String(e && e.message).slice(0, 100)); if (model < AI_MODELS.length - 1) model++ }
    }
    fails++
  }
  const worker = async () => { while (next < batches.length && fails < 4) await run(batches[next++]) }
  await Promise.all(Array.from({ length: 4 }, worker))
  if (!out.some(Boolean)) throw new CapError('failed', MSG.failed, 502, 'workers-ai failed')
  return out
}

export async function fetchCaptions(id, env) {
  const log = []
  const { title, tracks, ua } = await getPlayer(id, log)
  const enT = pickEnglish(tracks)
  if (!enT) throw new CapError('no_en', MSG.no_en, 404, log)
  const asr = enT.kind === 'asr'
  const enJ = await fetchTrack(enT.baseUrl, ua)
  const en = json3ToCues(enJ, asr)
  if (!en.length) throw new CapError('no_en', MSG.no_en, 404, log)

  let zh = [], zhSource = 'none'
  const { hant, hans } = pickZh(tracks)
  const tryTrack = async (t, src) => { const c = json3ToCues(await fetchTrack(t.baseUrl, ua), false); if (c.length) { zh = c; zhSource = src; return true } return false }
  try {
    if (hant && (await tryTrack(hant, 'track:zh-Hant'))) { /* done */ }
    else if (hans && (await tryTrack(hans, 'track:zh-Hans'))) { /* done */ }
  } catch (e) { log.push('zh track: ' + (e.detail || e.message)) }
  if (!zh.length && enT.isTranslatable !== false) {
    try {
      const c = json3ToCues(await fetchTrack(enT.baseUrl, ua, '&tlang=zh-Hant'), false)
      if (c.length) { zh = c; zhSource = 'youtube-mt:zh-Hant' }
    } catch (e) { log.push('tlang: ' + (e.detail || e.message)) }
  }
  if (!zh.length && env && env.AI && en.length <= 800) {
    try {
      const t = await aiTranslate(env, en.map((c) => c.text), log)
      zh = en.map((c, i) => ({ start: c.start, end: c.end, text: t[i] })).filter((c) => c.text)
      if (zh.length) zhSource = 'workers-ai:zh-Hant'
    } catch (e) { log.push('workers-ai: ' + (e.detail || e.message)) }
  }
  if (!zh.length) {
    try {
      const t = await googleTranslate(en.map((c) => c.text), log)
      zh = en.map((c, i) => ({ start: c.start, end: c.end, text: t[i] })).filter((c) => c.text)
      if (zh.length) zhSource = 'google-translate:zh-TW'
    } catch (e) { log.push('gtx: ' + (e.detail || e.message)) }
  }
  return { id, title, en, zh, enSource: asr ? 'auto-captions' : 'manual', zhSource, note: zh.length ? undefined : '未能取得中文翻譯，只顯示英文', debug: log }
}

export async function handleCaptions(request, env) {
  const url = new URL(request.url)
  const id = url.searchParams.get('v') || ''
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return json({ error: MSG.bad_id, code: 'bad_id' }, 400)
  const cacheKey = new Request(`https://lingotube.cache/captions/${id}`)
  let cache = null
  try { cache = caches.default; const hit = await cache.match(cacheKey); if (hit && !url.searchParams.has('fresh')) return new Response(hit.body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-lingotube-cache': 'HIT' } }) } catch { /* cache unavailable */ }
  try {
    const data = await fetchCaptions(id, env)
    const body = JSON.stringify(data)
    if (cache && data.zh.length) { try { await cache.put(cacheKey, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' } })) } catch { /* ignore */ } }
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-lingotube-cache': 'MISS' } })
  } catch (e) {
    if (e instanceof CapError) return json({ error: e.message, code: e.code, debug: e.detail }, e.status)
    return json({ error: MSG.failed, code: 'failed', debug: String(e && e.message) }, 502)
  }
}

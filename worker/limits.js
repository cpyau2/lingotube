// Usage limits for the public demo: a daily cap on 70B 句型拆解 calls,
// plus per-IP rate limits on /api/ai, /api/stt and /api/tts.
// IPs are hashed with SHA-256 before storage. BYOK (OpenAI-compatible)
// calls never hit these routes, so they are not limited here.

const DEFAULT_STRUCTURE_70B_DAILY_CAP = 20
const DEFAULT_AI_IP_LIMIT = 10
const DEFAULT_STT_IP_LIMIT = 10
const DEFAULT_TTS_IP_LIMIT = 60
const IP_WINDOW_MS = 10 * 60 * 1000
const USAGE_KEY_70B = 'structure_70b'

const MSG_IP_LIMIT = '請求太密，請稍後再試。示範站對同一網絡設有使用上限，以免共用 AI 額度被用完。'

function envInt(env, name, fallback) {
  const n = Number(env?.[name])
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

async function hashIp(ip) {
  const data = new TextEncoder().encode(String(ip || 'unknown'))
  const buf = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(buf)
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

function clientIp(req) {
  return req.headers.get('CF-Connecting-IP') || req.headers.get('CF-Connecting-IPv6') || 'unknown'
}

function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10)
}

function windowStart(now = Date.now(), windowMs = IP_WINDOW_MS) {
  return Math.floor(now / windowMs) * windowMs
}

function rateLimitedResponse(message, retryAfterSec) {
  return new Response(JSON.stringify({ error: message, code: 'rate_limited' }), {
    status: 429,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'retry-after': String(Math.max(1, retryAfterSec || 60)),
    },
  })
}

/** Reserve one 70B 句型拆解 slot for the current UTC day. Returns false if the cap is reached or D1 is unavailable. */
async function tryReserveStructure70b(env, now = Date.now()) {
  const cap = envInt(env, 'STRUCTURE_70B_DAILY_CAP', DEFAULT_STRUCTURE_70B_DAILY_CAP)
  if (cap <= 0) return false
  const db = env?.SYNC_DB
  if (!db) return false
  const day = utcDay(now)
  try {
    await db.prepare(
      `INSERT OR IGNORE INTO usage_daily (key, day, count) VALUES (?, ?, 0)`,
    ).bind(USAGE_KEY_70B, day).run()
    const row = await db.prepare(
      `UPDATE usage_daily SET count = count + 1 WHERE key = ? AND day = ? AND count < ? RETURNING count`,
    ).bind(USAGE_KEY_70B, day, cap).first()
    return !!row
  } catch (e) {
    console.error('70B cap check failed:', e && e.message)
    return false
  }
}

/**
 * Increment the per-IP counter for a bucket ('ai' | 'stt' | 'tts').
 * Returns a 429 Response when the cap is exceeded, or null when the request may proceed.
 * Fails open if D1 is missing or errors, so a DB outage does not take the site down.
 */
async function enforceIpLimit(req, env, bucket, now = Date.now()) {
  const db = env?.SYNC_DB
  if (!db) return null
  const caps = {
    ai: envInt(env, 'AI_IP_LIMIT', DEFAULT_AI_IP_LIMIT),
    stt: envInt(env, 'STT_IP_LIMIT', DEFAULT_STT_IP_LIMIT),
    tts: envInt(env, 'TTS_IP_LIMIT', DEFAULT_TTS_IP_LIMIT),
  }
  const cap = caps[bucket] ?? DEFAULT_AI_IP_LIMIT
  if (cap <= 0) return rateLimitedResponse(MSG_IP_LIMIT, 60)
  const start = windowStart(now)
  const ipHash = await hashIp(clientIp(req))
  try {
    await db.prepare(`DELETE FROM usage_ip WHERE window_start < ?`).bind(now - IP_WINDOW_MS * 2).run()
    await db.prepare(
      `INSERT OR IGNORE INTO usage_ip (ip_hash, bucket, window_start, count) VALUES (?, ?, ?, 0)`,
    ).bind(ipHash, bucket, start).run()
    const row = await db.prepare(
      `UPDATE usage_ip SET count = count + 1 WHERE ip_hash = ? AND bucket = ? AND window_start = ? AND count < ? RETURNING count`,
    ).bind(ipHash, bucket, start, cap).first()
    if (!row) {
      const retryAfterSec = Math.max(1, Math.ceil((start + IP_WINDOW_MS - now) / 1000))
      return rateLimitedResponse(MSG_IP_LIMIT, retryAfterSec)
    }
    return null
  } catch (e) {
    console.error('IP limit check failed:', e && e.message)
    return null
  }
}

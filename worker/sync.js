// Cross-device sync: POST /api/sync/create, POST /api/sync/push, GET /api/sync/pull?since=
// Auth: Authorization: Bearer <sync code>. Only SHA-256(code) is stored.

const SYNC_TABLES = ['videos', 'prefs', 'words', 'sentences']
const MAX_PUSH_BYTES = 5 * 1024 * 1024
const MAX_PUSH_RECORDS = 400
const MAX_PULL_RECORDS = 200
const MAX_ID_LEN = 200
const MAX_DATA_BYTES = 1_000_000

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function normalizeCode(code) {
  return String(code || '').toLowerCase().replace(/[^0-9a-f]/g, '')
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function codeHashFromReq(req) {
  const hdr = req.headers.get('authorization') || ''
  const m = hdr.match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  const norm = normalizeCode(m[1])
  if (norm.length !== 32) return null
  return sha256Hex(norm)
}

async function requireSpace(env, hash) {
  if (!hash) return { error: json({ error: '缺少或無效嘅同步碼' }, 401) }
  const row = await env.SYNC_DB.prepare('SELECT 1 AS ok FROM spaces WHERE code_hash = ?').bind(hash).first()
  if (!row) return { error: json({ error: '找不到呢個同步碼，請確認有冇打錯。' }, 404) }
  return { hash }
}

function validateRecord(r) {
  if (!r || typeof r !== 'object') return '無效紀錄'
  if (!SYNC_TABLES.includes(r.table)) return '不支援嘅資料表'
  if (typeof r.id !== 'string' || !r.id || r.id.length > MAX_ID_LEN) return '無效編號'
  if (typeof r.updatedAt !== 'number' || !Number.isFinite(r.updatedAt) || r.updatedAt < 0) return '無效時間'
  if (typeof r.deleted !== 'boolean') return '無效刪除標記'
  if (r.deleted) {
    if (r.data != null && r.data !== undefined) return '已刪除嘅紀錄唔應帶資料'
  } else {
    if (!r.data || typeof r.data !== 'object' || Array.isArray(r.data)) return '缺少資料'
    const n = new TextEncoder().encode(JSON.stringify(r.data)).length
    if (n > MAX_DATA_BYTES) return '單筆資料太大'
  }
  return null
}

async function handleSyncCreate(req, env) {
  const hash = await codeHashFromReq(req)
  if (!hash) return json({ error: '缺少或無效嘅同步碼' }, 401)
  await env.SYNC_DB.prepare('INSERT OR IGNORE INTO spaces (code_hash, created_at) VALUES (?, ?)').bind(hash, Date.now()).run()
  return json({ ok: true })
}

async function handleSyncPush(req, env) {
  const gate = await requireSpace(env, await codeHashFromReq(req))
  if (gate.error) return gate.error
  const { hash } = gate

  const len = Number(req.headers.get('content-length') || 0)
  if (len > MAX_PUSH_BYTES) return json({ error: '同步資料太大（上限 5 MB）' }, 413)

  let body
  try { body = await req.json() } catch { return json({ error: '無效 JSON' }, 400) }
  if (new TextEncoder().encode(JSON.stringify(body)).length > MAX_PUSH_BYTES) {
    return json({ error: '同步資料太大（上限 5 MB）' }, 413)
  }
  const records = body?.records
  if (!Array.isArray(records)) return json({ error: '缺少 records' }, 400)
  if (records.length > MAX_PUSH_RECORDS) return json({ error: `每次最多 ${MAX_PUSH_RECORDS} 筆` }, 400)

  for (const r of records) {
    const err = validateRecord(r)
    if (err) return json({ error: err }, 400)
  }
  if (!records.length) return json({ ok: true, accepted: 0 })

  const maxRow = await env.SYNC_DB.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM records WHERE code_hash = ?').bind(hash).first()
  let seq = Number(maxRow?.m || 0)
  const stmts = []
  for (const r of records) {
    seq += 1
    const data = r.deleted ? null : JSON.stringify(r.data)
    stmts.push(
      env.SYNC_DB.prepare(
        `INSERT INTO records (code_hash, rec_id, tbl, data, updated_at, deleted, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code_hash, rec_id) DO UPDATE SET
           tbl = excluded.tbl,
           data = excluded.data,
           updated_at = excluded.updated_at,
           deleted = excluded.deleted,
           seq = excluded.seq
         WHERE excluded.updated_at >= records.updated_at`,
      ).bind(hash, `${r.table}:${r.id}`, r.table, data, r.updatedAt, r.deleted ? 1 : 0, seq),
    )
  }
  await env.SYNC_DB.batch(stmts)
  return json({ ok: true, accepted: records.length })
}

async function handleSyncPull(req, env) {
  const gate = await requireSpace(env, await codeHashFromReq(req))
  if (gate.error) return gate.error
  const { hash } = gate
  const url = new URL(req.url)
  const since = Number(url.searchParams.get('since') || 0)
  if (!Number.isFinite(since) || since < 0) return json({ error: '無效游標' }, 400)

  const rows = await env.SYNC_DB.prepare(
    `SELECT rec_id, tbl, data, updated_at, deleted, seq
     FROM records
     WHERE code_hash = ? AND seq > ?
     ORDER BY seq ASC
     LIMIT ?`,
  ).bind(hash, since, MAX_PULL_RECORDS + 1).all()

  const list = rows?.results || []
  const hasMore = list.length > MAX_PULL_RECORDS
  const page = hasMore ? list.slice(0, MAX_PULL_RECORDS) : list
  const records = page.map((row) => {
    const prefix = row.tbl + ':'
    const id = String(row.rec_id).startsWith(prefix) ? String(row.rec_id).slice(prefix.length) : String(row.rec_id)
    let data = null
    if (!row.deleted && row.data) {
      try { data = JSON.parse(row.data) } catch { data = null }
    }
    return { table: row.tbl, id, data, updatedAt: row.updated_at, deleted: row.deleted === 1, seq: row.seq }
  })
  const cursor = page.length ? page[page.length - 1].seq : since
  return json({ records, cursor, hasMore })
}

async function handleSync(req, env) {
  if (req.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const path = new URL(req.url).pathname
  try {
    if (path === '/api/sync/create' && req.method === 'POST') return await handleSyncCreate(req, env)
    if (path === '/api/sync/push' && req.method === 'POST') return await handleSyncPush(req, env)
    if (path === '/api/sync/pull' && req.method === 'GET') return await handleSyncPull(req, env)
    return new Response('Not found', { status: 404 })
  } catch (e) {
    console.error('sync error', e)
    return json({ error: e.message || '同步服務錯誤' }, 500)
  }
}

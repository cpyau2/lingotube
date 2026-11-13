import { db, sentenceSyncId, setOnLocalChange, tombstoneId, withRemoteApply, wordSyncId } from './db'
import type { SentenceRec, VideoPrefs, VideoRec, WordRec } from './types'

export const SYNC_TABLES = ['videos', 'prefs', 'words', 'sentences'] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

const KV_CODE = 'sync-code'
const KV_SEQ = 'sync-last-seq'
const KV_SYNCED = 'sync-last-synced-at'
const KV_ERROR = 'sync-last-error'
const BATCH = 200
const DEBOUNCE_MS = 3000

export type SyncStatus = {
  code: string | null
  lastSyncedAt: number | null
  lastSeq: number
  syncing: boolean
  error: string | null
}

type PushRec = { table: SyncTable; id: string; data: unknown | null; updatedAt: number; deleted: boolean }

let syncing = false
let debounceTimer: number | null = null
const listeners = new Set<(s: SyncStatus) => void>()
let cached: SyncStatus = { code: null, lastSyncedAt: null, lastSeq: 0, syncing: false, error: null }

export function subscribeSyncStatus(fn: (s: SyncStatus) => void) {
  listeners.add(fn)
  fn(cached)
  return () => { listeners.delete(fn) }
}

function emit() {
  for (const fn of listeners) fn(cached)
}

async function readState(): Promise<SyncStatus> {
  const [code, seq, synced, err] = await Promise.all([
    db.kv.get(KV_CODE),
    db.kv.get(KV_SEQ),
    db.kv.get(KV_SYNCED),
    db.kv.get(KV_ERROR),
  ])
  cached = {
    code: (code?.value as string) || null,
    lastSeq: Number(seq?.value || 0),
    lastSyncedAt: (synced?.value as number) || null,
    error: (err?.value as string) || null,
    syncing,
  }
  return cached
}

async function setError(msg: string | null) {
  if (msg) await db.kv.put({ key: KV_ERROR, value: msg })
  else await db.kv.delete(KV_ERROR)
  cached = { ...cached, error: msg }
  emit()
}

/** 32 hex chars (128 bits), shown as xxxx-xxxx-... */
export function generateSyncCode(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return formatSyncCode(hex)
}

export function normalizeSyncCode(code: string): string {
  return code.toLowerCase().replace(/[^0-9a-f]/g, '')
}

export function formatSyncCode(code: string): string {
  const h = normalizeSyncCode(code)
  return (h.match(/.{1,4}/g) || []).join('-')
}

export function isValidSyncCode(code: string): boolean {
  return normalizeSyncCode(code).length === 32
}

function authHeaders(code: string): HeadersInit {
  return { Authorization: `Bearer ${normalizeSyncCode(code)}`, 'content-type': 'application/json' }
}

async function api(path: string, code: string, init: RequestInit = {}) {
  const r = await fetch(path, { ...init, headers: { ...authHeaders(code), ...(init.headers || {}) } })
  const text = await r.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = { error: text } }
  if (!r.ok) {
    const err = new Error(body?.error || `同步失敗（${r.status}）`) as Error & { status: number }
    err.status = r.status
    throw err
  }
  return body
}

function recId(table: SyncTable, rec: VideoRec | VideoPrefs | WordRec | SentenceRec): string {
  if (table === 'videos' || table === 'prefs') return (rec as VideoRec | VideoPrefs).id
  if (table === 'words') return wordSyncId((rec as WordRec).word)
  return sentenceSyncId((rec as SentenceRec).videoId, (rec as SentenceRec).start)
}

function payloadOf(table: SyncTable, rec: any) {
  const data = { ...rec }
  delete data.dirty
  if (table === 'words' || table === 'sentences') delete data.id
  return data
}

async function collectOutgoing(all: boolean): Promise<PushRec[]> {
  const out: PushRec[] = []
  for (const table of SYNC_TABLES) {
    const rows = all
      ? await db[table].toArray()
      : await db[table].filter((r: any) => r.dirty === 1).toArray()
    for (const rec of rows) {
      out.push({
        table,
        id: recId(table, rec as any),
        data: payloadOf(table, rec),
        updatedAt: (rec as any).updatedAt || (rec as any).createdAt || Date.now(),
        deleted: false,
      })
    }
  }
  const tombs = all
    ? await db.tombstones.toArray()
    : await db.tombstones.filter((t) => t.dirty === 1).toArray()
  for (const t of tombs) {
    const prefix = t.table + ':'
    const id = t.id.startsWith(prefix) ? t.id.slice(prefix.length) : t.id
    if (!SYNC_TABLES.includes(t.table as SyncTable)) continue
    out.push({ table: t.table as SyncTable, id, data: null, updatedAt: t.updatedAt, deleted: true })
  }
  return out
}

async function applyIncoming(records: any[]) {
  await withRemoteApply(async () => {
    for (const r of records) {
      if (!SYNC_TABLES.includes(r.table)) continue
      const remoteAt = Number(r.updatedAt) || 0
      if (r.deleted) {
        await applyDelete(r.table, r.id, remoteAt)
      } else if (r.data) {
        await applyUpsert(r.table, r.data, remoteAt)
      }
    }
  })
}

async function applyDelete(table: SyncTable, id: string, remoteAt: number) {
  const local = await findLocal(table, id)
  if (local && (local.updatedAt || 0) > remoteAt) return // local edit wins
  if (local) {
    if (table === 'videos') await db.videos.delete(id)
    else if (table === 'prefs') await db.prefs.delete(id)
    else if (table === 'words' && local.id != null) await db.words.delete(local.id)
    else if (table === 'sentences' && local.id != null) await db.sentences.delete(local.id)
  }
  await db.tombstones.put({ id: tombstoneId(table, id), table, updatedAt: remoteAt, dirty: 0 })
}

async function applyUpsert(table: SyncTable, data: any, remoteAt: number) {
  const id = table === 'words' ? wordSyncId(data.word)
    : table === 'sentences' ? sentenceSyncId(data.videoId, data.start)
    : data.id
  if (!id) return
  const local = await findLocal(table, id)
  if (local && (local.updatedAt || 0) > remoteAt) return
  const rec = { ...data, updatedAt: remoteAt, dirty: 0 }
  if (table === 'videos') await db.videos.put(rec)
  else if (table === 'prefs') await db.prefs.put(rec)
  else if (table === 'words') {
    if (local?.id != null) {
      const { id: _ignore, ...rest } = rec
      await db.words.update(local.id, rest)
    } else {
      delete rec.id
      await db.words.add(rec)
    }
  } else if (table === 'sentences') {
    if (local?.id != null) {
      const { id: _ignore, ...rest } = rec
      await db.sentences.update(local.id, rest)
    } else {
      delete rec.id
      await db.sentences.add(rec)
    }
  }
  await db.tombstones.delete(tombstoneId(table, id))
}

async function findLocal(table: SyncTable, id: string): Promise<any | undefined> {
  if (table === 'videos') return db.videos.get(id)
  if (table === 'prefs') return db.prefs.get(id)
  if (table === 'words') return db.words.where('word').equals(id).first()
  const idx = id.lastIndexOf(':')
  if (idx < 0) return undefined
  const videoId = id.slice(0, idx)
  const start = Number(id.slice(idx + 1))
  return db.sentences.where('videoId').equals(videoId).and((s) => s.start === start).first()
}

async function markPushed(sent: PushRec[]) {
  const byKey = new Map(sent.map((r) => [`${r.table}:${r.id}`, r.updatedAt]))
  await withRemoteApply(async () => {
    for (const table of SYNC_TABLES) {
      const dirty = await db[table].filter((r: any) => r.dirty === 1).toArray()
      for (const rec of dirty) {
        const id = recId(table, rec as any)
        const sentAt = byKey.get(`${table}:${id}`)
        if (sentAt != null && (rec as any).updatedAt <= sentAt) {
          if (table === 'videos') await db.videos.update((rec as VideoRec).id, { dirty: 0 } as any)
          else if (table === 'prefs') await db.prefs.update((rec as VideoPrefs).id, { dirty: 0 } as any)
          else if (table === 'words' && (rec as WordRec).id != null) await db.words.update((rec as WordRec).id!, { dirty: 0 } as any)
          else if (table === 'sentences' && (rec as SentenceRec).id != null) await db.sentences.update((rec as SentenceRec).id!, { dirty: 0 } as any)
        }
      }
    }
    const tombs = await db.tombstones.filter((t) => t.dirty === 1).toArray()
    for (const t of tombs) {
      const sentAt = byKey.get(t.id) ?? byKey.get(`${t.table}:${t.id.includes(':') ? t.id.slice(t.table.length + 1) : t.id}`)
      if (sentAt != null && t.updatedAt <= sentAt) await db.tombstones.update(t.id, { dirty: 0 })
    }
  })
}

async function pullAll(code: string, fromSeq: number) {
  let since = fromSeq
  let cursor = fromSeq
  while (true) {
    const page = await api(`/api/sync/pull?since=${encodeURIComponent(String(since))}`, code)
    const recs = page?.records || []
    if (recs.length) await applyIncoming(recs)
    cursor = Number(page?.cursor ?? since)
    if (!page?.hasMore) break
    since = cursor
  }
  return cursor
}

async function pushBatches(code: string, records: PushRec[]) {
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH)
    await api('/api/sync/push', code, { method: 'POST', body: JSON.stringify({ records: chunk }) })
    await markPushed(chunk)
  }
}

export async function syncNow(): Promise<SyncStatus> {
  const state = await readState()
  if (!state.code) return state
  if (syncing) return { ...cached, syncing: true }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await setError('而家離線，連返網絡之後會再試。')
    return cached
  }
  syncing = true
  cached = { ...cached, syncing: true }
  emit()
  try {
    // Pull first so first-join merges remote into local, then push local (and local-only) data.
    const first = state.lastSeq === 0
    const cursor = await pullAll(state.code, state.lastSeq)
    const outgoing = await collectOutgoing(first)
    if (outgoing.length) await pushBatches(state.code, outgoing)
    const now = Date.now()
    await db.kv.put({ key: KV_SEQ, value: cursor })
    await db.kv.put({ key: KV_SYNCED, value: now })
    await db.kv.delete(KV_ERROR)
    cached = { ...cached, lastSeq: cursor, lastSyncedAt: now, error: null, syncing: false }
  } catch (e: any) {
    const msg = e?.message || String(e)
    await setError(msg)
    cached = { ...cached, error: msg, syncing: false }
  } finally {
    syncing = false
    cached = { ...cached, syncing: false }
    emit()
  }
  return cached
}

export function scheduleSync() {
  if (debounceTimer) window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => { debounceTimer = null; syncNow() }, DEBOUNCE_MS)
}

export async function createSyncCode(): Promise<string> {
  const code = generateSyncCode()
  await api('/api/sync/create', code, { method: 'POST' })
  await db.kv.put({ key: KV_CODE, value: formatSyncCode(code) })
  await db.kv.put({ key: KV_SEQ, value: 0 })
  await db.kv.delete(KV_ERROR)
  await readState()
  emit()
  await syncNow()
  return formatSyncCode(code)
}

export async function joinSyncCode(input: string): Promise<SyncStatus> {
  if (!isValidSyncCode(input)) throw new Error('同步碼格式唔正確（應該係一組 xxxx-xxxx-… 嘅代碼）')
  const code = formatSyncCode(input)
  // Probe: pull since 0. 404 means the space doesn't exist.
  await api('/api/sync/pull?since=0', code)
  await db.kv.put({ key: KV_CODE, value: code })
  await db.kv.put({ key: KV_SEQ, value: 0 })
  await db.kv.delete(KV_ERROR)
  await readState()
  emit()
  return syncNow()
}

export async function stopSync() {
  await db.kv.delete(KV_CODE)
  await db.kv.delete(KV_SEQ)
  await db.kv.delete(KV_SYNCED)
  await db.kv.delete(KV_ERROR)
  await readState()
  emit()
}

export async function initSync() {
  setOnLocalChange(scheduleSync)
  await readState()
  emit()
  if (cached.code) syncNow()
  const onVis = () => { if (document.visibilityState === 'visible' && cached.code) syncNow() }
  const onFocus = () => { if (cached.code) syncNow() }
  const onOnline = () => { if (cached.code) syncNow() }
  window.addEventListener('visibilitychange', onVis)
  window.addEventListener('focus', onFocus)
  window.addEventListener('online', onOnline)
}

export function formatLastSynced(ts: number | null): string {
  if (!ts) return '尚未同步'
  const d = Date.now() - ts
  if (d < 45_000) return '剛剛'
  if (d < 3_600_000) return `${Math.max(1, Math.round(d / 60_000))} 分鐘前`
  return new Date(ts).toLocaleString('zh-Hant', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export { readState as getSyncState }

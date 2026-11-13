import Dexie, { type Table } from 'dexie'
import type { SentenceRec, VideoPrefs, VideoRec, WordRec, DictEntry, ArticleScript } from './types'

class LingoDB extends Dexie {
  videos!: Table<VideoRec, string>
  prefs!: Table<VideoPrefs, string>
  words!: Table<WordRec, number>
  sentences!: Table<SentenceRec, number>
  dict!: Table<DictEntry & { key: string; at: number }, string>
  kv!: Table<{ key: string; value: unknown }, string>
  articles!: Table<ArticleScript, number>
  audioCache!: Table<{ key: string; blob: Blob; createdAt: number }, string>
  recordings!: Table<{ key: string; blob: Blob; createdAt: number }, string>
  tombstones!: Table<{ id: string; table: string; updatedAt: number; dirty?: number }, string>

  constructor() {
    super('lingotube')
    this.version(1).stores({
      videos: 'id, createdAt',
      prefs: 'id',
      words: '++id, word, videoId, dueAt, createdAt',
      sentences: '++id, videoId, start, dueAt, createdAt',
      dict: 'key',
      kv: 'key',
    })
    // v2: add AI caches
    this.version(2).stores({
      videos: 'id, createdAt',
      prefs: 'id',
      words: '++id, word, videoId, dueAt, createdAt',
      sentences: '++id, videoId, start, dueAt, createdAt',
      dict: 'key',
      kv: 'key',
    }).upgrade((tx) => {
      // no migration needed, just add kv entries
    })
    // v3: add article scripts
    this.version(3).stores({
      videos: 'id, createdAt',
      prefs: 'id',
      words: '++id, word, videoId, dueAt, createdAt',
      sentences: '++id, videoId, start, dueAt, createdAt',
      dict: 'key',
      kv: 'key',
      articles: '++id, createdAt',
    })
    // v4: add audio cache and recordings
    this.version(4).stores({
      videos: 'id, createdAt',
      prefs: 'id',
      words: '++id, word, videoId, dueAt, createdAt',
      sentences: '++id, videoId, start, dueAt, createdAt',
      dict: 'key',
      kv: 'key',
      articles: '++id, createdAt',
      audioCache: 'key, createdAt',
      recordings: 'key, createdAt',
    })
    // v5: updatedAt/dirty for sync + tombstones so deletes propagate
    this.version(5).stores({
      videos: 'id, createdAt, updatedAt, dirty',
      prefs: 'id, updatedAt, dirty',
      words: '++id, word, videoId, dueAt, createdAt, updatedAt, dirty',
      sentences: '++id, videoId, start, dueAt, createdAt, updatedAt, dirty',
      dict: 'key',
      kv: 'key',
      articles: '++id, createdAt',
      audioCache: 'key, createdAt',
      recordings: 'key, createdAt',
      tombstones: 'id, table, updatedAt, dirty',
    }).upgrade(async (tx) => {
      const now = Date.now()
      for (const name of ['videos', 'prefs', 'words', 'sentences'] as const) {
        await tx.table(name).toCollection().modify((r: any) => {
          if (r.updatedAt == null) r.updatedAt = r.createdAt || now
          r.dirty = 1
        })
      }
    })
  }
}

export const db = new LingoDB()

const SYNCABLE = ['videos', 'prefs', 'words', 'sentences'] as const
let applyingRemote = 0
let onLocalChange: () => void = () => {}

/** Suppress dirty/updatedAt stamping while applying a remote pull. */
export async function withRemoteApply<T>(fn: () => Promise<T>): Promise<T> {
  applyingRemote++
  try { return await fn() } finally { applyingRemote-- }
}

export function setOnLocalChange(fn: () => void) { onLocalChange = fn }

function noteLocalChange() {
  if (applyingRemote) return
  queueMicrotask(() => onLocalChange())
}

for (const name of SYNCABLE) {
  db[name].hook('creating', (_pk, obj: any) => {
    if (applyingRemote) {
      if (obj.updatedAt == null) obj.updatedAt = Date.now()
      if (obj.dirty == null) obj.dirty = 0
    } else {
      obj.updatedAt = Date.now()
      obj.dirty = 1
      noteLocalChange()
    }
  })
  db[name].hook('updating', (mods: any) => {
    if (applyingRemote) return mods
    noteLocalChange()
    return { ...mods, updatedAt: Date.now(), dirty: 1 }
  })
}

export function wordSyncId(word: string) { return String(word).toLowerCase() }
export function sentenceSyncId(videoId: string, start: number) { return `${videoId}:${start}` }
export function tombstoneId(table: string, id: string) { return `${table}:${id}` }

async function writeTombstone(table: string, id: string, at = Date.now()) {
  await db.tombstones.put({ id: tombstoneId(table, id), table, updatedAt: at, dirty: 1 })
  noteLocalChange()
}

export const defaultPrefs = (id: string): VideoPrefs => ({
  id,
  showEn: true,
  showZh: true,
  autoScroll: true,
  pauseOnWordTap: true,
  loopLine: false,
  fontScale: 1,
  rate: 1,
})

export async function getPrefs(id: string): Promise<VideoPrefs> {
  return (await db.prefs.get(id)) ?? defaultPrefs(id)
}

export async function exportAll() {
  const [videos, prefs, words, sentences, kv] = await Promise.all([
    db.videos.toArray(), db.prefs.toArray(), db.words.toArray(), db.sentences.toArray(), db.kv.toArray(),
  ])
  // never export API keys
  const safeKv = kv.filter((k) => k.key !== 'ai-settings')
  return { app: 'lingotube', version: 1, exportedAt: new Date().toISOString(), videos, prefs, words, sentences, kv: safeKv }
}

export async function importAll(data: any) {
  if (data?.app !== 'lingotube') throw new Error('不是 LingoTube 備份檔')
  await db.transaction('rw', [db.videos, db.prefs, db.words, db.sentences], async () => {
    if (data.videos) await db.videos.bulkPut(data.videos)
    if (data.prefs) await db.prefs.bulkPut(data.prefs)
    if (data.words) {
      for (const w of data.words) {
        const dup = await db.words.where('word').equals(w.word).first()
        if (!dup) { delete w.id; await db.words.add(w) }
      }
    }
    if (data.sentences) {
      for (const s of data.sentences) {
        const dup = await db.sentences.where('videoId').equals(s.videoId).and((x) => x.start === s.start).first()
        if (!dup) { delete s.id; await db.sentences.add(s) }
      }
    }
  })
}

export async function deleteVideo(videoId: string) {
  await db.transaction('rw', [db.videos, db.prefs, db.words, db.sentences, db.tombstones], async () => {
    const now = Date.now()
    const words = await db.words.where('videoId').equals(videoId).toArray()
    const sentences = await db.sentences.where('videoId').equals(videoId).toArray()
    await db.tombstones.bulkPut([
      { id: tombstoneId('videos', videoId), table: 'videos', updatedAt: now, dirty: 1 },
      { id: tombstoneId('prefs', videoId), table: 'prefs', updatedAt: now, dirty: 1 },
      ...words.map((w) => ({ id: tombstoneId('words', wordSyncId(w.word)), table: 'words', updatedAt: now, dirty: 1 })),
      ...sentences.map((s) => ({ id: tombstoneId('sentences', sentenceSyncId(s.videoId, s.start)), table: 'sentences', updatedAt: now, dirty: 1 })),
    ])
    await db.videos.delete(videoId)
    await db.prefs.delete(videoId)
    await db.words.where('videoId').equals(videoId).delete()
    await db.sentences.where('videoId').equals(videoId).delete()
  })
  noteLocalChange()
}

export async function deleteVideos(videoIds: string[]) {
  for (const id of videoIds) await deleteVideo(id)
}

export async function deleteWord(id: number) {
  await db.transaction('rw', [db.words, db.tombstones], async () => {
    const w = await db.words.get(id)
    if (w) await writeTombstone('words', wordSyncId(w.word))
    await db.words.delete(id)
  })
}

export async function deleteSentence(id: number) {
  await db.transaction('rw', [db.sentences, db.tombstones], async () => {
    const s = await db.sentences.get(id)
    if (s) await writeTombstone('sentences', sentenceSyncId(s.videoId, s.start))
    await db.sentences.delete(id)
  })
}

export async function deleteArticle(articleId: number) {
  await db.articles.delete(articleId)
}

export async function deleteArticles(articleIds: number[]) {
  await db.articles.bulkDelete(articleIds)
}

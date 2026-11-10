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
  }
}

export const db = new LingoDB()

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
  await db.transaction('rw', [db.videos, db.prefs, db.words, db.sentences], async () => {
    await db.videos.delete(videoId)
    await db.prefs.delete(videoId)
    await db.words.where('videoId').equals(videoId).delete()
    await db.sentences.where('videoId').equals(videoId).delete()
  })
}

export async function deleteVideos(videoIds: string[]) {
  await db.transaction('rw', [db.videos, db.prefs, db.words, db.sentences], async () => {
    await db.videos.bulkDelete(videoIds)
    await db.prefs.bulkDelete(videoIds)
    for (const videoId of videoIds) {
      await db.words.where('videoId').equals(videoId).delete()
      await db.sentences.where('videoId').equals(videoId).delete()
    }
  })
}

export async function deleteArticle(articleId: number) {
  await db.articles.delete(articleId)
}

export async function deleteArticles(articleIds: number[]) {
  await db.articles.bulkDelete(articleIds)
}

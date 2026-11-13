export interface Cue {
  start: number
  end: number
  en: string
  zh?: string
}

export type CaptionLang = 'en' | 'zh' | 'ja' | 'ko'

export interface VideoRec {
  id: string // internal id (we use the YouTube id)
  youtubeId: string
  title: string
  cues: Cue[]
  createdAt: number
  /** Primary subtitle language. Missing on older records = English. */
  captionLang?: CaptionLang
  demo?: boolean
  updatedAt?: number
  dirty?: number
}

export interface VideoPrefs {
  id: string // video id
  showEn: boolean
  showZh: boolean
  autoScroll: boolean
  pauseOnWordTap: boolean
  loopLine: boolean
  fontScale: number // 0.85 .. 1.5
  rate: number
  updatedAt?: number
  dirty?: number
}

export interface Srs {
  ease: number
  interval: number // days
  reps: number
  lapses: number
  dueAt: number // epoch ms
  lastReviewedAt?: number
}

export interface WordRec extends Srs {
  id?: number
  word: string // lower-case headword as tapped
  phonetic?: string
  zh?: string
  definition?: string
  pos?: string
  audioUrl?: string
  context: string // sentence it was tapped in
  contextZh?: string
  videoId?: string
  videoTitle?: string
  time?: number
  createdAt: number
  updatedAt?: number
  dirty?: number
}

export interface SentenceRec extends Srs {
  id?: number
  en: string
  zh?: string
  videoId: string
  videoTitle?: string
  start: number
  end: number
  createdAt: number
  updatedAt?: number
  dirty?: number
}

export interface DictEntry {
  word: string
  phonetic?: string
  audioUrl?: string
  zh?: string
  meanings: { pos: string; defs: string[] }[]
  source: 'bundled' | 'network' | 'cache' | 'none'
}

// Article Shadowing types
export interface ArticleChunk {
  text: string
  stressed: boolean
}

export interface ArticleSentence {
  chunks: ArticleChunk[]
  attempts: number
  bestScore: number
  lastPractised?: number
}

export interface ArticlePart {
  title: string
  sentences: ArticleSentence[]
}

export interface ArticleScript {
  id?: number
  title: string
  level?: string
  parts: ArticlePart[]
  createdAt: number
}

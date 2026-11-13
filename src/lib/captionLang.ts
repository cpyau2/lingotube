export type CaptionLang = 'en' | 'zh' | 'ja' | 'ko'

export const CAPTION_LANGS: { value: CaptionLang; label: string }[] = [
  { value: 'en', label: '英文' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日文' },
  { value: 'ko', label: '韓文' },
]

export const LS_CAPTION_LANG = 'lingotube-caption-lang'

export function normalizeCaptionLang(v: unknown): CaptionLang {
  return v === 'zh' || v === 'ja' || v === 'ko' ? v : 'en'
}

export function isCjkLang(lang?: string | null): boolean {
  return lang === 'zh' || lang === 'ja' || lang === 'ko'
}

export function primaryLangAttr(lang?: string | null): string {
  if (lang === 'zh') return 'zh-Hant'
  if (lang === 'ja') return 'ja'
  if (lang === 'ko') return 'ko'
  return 'en'
}

export function secondaryLangAttr(lang?: string | null): string {
  return lang === 'zh' ? 'en' : 'zh-Hant'
}

export function primaryToggleLabel(lang?: string | null): string {
  if (lang === 'zh') return '中 中文'
  if (lang === 'ja') return '日 日文'
  if (lang === 'ko') return '韓 韓文'
  return 'EN 英文'
}

export function secondaryToggleLabel(lang?: string | null): string {
  return lang === 'zh' ? 'EN 英文' : '中 中文'
}

export function speakLang(lang?: string | null): string {
  if (lang === 'zh') return 'zh-TW'
  if (lang === 'ja') return 'ja-JP'
  if (lang === 'ko') return 'ko-KR'
  return 'en-US'
}

export const ENGLISH_ONLY_NOTE = '跟讀評分同句型拆解而家主要支援英文句子。'

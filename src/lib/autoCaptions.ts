import type { Cue, CaptionLang } from './types'
import { mergeBilingual } from './subs'

export interface AutoResult { title: string; cues: Cue[]; zhSource: string; enSource: string; lang?: CaptionLang; note?: string }

/** Calls the same-origin Worker endpoint (/api/captions). Throws Error with a user-facing Chinese message. */
export async function fetchAutoCaptions(youtubeId: string, onRetry?: (n: number) => void, lang: CaptionLang = 'en'): Promise<AutoResult> {
  let last = new Error('抓字幕失敗，請遲啲再試或者匯入字幕檔')
  const qLang = lang && lang !== 'en' ? `&lang=${encodeURIComponent(lang)}` : ''
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) { onRetry?.(attempt); await new Promise((r) => setTimeout(r, 1500)) }
    let r: Response
    try {
      r = await fetch(`/api/captions?v=${encodeURIComponent(youtubeId)}${qLang}${attempt ? '&fresh=1' : ''}`)
    } catch {
      throw new Error('連唔到伺服器，請檢查網絡')
    }
    const ct = r.headers.get('content-type') || ''
    if (!ct.includes('application/json')) {
      throw new Error('自動抓字幕只喺已部署嘅網站可用（本機開發版請用「匯入字幕檔」或「本機代理」）')
    }
    const j = await r.json()
    if (r.ok) return { title: j.title, cues: mergeBilingual(j.en, j.zh), zhSource: j.zhSource, enSource: j.enSource, lang: j.lang, note: j.note }
    last = new Error(j.error || last.message)
    // YouTube's bot check is intermittent per Cloudflare edge IP - retry transient failures only
    if (j.code !== 'blocked' && j.code !== 'failed') throw last
  }
  throw last
}

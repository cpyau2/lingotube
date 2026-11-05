import type { Cue } from './types'
import { mergeBilingual } from './subs'

/** Optional local helper (server/captions-proxy.mjs). Browsers cannot fetch YouTube captions directly (CORS). */
export const DEFAULT_PROXY = 'http://localhost:8787'

export async function fetchViaProxy(youtubeId: string, base = DEFAULT_PROXY): Promise<{ title: string; cues: Cue[] }> {
  const r = await fetch(`${base.replace(/\/$/, '')}/captions?v=${youtubeId}`)
  if (!r.ok) throw new Error((await r.text().catch(() => '')) || `proxy ${r.status}`)
  const j = await r.json()
  return { title: j.title as string, cues: mergeBilingual(j.en, j.zh) }
}

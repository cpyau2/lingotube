import { db } from './db'
import type { DictEntry } from './types'
import { DEMO_GLOSS } from '../data/demo'

function candidates(w: string): string[] {
  const s = new Set<string>([w])
  const add = (x: string) => x.length > 2 && s.add(x)
  if (w.endsWith('ies')) add(w.slice(0, -3) + 'y')
  if (w.endsWith('es')) add(w.slice(0, -2))
  if (w.endsWith('s')) add(w.slice(0, -1))
  if (w.endsWith('ied')) add(w.slice(0, -3) + 'y')
  if (w.endsWith('ed')) { add(w.slice(0, -2)); add(w.slice(0, -1)) }
  if (w.endsWith('ing')) { add(w.slice(0, -3)); add(w.slice(0, -3) + 'e') }
  if (w.endsWith('ly')) add(w.slice(0, -2))
  if (w.endsWith('er')) add(w.slice(0, -2))
  return [...s]
}

async function fetchJson(url: string, ms = 6000): Promise<any> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctl.signal })
    if (!r.ok) throw new Error(String(r.status))
    return await r.json()
  } finally { clearTimeout(t) }
}

async function enDefinition(word: string): Promise<Partial<DictEntry> | null> {
  for (const c of candidates(word)) {
    try {
      const j = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(c)}`)
      if (!Array.isArray(j) || !j[0]) continue
      const e = j[0]
      const phonetic: string | undefined = e.phonetic || e.phonetics?.find((p: any) => p.text)?.text
      const audioUrl: string | undefined = e.phonetics?.find((p: any) => p.audio)?.audio || undefined
      const meanings = (e.meanings ?? []).slice(0, 3).map((m: any) => ({
        pos: m.partOfSpeech as string,
        defs: (m.definitions ?? []).slice(0, 2).map((d: any) => d.definition as string),
      }))
      return { word: e.word ?? c, phonetic, audioUrl, meanings }
    } catch { /* try next candidate */ }
  }
  return null
}

async function zhGloss(word: string): Promise<string | undefined> {
  try {
    const j = await fetchJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|zh-TW`)
    const t: string | undefined = j?.responseData?.translatedText
    if (t && t.toLowerCase() !== word.toLowerCase() && !/MYMEMORY/i.test(t)) return t
  } catch { /* offline */ }
  return undefined
}

/**
 * Word lookup: bundled gloss (offline) -> IndexedDB cache -> dictionaryapi.dev + MyMemory (online).
 * Always resolves; `source` tells the UI how complete the result is.
 */
export async function lookup(raw: string): Promise<DictEntry> {
  const word = raw.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '')
  const bundled = candidates(word).map((c) => DEMO_GLOSS[c]).find(Boolean)
  const cached = await db.dict.get(word)
  if (cached && (cached.meanings.length || cached.zh)) {
    return { ...cached, zh: cached.zh ?? bundled, source: 'cache' }
  }
  const [en, zh] = await Promise.all([enDefinition(word), bundled ? Promise.resolve(bundled) : zhGloss(word)])
  const entry: DictEntry = {
    word,
    phonetic: en?.phonetic,
    audioUrl: en?.audioUrl,
    zh: bundled ?? zh,
    meanings: en?.meanings ?? [],
    source: en ? 'network' : bundled ? 'bundled' : zh ? 'network' : 'none',
  }
  if (entry.meanings.length || entry.zh) await db.dict.put({ ...entry, key: word, at: Date.now() })
  return entry
}

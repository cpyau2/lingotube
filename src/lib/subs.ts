import type { Cue } from './types'

function ts(s: string): number {
  const m = s.trim().replace(',', '.').match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return NaN
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

const clean = (t: string) =>
  t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\{\\an?\d\}/g, '').replace(/\s*\n\s*/g, ' ').trim()

/** Parse SRT or WebVTT text into cues. Handles YouTube auto-caption rolling duplicates. */
export function parseSubs(raw: string): { start: number; end: number; text: string }[] {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r/g, '')
  const blocks = text.split(/\n{2,}/)
  const out: { start: number; end: number; text: string }[] = []
  for (const b of blocks) {
    const lines = b.split('\n')
    const i = lines.findIndex((l) => l.includes('-->'))
    if (i < 0) continue
    const [a, rest] = lines[i].split('-->')
    const start = ts(a)
    const end = ts(rest.trim().split(/\s+/)[0])
    const t = clean(lines.slice(i + 1).join('\n'))
    if (!t || isNaN(start) || isNaN(end)) continue
    if (/^(Translator|Reviewer):/i.test(t)) continue
    const prev = out[out.length - 1]
    if (prev && prev.text === t && start - prev.end < 0.3) { prev.end = end; continue }
    out.push({ start, end, text: t })
  }
  return out
}

/** Merge a Chinese track onto English cues by time overlap. */
export function mergeBilingual(en: { start: number; end: number; text: string }[], zh?: { start: number; end: number; text: string }[]): Cue[] {
  return en.map((c) => {
    let z: string | undefined
    if (zh?.length) {
      const hits = zh.filter((x) => {
        const mid = (x.start + x.end) / 2
        return mid >= c.start - 0.15 && mid <= c.end + 0.15
      })
      if (hits.length) z = hits.map((h) => h.text).join('')
    }
    return { start: c.start, end: c.end, en: c.text, zh: z }
  })
}

export function parseYouTubeId(input: string): string | null {
  const s = input.trim()
  if (/^[\w-]{11}$/.test(s)) return s
  try {
    const u = new URL(s)
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1, 12) || null
    const v = u.searchParams.get('v')
    if (v) return v
    const m = u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/)
    if (m) return m[1]
  } catch { /* ignore */ }
  return null
}

export const fmtTime = (t: number) => {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

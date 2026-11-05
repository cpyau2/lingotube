import { useEffect, useState } from 'react'
import { lookup } from '../lib/dict'
import { pronounce } from '../lib/tts'
import { db } from '../lib/db'
import { newSrs } from '../lib/srs'
import type { Cue, DictEntry } from '../lib/types'
import { useLiveQuery } from 'dexie-react-hooks'

export interface WordCtx {
  word: string
  cue: Cue
  videoId: string
  videoTitle: string
}

export default function WordSheet({ ctx, onClose }: { ctx: WordCtx; onClose: () => void }) {
  const [entry, setEntry] = useState<DictEntry | null>(null)
  const w = ctx.word.toLowerCase()
  const saved = useLiveQuery(() => db.words.where('word').equals(w).first(), [w])

  useEffect(() => {
    let alive = true
    setEntry(null)
    lookup(ctx.word).then((e) => alive && setEntry(e))
    return () => { alive = false }
  }, [ctx.word])

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const save = async () => {
    if (saved?.id) { await db.words.delete(saved.id); return }
    const first = entry?.meanings[0]
    await db.words.add({
      word: w,
      phonetic: entry?.phonetic,
      audioUrl: entry?.audioUrl,
      zh: entry?.zh,
      definition: first?.defs[0],
      pos: first?.pos,
      context: ctx.cue.en,
      contextZh: ctx.cue.zh,
      videoId: ctx.videoId,
      videoTitle: ctx.videoTitle,
      time: ctx.cue.start,
      createdAt: Date.now(),
      ...newSrs(),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" role="dialog" aria-label={`查詢 ${ctx.word}`} data-testid="word-sheet">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="sheet-in relative w-full md:max-w-md card rounded-b-none md:rounded-b-2xl p-5 max-h-[80dvh] overflow-y-auto safe-b bg-panel">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-3xl font-bold tracking-tight" data-testid="word-title">{entry?.word && entry.word !== w ? entry.word : ctx.word}</div>
            <div className="text-slate-400 text-sm mt-0.5 min-h-5">{entry?.phonetic ?? ''}</div>
          </div>
          <div className="flex gap-2">
            <button className="btn ghost !px-3" onClick={() => pronounce(entry?.word ?? ctx.word, entry?.audioUrl)} aria-label="發音" data-testid="speak-word">🔊</button>
            <button className="btn ghost !px-3" onClick={onClose} aria-label="關閉">✕</button>
          </div>
        </div>

        {!entry && <div className="mt-4 text-slate-400 text-sm">查詢中…</div>}
        {entry && (
          <div className="mt-3 space-y-3">
            {entry.zh && <div className="text-xl text-amber-300 font-medium" data-testid="word-zh">{entry.zh}</div>}
            {entry.meanings.map((m, i) => (
              <div key={i} className="text-sm">
                <span className="text-sky-300 italic mr-2">{m.pos}</span>
                <span className="text-slate-200">{m.defs[0]}</span>
              </div>
            ))}
            {!entry.zh && !entry.meanings.length && (
              <div className="text-sm text-slate-400">暫時查不到解釋（可能離線）。你仍可以儲存這個字，之後上網時再補上。</div>
            )}
            {entry.source !== 'network' && entry.source !== 'none' && (
              <div className="text-[11px] text-slate-500">{entry.source === 'bundled' ? '離線內建字庫' : '來自本機快取'}</div>
            )}
          </div>
        )}

        <div className="mt-4 p-3 rounded-xl bg-ink/60 border border-line text-sm">
          <div className="text-slate-200">{ctx.cue.en}</div>
          {ctx.cue.zh && <div className="text-slate-400 mt-1">{ctx.cue.zh}</div>}
        </div>

        <div className="mt-4 flex gap-2">
          <button className={`btn flex-1 ${saved ? 'ghost' : ''}`} onClick={save} data-testid="save-word">
            {saved ? '✓ 已收藏（點擊移除）' : '＋ 收藏生字'}
          </button>
        </div>
      </div>
    </div>
  )
}

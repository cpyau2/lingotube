import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { Page } from '../components/Page'
import { pronounce, speak } from '../lib/tts'
import { previewInterval, schedule, type Grade } from '../lib/srs'
import type { SentenceRec, WordRec } from '../lib/types'

type Card = { kind: 'word'; rec: WordRec } | { kind: 'sentence'; rec: SentenceRec }

function maskWord(ctx: string, word: string) {
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*`, 'ig')
  return ctx.replace(re, '＿＿＿＿')
}

export default function Review() {
  const [queue, setQueue] = useState<Card[] | null>(null)
  const [i, setI] = useState(0)
  const [show, setShow] = useState(false)
  const [done, setDone] = useState(0)
  const total = useLiveQuery(async () => (await db.words.count()) + (await db.sentences.count()), [], 0)

  const load = async () => {
    const now = Date.now()
    const [w, s] = await Promise.all([db.words.where('dueAt').belowOrEqual(now).toArray(), db.sentences.where('dueAt').belowOrEqual(now).toArray()])
    const cards: Card[] = [...w.map((rec) => ({ kind: 'word' as const, rec })), ...s.map((rec) => ({ kind: 'sentence' as const, rec }))]
    cards.sort((a, b) => a.rec.dueAt - b.rec.dueAt)
    setQueue(cards); setI(0); setShow(false); setDone(0)
  }
  useEffect(() => { load() }, [])

  const card = queue?.[i]
  const grade = async (g: Grade) => {
    if (!card?.rec.id) return
    const upd = schedule(card.rec, g)
    if (card.kind === 'word') await db.words.update(card.rec.id, upd)
    else await db.sentences.update(card.rec.id, upd)
    setDone((d) => d + 1)
    // "again" cards come back at the end of this session
    if (g === 0 && queue) setQueue([...queue, { ...card, rec: { ...card.rec, ...upd } } as Card])
    setI((x) => x + 1); setShow(false)
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!card) return
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setShow(true) }
      if (show && '1234'.includes(e.key)) grade((Number(e.key) - 1) as Grade)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  const progress = useMemo(() => (queue?.length ? Math.min(100, Math.round((i / queue.length) * 100)) : 0), [i, queue])

  if (!queue) return <Page title="複習"><div className="text-slate-400">載入中…</div></Page>

  if (!card) {
    return (
      <Page title="複習">
        <div className="card p-8 text-center space-y-3" data-testid="review-done">
          <div className="text-5xl">{total ? '🎉' : '📭'}</div>
          <div className="text-lg font-semibold">{total ? (done ? `今日完成 ${done} 張卡！` : '而家未有要複習嘅卡') : '未有可複習嘅內容'}</div>
          <p className="text-sm text-slate-400">{total ? '收藏更多生字同句子，或者遲啲再嚟。' : '先去睇片，點字收藏生字，再返嚟複習。'}</p>
          <Link className="btn" to="/">去睇片</Link>
        </div>
      </Page>
    )
  }

  const r = card.rec
  return (
    <Page title="複習" right={<span className="text-sm text-slate-400" data-testid="review-progress">{Math.min(i + 1, queue.length)} / {queue.length}</span>}>
      <div className="h-1.5 rounded-full bg-panel2 mb-4 overflow-hidden"><div className="h-full bg-sky-500 transition-all" style={{ width: `${progress}%` }} /></div>
      <div className="card p-6 min-h-[320px] flex flex-col" data-testid="review-card">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-3">{card.kind === 'word' ? '生字' : '句子'}</div>
        {card.kind === 'word' ? (
          <>
            <div className="flex items-center gap-3">
              <div className="text-4xl font-bold tracking-tight" data-testid="review-front">{(r as WordRec).word}</div>
              <button className="btn ghost !px-3" aria-label="發音" onClick={() => pronounce((r as WordRec).word, (r as WordRec).audioUrl)}>🔊</button>
            </div>
            <div className="mt-4 text-slate-300 italic border-l-2 border-line pl-3">“{show ? (r as WordRec).context : maskWord((r as WordRec).context, (r as WordRec).word)}”</div>
            {show && (
              <div className="mt-5 space-y-2" data-testid="review-back">
                {(r as WordRec).phonetic && <div className="text-slate-400">{(r as WordRec).phonetic}</div>}
                {(r as WordRec).zh && <div className="text-2xl text-amber-300">{(r as WordRec).zh}</div>}
                {(r as WordRec).definition && <div className="text-slate-300">{(r as WordRec).pos && <span className="text-sky-300 italic mr-2">{(r as WordRec).pos}</span>}{(r as WordRec).definition}</div>}
                {(r as WordRec).contextZh && <div className="text-slate-400 text-sm">{(r as WordRec).contextZh}</div>}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-2xl leading-snug font-medium" data-testid="review-front">{(r as SentenceRec).zh ?? (r as SentenceRec).en}</div>
            {show && (
              <div className="mt-5 space-y-3" data-testid="review-back">
                <div className="text-xl text-sky-200">{(r as SentenceRec).en}</div>
                <button className="btn ghost" onClick={() => speak((r as SentenceRec).en)}>🔊 朗讀</button>
              </div>
            )}
            {!(r as SentenceRec).zh && !show && <div className="text-sm text-slate-500 mt-2">（沒有中文，嘗試複述或理解這句）</div>}
          </>
        )}
        <div className="mt-auto pt-6">
          {!show ? (
            <button className="btn w-full !py-3" onClick={() => setShow(true)} data-testid="reveal">顯示答案</button>
          ) : (
            <div className="grid grid-cols-4 gap-2" data-testid="grade-buttons">
              {([['重來', 0, 'bg-rose-600'], ['困難', 1, 'bg-amber-600'], ['良好', 2, 'bg-sky-600'], ['簡單', 3, 'bg-emerald-600']] as const).map(([label, g, c]) => (
                <button key={g} onClick={() => grade(g)} data-testid={`grade-${g}`} className={`${c} text-white rounded-xl py-2.5 flex flex-col items-center`}>
                  <span className="font-semibold">{label}</span>
                  <span className="text-[10px] opacity-80">{previewInterval(r, g)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-3 text-center hidden md:block">快捷鍵：空白鍵＝顯示答案 · 1/2/3/4＝重來/困難/良好/簡單</p>
    </Page>
  )
}

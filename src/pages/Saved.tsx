import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { Page } from '../components/Page'
import { pronounce, speak } from '../lib/tts'
import { fmtTime } from '../lib/subs'

export default function Saved() {
  const [tab, setTab] = useState<'words' | 'sentences'>('words')
  const words = useLiveQuery(() => db.words.orderBy('createdAt').reverse().toArray(), [], [])
  const sentences = useLiveQuery(() => db.sentences.orderBy('createdAt').reverse().toArray(), [], [])
  const [q, setQ] = useState('')
  const f = q.trim().toLowerCase()

  const ws = words.filter((w) => !f || w.word.includes(f) || (w.zh ?? '').includes(f) || w.context.toLowerCase().includes(f))
  const ss = sentences.filter((s) => !f || s.en.toLowerCase().includes(f) || (s.zh ?? '').includes(f))

  return (
    <Page title="生字庫">
      <div className="flex gap-2 mb-4">
        <button className="chip" aria-pressed={tab === 'words'} onClick={() => setTab('words')} data-testid="tab-words">生字 {words.length}</button>
        <button className="chip" aria-pressed={tab === 'sentences'} onClick={() => setTab('sentences')} data-testid="tab-sentences">句子 {sentences.length}</button>
        <input type="text" placeholder="搜尋…" value={q} onChange={(e) => setQ(e.target.value)} className="!w-auto flex-1 !rounded-full !py-1.5" />
      </div>

      {tab === 'words' && (
        <div className="space-y-3" data-testid="word-list">
          {ws.map((w) => (
            <div key={w.id} className="card p-4" data-testid="word-item">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xl font-bold">{w.word}</span>
                    {w.phonetic && <span className="text-slate-400 text-sm">{w.phonetic}</span>}
                    {w.pos && <span className="text-sky-300 text-xs italic">{w.pos}</span>}
                  </div>
                  {w.zh && <div className="text-amber-300">{w.zh}</div>}
                  {w.definition && <div className="text-sm text-slate-300 mt-0.5">{w.definition}</div>}
                  <div className="text-sm text-slate-400 mt-2 border-l-2 border-line pl-3 italic">“{w.context}”</div>
                  <div className="text-[11px] text-slate-500 mt-2 flex gap-3 flex-wrap">
                    {w.videoId && <Link className="text-sky-400 hover:underline" to={`/watch/${w.videoId}`}>▶ {w.videoTitle ?? w.videoId} {w.time != null && fmtTime(w.time)}</Link>}
                    <span>{w.reps === 0 ? '新卡' : `間隔 ${w.interval} 天`}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button className="btn ghost !px-2.5 !py-1.5" aria-label="發音" onClick={() => pronounce(w.word, w.audioUrl)}>🔊</button>
                  <button className="btn ghost !px-2.5 !py-1.5" aria-label="刪除" onClick={() => w.id && db.words.delete(w.id)}>🗑</button>
                </div>
              </div>
            </div>
          ))}
          {!ws.length && <Empty text="未有收藏生字。喺影片字幕入面點任何一個英文字，就可以收藏。" />}
        </div>
      )}

      {tab === 'sentences' && (
        <div className="space-y-3" data-testid="sentence-list">
          {ss.map((s) => (
            <div key={s.id} className="card p-4" data-testid="sentence-item">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-slate-100 leading-snug">{s.en}</div>
                  {s.zh && <div className="text-amber-200/90 text-sm mt-1">{s.zh}</div>}
                  <Link className="text-[11px] text-sky-400 hover:underline mt-2 inline-block" to={`/watch/${s.videoId}`}>▶ {s.videoTitle ?? s.videoId} {fmtTime(s.start)}</Link>
                </div>
                <div className="flex flex-col gap-2">
                  <button className="btn ghost !px-2.5 !py-1.5" aria-label="朗讀" onClick={() => speak(s.en)}>🔊</button>
                  <button className="btn ghost !px-2.5 !py-1.5" aria-label="刪除" onClick={() => s.id && db.sentences.delete(s.id)}>🗑</button>
                </div>
              </div>
            </div>
          ))}
          {!ss.length && <Empty text="未有收藏句子。喺字幕行右邊撳 ☆ 就可以收藏。" />}
        </div>
      )}
    </Page>
  )
}

const Empty = ({ text }: { text: string }) => <div className="card p-8 text-center text-slate-400 text-sm">{text}</div>

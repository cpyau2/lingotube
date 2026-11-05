import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { mergeBilingual, parseSubs, parseYouTubeId, fmtTime } from '../lib/subs'
import { fetchViaProxy, DEFAULT_PROXY } from '../lib/captionsProxy'
import { Page } from '../components/Page'
import type { Cue } from '../lib/types'

async function readFile(f: File | null | undefined) {
  return f ? parseSubs(await f.text()) : undefined
}

async function guessTitle(id: string) {
  try {
    const r = await fetch(`https://noembed.com/embed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`)
    const j = await r.json()
    if (j.title) return j.title as string
  } catch { /* offline */ }
  return `YouTube 影片 ${id}`
}

function AddVideo({ onDone }: { onDone: (id: string) => void }) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const enRef = useRef<HTMLInputElement>(null)
  const zhRef = useRef<HTMLInputElement>(null)

  const submit = async (mode: 'files' | 'proxy') => {
    setErr(''); setBusy(true)
    try {
      const yid = parseYouTubeId(url)
      if (!yid) throw new Error('請貼上有效的 YouTube 連結')
      let cues: Cue[] = []
      let t = title.trim()
      if (mode === 'proxy') {
        const px = (await db.kv.get('proxy-url'))?.value as string | undefined
        const r = await fetchViaProxy(yid, px || DEFAULT_PROXY)
        cues = r.cues; t = t || r.title
      } else {
        const en = await readFile(enRef.current?.files?.[0])
        if (!en?.length) throw new Error('請選擇英文字幕檔（.srt / .vtt），或改用本機字幕代理')
        cues = mergeBilingual(en, await readFile(zhRef.current?.files?.[0]))
      }
      t = t || (await guessTitle(yid))
      await db.videos.put({ id: yid, youtubeId: yid, title: t, cues, createdAt: Date.now() })
      onDone(yid)
    } catch (e: any) {
      setErr(e?.message === 'Failed to fetch' ? '連唔到本機字幕代理（先執行 npm run captions-proxy）' : String(e?.message ?? e))
    } finally { setBusy(false) }
  }

  return (
    <div className="card p-4 space-y-3" data-testid="add-video">
      <div className="font-semibold">＋ 加入 YouTube 影片</div>
      <input type="url" placeholder="貼上 YouTube 連結" value={url} onChange={(e) => setUrl(e.target.value)} />
      <input type="text" placeholder="標題（可留空）" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="grid sm:grid-cols-2 gap-2 text-xs text-slate-400">
        <label className="space-y-1 block">英文字幕 .srt/.vtt<input ref={enRef} type="file" accept=".srt,.vtt,text/vtt" className="block w-full text-slate-300" /></label>
        <label className="space-y-1 block">中文字幕（可選）<input ref={zhRef} type="file" accept=".srt,.vtt,text/vtt" className="block w-full text-slate-300" /></label>
      </div>
      {err && <div className="text-rose-300 text-sm" role="alert">{err}</div>}
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={busy} onClick={() => submit('files')}>匯入字幕檔</button>
        <button className="btn ghost" disabled={busy} onClick={() => submit('proxy')} title="需要先在你電腦執行 npm run captions-proxy">用本機代理抓字幕</button>
      </div>
      <p className="text-xs text-slate-500">瀏覽器不能直接讀取 YouTube 字幕（CORS）。可匯入字幕檔，或在你電腦執行 <code>npm run captions-proxy</code>。</p>
    </div>
  )
}

export default function Home() {
  const videos = useLiveQuery(() => db.videos.orderBy('createdAt').reverse().toArray(), [])
  const nav = useNavigate()
  const [adding, setAdding] = useState(false)

  return (
    <Page title="我的影片" right={<button className="btn ghost" onClick={() => setAdding((a) => !a)}>{adding ? '收起' : '＋ 加影片'}</button>}>
      <p className="text-slate-400 text-sm -mt-3 mb-5">用 YouTube 學英文：中英雙語字幕、點字查詞、生字庫、間隔重複複習。全部資料存喺你部機，無需登入。</p>
      {adding && <div className="mb-5"><AddVideo onDone={(id) => nav(`/watch/${id}`)} /></div>}
      <div className="grid sm:grid-cols-2 gap-4" data-testid="video-list">
        {videos?.map((v) => (
          <Link key={v.id} to={`/watch/${v.id}`} className="card overflow-hidden group hover:border-sky-500/60 transition-colors" data-testid="video-card">
            <div className="relative aspect-video bg-gradient-to-br from-slate-800 to-slate-900">
              <img src={`https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg`} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
              <div className="absolute inset-0 grid place-items-center"><div className="w-12 h-12 rounded-full bg-black/55 grid place-items-center text-xl group-hover:bg-sky-500 group-hover:text-black transition-colors">▶</div></div>
              {v.demo && <span className="absolute top-2 left-2 text-[11px] bg-emerald-500 text-black font-semibold px-2 py-0.5 rounded-full">示範 · 中英字幕</span>}
              <span className="absolute bottom-2 right-2 text-[11px] bg-black/70 px-1.5 rounded">{v.cues.length ? fmtTime(v.cues.at(-1)!.end) : ''}</span>
            </div>
            <div className="p-3">
              <div className="font-medium leading-snug line-clamp-2">{v.title}</div>
              <div className="text-xs text-slate-400 mt-1">{v.cues.length} 句字幕 · {v.cues.some((c) => c.zh) ? '中英雙語' : '只有英文'}</div>
            </div>
          </Link>
        ))}
      </div>
    </Page>
  )
}

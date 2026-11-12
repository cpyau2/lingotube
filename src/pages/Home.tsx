import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, deleteVideo, deleteVideos } from '../lib/db'
import { mergeBilingual, parseSubtitleText, parseYouTubeId, fmtTime } from '../lib/subs'
import { fetchAutoCaptions } from '../lib/autoCaptions'
import { fetchViaProxy, DEFAULT_PROXY } from '../lib/captionsProxy'
import { Page } from '../components/Page'
import type { Cue } from '../lib/types'

async function readFile(f: File | null | undefined) {
  return f ? parseSubtitleText(await f.text()) : undefined
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
  const [pasteEn, setPasteEn] = useState('')
  const [pasteZh, setPasteZh] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [progress, setProgress] = useState('')
  const [busy, setBusy] = useState(false)
  const enRef = useRef<HTMLInputElement>(null)
  const zhRef = useRef<HTMLInputElement>(null)

  const save = async (yid: string, t: string, cues: Cue[]) => {
    t = t.trim() || (await guessTitle(yid))
    await db.videos.put({ id: yid, youtubeId: yid, title: t, cues, createdAt: Date.now() })
    onDone(yid)
  }

  const submit = async (mode: 'auto' | 'files' | 'paste' | 'proxy') => {
    setErr(''); setInfo(''); setBusy(true)
    const timers: number[] = []
    try {
      const yid = parseYouTubeId(url)
      if (!yid) throw new Error('請先貼上有效嘅 YouTube 連結（例如 https://youtu.be/xxxxxxxxxxx）')
      if (mode === 'auto') {
        setProgress('連接 YouTube…')
        timers.push(window.setTimeout(() => setProgress('下載字幕…'), 1500), window.setTimeout(() => setProgress('翻譯成中文（可能要幾秒）…'), 4000))
        const r = await fetchAutoCaptions(yid, (n) => setProgress(`YouTube 暫時未肯俾字幕，重試第 ${n} 次…`))
        if (!title.trim()) setTitle(r.title)
        setProgress(`已取得 ${r.cues.length} 句字幕，儲存中…`)
        if (r.note) setInfo(r.note)
        await save(yid, title.trim() || r.title, r.cues)
        return
      }
      if (mode === 'proxy') {
        const px = (await db.kv.get('proxy-url'))?.value as string | undefined
        const r = await fetchViaProxy(yid, px || DEFAULT_PROXY)
        await save(yid, title.trim() || r.title, r.cues)
        return
      }
      if (mode === 'paste') {
        const en = parseSubtitleText(pasteEn)
        if (!en.length) throw new Error('未有可用嘅英文字幕文字。請貼上 SRT / VTT，或者 YouTube「顯示轉錄稿」複製出嚟、有時間（例如 0:05）嘅文字。')
        const zh = pasteZh.trim() ? parseSubtitleText(pasteZh) : undefined
        await save(yid, title, mergeBilingual(en, zh))
        return
      }
      const enFile = enRef.current?.files?.[0]
      if (!enFile) throw new Error('未揀字幕檔：請喺「英文字幕」撳「選擇檔案」，揀一個 .srt、.vtt 或 .txt 檔（中文字幕可選）。或者改用上面「自動抓字幕」／「貼上字幕文字」。')
      const en = await readFile(enFile)
      if (!en?.length) throw new Error('呢個檔案讀唔到字幕，請確認係 .srt、.vtt，或者 .txt（一行時間如 0:05，下一行字幕）格式')
      await save(yid, title, mergeBilingual(en, await readFile(zhRef.current?.files?.[0])))
    } catch (e: any) {
      setErr(e?.message === 'Failed to fetch' ? '連唔到本機字幕代理（先執行 npm run captions-proxy）' : String(e?.message ?? e))
    } finally { timers.forEach(clearTimeout); setProgress(''); setBusy(false) }
  }

  return (
    <div className="card p-4 space-y-3" data-testid="add-video">
      <div className="font-semibold">＋ 加入 YouTube 影片</div>
      <input type="url" inputMode="url" placeholder="貼上 YouTube 連結" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="add-url" />
      <input type="text" placeholder="標題（可留空，會自動填入）" value={title} onChange={(e) => setTitle(e.target.value)} />
      <button className="btn w-full !py-3 text-base" disabled={busy || !url.trim()} onClick={() => submit('auto')} data-testid="auto-fetch">
        {busy && progress ? <span className="animate-pulse">⏳ {progress}</span> : '✨ 自動抓字幕'}
      </button>
      {info && <div className="text-amber-300 text-sm" data-testid="add-info">{info}</div>}
      {err && <div className="text-rose-300 text-sm" role="alert" data-testid="add-error">{err}</div>}

      <div className="rounded-xl border border-line p-3" data-testid="manual-import">
        <div className="text-sm text-slate-300">自動抓唔到？手動匯入字幕</div>
        <div className="mt-3 space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">貼上字幕文字</div>
            <textarea className="w-full min-h-28 bg-ink border border-line rounded-xl p-2.5 text-sm" placeholder={'貼上 SRT / VTT，或者 YouTube「顯示轉錄稿」複製嘅文字（例如：\n0:05\nHello everyone…）'} value={pasteEn} onChange={(e) => setPasteEn(e.target.value)} data-testid="paste-en" />
            <textarea className="w-full min-h-16 bg-ink border border-line rounded-xl p-2.5 text-sm" placeholder="中文字幕文字（可留空）" value={pasteZh} onChange={(e) => setPasteZh(e.target.value)} />
            <button className="btn ghost" disabled={busy} onClick={() => submit('paste')} data-testid="paste-submit">用貼上嘅字幕加入</button>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">匯入字幕檔</div>
            <div className="grid sm:grid-cols-2 gap-2 text-xs text-slate-400">
              <label className="space-y-1 block">英文字幕 .srt/.vtt/.txt<input ref={enRef} type="file" accept=".srt,.vtt,.txt,text/vtt,text/plain" className="block w-full text-slate-300" /></label>
              <label className="space-y-1 block">中文字幕（可選）<input ref={zhRef} type="file" accept=".srt,.vtt,.txt,text/vtt,text/plain" className="block w-full text-slate-300" /></label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn ghost" disabled={busy} onClick={() => submit('files')}>匯入字幕檔</button>
              <button className="btn ghost" disabled={busy} onClick={() => submit('proxy')} title="需要先在你電腦執行 npm run captions-proxy">用本機代理抓字幕</button>
            </div>
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-500">「自動抓字幕」會由伺服器讀取 YouTube 字幕（優先人手字幕，其次自動字幕），中文用現成中文字幕或機器翻譯。</p>
    </div>
  )
}

export default function Home() {
  const videos = useLiveQuery(() => db.videos.orderBy('createdAt').reverse().toArray(), [])
  const nav = useNavigate()
  const [adding, setAdding] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<string | null>(null)

  const toggleSelect = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const handleDeleteOne = async (id: string) => {
    if (!deleting) return
    try {
      await deleteVideo(id)
      setDeleting(null)
    } catch (e: any) {
      alert('刪除失敗：' + (e?.message ?? e))
    }
  }

  const handleDeleteBatch = async () => {
    if (selected.size === 0) return
    if (!confirm(`確定要刪除 ${selected.size} 個影片？所有相關嘅生字同句子都會一併刪除，無法復原。`)) return
    try {
      await deleteVideos(Array.from(selected))
      setSelected(new Set())
      setSelectMode(false)
    } catch (e: any) {
      alert('批次刪除失敗：' + (e?.message ?? e))
    }
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelected(new Set())
  }

  return (
    <Page
      title="我的影片"
      right={
        selectMode ? (
          <div className="flex gap-2">
            <button className="btn ghost text-sm" onClick={exitSelectMode}>取消</button>
            <button
              className="btn text-sm bg-rose-600 hover:bg-rose-700 disabled:opacity-50"
              disabled={selected.size === 0}
              onClick={handleDeleteBatch}
            >
              刪除 {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            {videos && videos.length > 0 && (
              <button className="btn ghost text-sm" onClick={() => setSelectMode(true)}>選取</button>
            )}
            <button className="btn ghost" onClick={() => setAdding((a) => !a)}>{adding ? '收起' : '＋ 加影片'}</button>
          </div>
        )
      }
    >
      <p className="text-slate-400 text-sm -mt-3 mb-5">用 YouTube 學英文：中英雙語字幕、點字查詞、生字庫、間隔重複複習。全部資料存喺你部機，無需登入。</p>
      {adding && <div className="mb-5"><AddVideo onDone={(id) => nav(`/watch/${id}`)} /></div>}
      <div className="grid sm:grid-cols-2 gap-4" data-testid="video-list">
        {videos?.map((v) => (
          <div key={v.id} className="relative" data-testid="video-card">
            {selectMode ? (
              <button
                onClick={() => toggleSelect(v.id)}
                className={`card overflow-hidden w-full text-left transition-all ${
                  selected.has(v.id) ? 'border-sky-500 bg-sky-500/10' : 'hover:border-sky-500/60'
                }`}
              >
                <div className="relative aspect-video bg-gradient-to-br from-slate-800 to-slate-900">
                  <img src={`https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg`} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                  <div className="absolute inset-0 grid place-items-center">
                    <div className={`w-8 h-8 rounded border-2 ${selected.has(v.id) ? 'bg-sky-500 border-sky-500' : 'bg-black/40 border-white/40'} grid place-items-center text-lg`}>
                      {selected.has(v.id) && '✓'}
                    </div>
                  </div>
                  {v.demo && <span className="absolute top-2 left-2 text-[11px] bg-emerald-500 text-black font-semibold px-2 py-0.5 rounded-full">示範 · 中英字幕</span>}
                  <span className="absolute bottom-2 right-2 text-[11px] bg-black/70 px-1.5 rounded">{v.cues.length ? fmtTime(v.cues.at(-1)!.end) : ''}</span>
                </div>
                <div className="p-3">
                  <div className="font-medium leading-snug line-clamp-2">{v.title}</div>
                  <div className="text-xs text-slate-400 mt-1">{v.cues.length} 句字幕 · {v.cues.some((c) => c.zh) ? '中英雙語' : '只有英文'}</div>
                </div>
              </button>
            ) : (
              <>
                <Link to={`/watch/${v.id}`} className="card overflow-hidden group hover:border-sky-500/60 transition-colors block">
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
                <button
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/70 hover:bg-rose-600 grid place-items-center text-lg transition-colors z-10"
                  onClick={(e) => {
                    e.preventDefault()
                    setDeleting(v.id)
                  }}
                  title="刪除影片"
                >
                  ×
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {deleting && (
        <div className="fixed inset-0 bg-black/60 grid place-items-center z-50 p-4" onClick={() => setDeleting(null)}>
          <div className="card max-w-sm w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold text-lg">確定要刪除影片？</div>
            <p className="text-slate-300 text-sm">
              所有相關嘅生字同句子都會一併刪除，無法復原。
            </p>
            <div className="flex gap-3 justify-end">
              <button className="btn ghost" onClick={() => setDeleting(null)}>取消</button>
              <button className="btn bg-rose-600 hover:bg-rose-700" onClick={() => handleDeleteOne(deleting)}>
                確定刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </Page>
  )
}

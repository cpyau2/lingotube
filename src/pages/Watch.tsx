import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, defaultPrefs } from '../lib/db'
import { useYouTube } from '../lib/player'
import { fmtTime } from '../lib/subs'
import { speak } from '../lib/tts'
import { newSrs } from '../lib/srs'
import type { Cue, SentenceRec, VideoPrefs, VideoRec } from '../lib/types'
import WordSheet, { type WordCtx } from '../components/WordSheet'
import { StructurePanel } from '../components/StructurePanel'
import { ExercisePanel } from '../components/ExercisePanel'
import { ShadowPanel } from '../components/ShadowPanel'

const WORD_RE = /([A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*)/g
const RATES = [0.75, 1, 1.25, 1.5]

type Tab = 'subs' | 'structure' | 'exercise' | 'shadow'

const CueRow = memo(function CueRow(props: {
  cue: Cue; idx: number; active: boolean; prefs: VideoPrefs; saved: boolean; savedWords: Set<string>
  onSeek: (i: number) => void; onWord: (w: string, i: number) => void; onSave: (i: number) => void; onStructure: (i: number) => void
}) {
  const { cue, idx, active, prefs, saved, savedWords } = props
  const parts = useMemo(() => cue.en.split(WORD_RE), [cue.en])
  return (
    <div
      data-idx={idx}
      data-active={active}
      data-testid="cue"
      onClick={() => props.onSeek(idx)}
      className={`group relative flex gap-3 px-3 py-2.5 rounded-xl cursor-pointer border transition-colors ${active ? 'bg-sky-500/10 border-sky-400/50' : 'border-transparent hover:bg-panel'}`}
    >
      <div className={`text-[11px] tabular-nums pt-1 w-9 shrink-0 ${active ? 'text-sky-300' : 'text-slate-500'}`}>{fmtTime(cue.start)}</div>
      <div className="flex-1 min-w-0" style={{ fontSize: `${prefs.fontScale}rem` }}>
        {prefs.showEn && (
          <div className={`leading-snug ${active ? 'text-white font-medium' : 'text-slate-200'}`} lang="en">
            {parts.map((p, i) =>
              i % 2 === 1 ? (
                <span
                  key={i}
                  role="button"
                  className={`word ${savedWords.has(p.toLowerCase()) ? 'saved' : ''}`}
                  onClick={(e) => { e.stopPropagation(); props.onWord(p, idx) }}
                >{p}</span>
              ) : (<span key={i}>{p}</span>),
            )}
          </div>
        )}
        {prefs.showZh && cue.zh && (
          <div className={`mt-0.5 leading-snug ${active ? 'text-amber-200' : 'text-slate-400'}`} style={{ fontSize: '0.92em' }} lang="zh-Hant">{cue.zh}</div>
        )}
      </div>
      <div className="flex flex-col gap-1 shrink-0 -mr-1">
        <button aria-label="收藏句子" data-testid="save-sentence" title="收藏句子"
          onClick={(e) => { e.stopPropagation(); props.onSave(idx) }}
          className={`text-lg leading-none p-1 rounded ${saved ? 'text-amber-300' : 'text-slate-500 hover:text-slate-200'}`}>{saved ? '★' : '☆'}</button>
        <button aria-label="朗讀" title="朗讀" onClick={(e) => { e.stopPropagation(); speak(cue.en) }} className="text-sm leading-none p-1 text-slate-500 hover:text-slate-200">🔊</button>
        <button aria-label="句子結構" title="句子結構" onClick={(e) => { e.stopPropagation(); props.onStructure(idx) }} className="text-sm leading-none p-1 text-slate-500 hover:text-slate-200">🧩</button>
      </div>
    </div>
  )
})

export default function Watch() {
  const { id = '' } = useParams()
  const video = useLiveQuery(() => db.videos.get(id), [id])
  const [prefs, setPrefs] = useState<VideoPrefs>(defaultPrefs(id))
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [tab, setTab] = useState<Tab>('subs')
  const [active, setActive] = useState(-1)
  const [wordCtx, setWordCtx] = useState<WordCtx | null>(null)
  const [structIdx, setStructIdx] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const loopRef = useRef(-1)
  const loopOnRef = useRef(false)
  const resumeRef = useRef(false)
  const cuesRef = useRef<Cue[]>([])
  cuesRef.current = video?.cues ?? []

  const sentences = useLiveQuery(() => db.sentences.where('videoId').equals(id).toArray(), [id], [] as SentenceRec[])
  const savedStarts = useMemo(() => new Set(sentences.map((s) => s.start)), [sentences])
  const words = useLiveQuery(() => db.words.toArray(), [], [])
  const savedWords = useMemo(() => new Set(words.map((w) => w.word)), [words])

  const { status, get } = useYouTube('yt-player', video?.youtubeId ?? '', () => (cuesRef.current.at(-1)?.end ?? 60) + 2)

  // prefs load/save
  useEffect(() => {
    setPrefsLoaded(false)
    loopRef.current = -1 // don't keep a locked line from the previous video
    db.prefs.get(id).then((p) => { setPrefs(p ?? defaultPrefs(id)); setPrefsLoaded(true) })
  }, [id])
  const setPref = <K extends keyof VideoPrefs>(k: K, v: VideoPrefs[K]) => {
    setPrefs((p) => { const n = { ...p, [k]: v }; db.prefs.put(n); return n })
  }
  useEffect(() => { if (prefsLoaded) get()?.setRate(prefs.rate) }, [prefs.rate, status, prefsLoaded])

  // time polling -> active cue
  useEffect(() => {
    const iv = setInterval(() => {
      const p = get(); const cues = cuesRef.current
      if (!p || !cues.length) return
      const t = p.getTime()
      const lc = loopOnRef.current && loopRef.current >= 0 ? cues[loopRef.current] : undefined
      if (lc && t >= lc.end && t < lc.end + 1.5) { p.seek(lc.start + 0.01); return }
      let idx = -1
      for (let i = 0; i < cues.length; i++) { if (t >= cues[i].start - 0.05) idx = i; else break }
      if (idx >= 0 && t > cues[idx].end + 1.5) idx = -1 // long gap: nothing highlighted
      // loop on but no line locked yet (e.g. saved pref on reload, or toggled before playback): lock the first line that plays
      // user scrubbed far away from the looped line: follow them and loop the new line
      if (loopOnRef.current && idx >= 0 && (loopRef.current < 0 || (lc && (t < lc.start - 1 || t >= lc.end + 1.5)))) loopRef.current = idx
      setActive((a) => (a === idx ? a : idx))
    }, 120)
    return () => clearInterval(iv)
  }, [get, status])

  // auto-scroll
  useEffect(() => {
    if (!prefs.autoScroll || active < 0 || tab !== 'subs') return
    const box = listRef.current
    const row = box?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    if (!box || !row) return
    const target = row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2
    box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [active, prefs.autoScroll, tab])

  useEffect(() => {
    loopOnRef.current = prefs.loopLine
    loopRef.current = prefs.loopLine ? (loopRef.current >= 0 ? loopRef.current : active) : -1
  }, [prefs.loopLine])

  const onSeek = useCallback((i: number) => {
    const p = get(); const c = cuesRef.current[i]
    if (!p || !c) return
    if (loopOnRef.current) loopRef.current = i
    p.seek(c.start + 0.01); p.play(); setActive(i)
  }, [get])

  const onWord = useCallback((w: string, i: number) => {
    const p = get()
    if (prefs.pauseOnWordTap && p) { resumeRef.current = p.isPlaying(); p.pause() } else resumeRef.current = false
    setWordCtx({ word: w, cue: cuesRef.current[i], videoId: id, videoTitle: video?.title ?? '' })
  }, [get, prefs.pauseOnWordTap, id, video?.title])

  const closeWord = useCallback(() => {
    setWordCtx(null)
    if (resumeRef.current) get()?.play()
    resumeRef.current = false
  }, [get])

  const onSave = useCallback(async (i: number) => {
    const c = cuesRef.current[i]; if (!c) return
    const ex = await db.sentences.where('videoId').equals(id).and((s) => s.start === c.start).first()
    if (ex?.id) { await db.sentences.delete(ex.id); return }
    await db.sentences.add({ en: c.en, zh: c.zh, videoId: id, videoTitle: video?.title, start: c.start, end: c.end, createdAt: Date.now(), ...newSrs() })
  }, [id, video?.title])

  const onStructure = useCallback((i: number) => { setStructIdx(i); setTab('structure') }, [])

  if (video === undefined) return <div className="p-6 text-slate-400">載入中…</div>
  if (!video) return <div className="p-6"><p className="mb-3">找不到這部影片。</p><Link className="btn" to="/">返回首頁</Link></div>

  const toggles: { k: keyof VideoPrefs; label: string }[] = [
    { k: 'showEn', label: 'EN 英文' },
    { k: 'showZh', label: '中 中文' },
    { k: 'autoScroll', label: '自動捲動' },
    { k: 'loopLine', label: '單句循環' },
    { k: 'pauseOnWordTap', label: '點字暫停' },
  ]
  const tabs: { k: Tab; label: string; soon?: boolean }[] = [
    { k: 'subs', label: '字幕' },
    { k: 'structure', label: '句型' },
    { k: 'exercise', label: '練習' },
    { k: 'shadow', label: '跟讀' },
  ]
  const curCue = structIdx != null ? video.cues[structIdx] : null

  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row">
      {/* left: player + controls */}
      <section className="md:w-[56%] md:max-w-[880px] shrink-0 md:flex md:flex-col md:border-r border-line md:p-4 md:gap-3 bg-ink z-10">
        <div className="relative w-full aspect-video bg-black md:rounded-2xl overflow-hidden">
          <div id="yt-player" className="absolute inset-0 [&_iframe]:w-full [&_iframe]:h-full" data-status={status} />
          {status === 'loading' && <div className="absolute inset-0 grid place-items-center text-slate-400 text-sm pointer-events-none">載入播放器…</div>}
          {(status === 'fallback' || status === 'embed-blocked') && (
            <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-slate-900 to-slate-800 p-4 text-center" data-testid="player-fallback">
              <div>
                <div className="text-sm text-slate-300 mb-3">
                  {status === 'embed-blocked' ? '這部影片不允許嵌入播放。' : '無法載入 YouTube 播放器（可能離線）。'}
                  <br />字幕仍可閱讀，你可以用計時器模式跟著看。
                </div>
                <div className="flex gap-2 justify-center">
                  <button className="btn" onClick={() => { const p = get(); p?.isPlaying() ? p.pause() : p?.play() }}>▶/⏸ 計時器</button>
                  <a className="btn ghost" target="_blank" rel="noreferrer" href={`https://www.youtube.com/watch?v=${video.youtubeId}`}>在 YouTube 開啟</a>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-3 pt-2 md:px-0 md:pt-0">
          <h1 className="font-semibold leading-snug line-clamp-2 text-[15px] md:text-lg">{video.title}</h1>
        </div>
        <div className="flex gap-2 overflow-x-auto px-3 py-2 md:px-0 md:flex-wrap" aria-label="字幕設定">
          {toggles.map((t) => (
            <button key={t.k} className="chip" aria-pressed={prefs[t.k] as boolean} data-testid={`toggle-${t.k}`} onClick={() => setPref(t.k, !prefs[t.k] as never)}>{t.label}</button>
          ))}
          <button className="chip" onClick={() => setPref('rate', RATES[(RATES.indexOf(prefs.rate) + 1) % RATES.length])} data-testid="rate">速度 {prefs.rate}×</button>
          <button className="chip" onClick={() => setPref('fontScale', prefs.fontScale >= 1.4 ? 0.9 : +(prefs.fontScale + 0.15).toFixed(2))}>字體 {Math.round(prefs.fontScale * 100)}%</button>
        </div>

        {/* desktop: big "now playing" line */}
        <div className="hidden md:block card p-4 min-h-[120px]" data-testid="now-line">
          {active >= 0 && video.cues[active] ? (
            <>
              {prefs.showEn && (
                <div className="text-2xl leading-snug font-medium" lang="en">
                  {video.cues[active].en.split(WORD_RE).map((p, i) => i % 2 === 1
                    ? <span key={i} role="button" className={`word ${savedWords.has(p.toLowerCase()) ? 'saved' : ''}`} onClick={() => onWord(p, active)}>{p}</span>
                    : <span key={i}>{p}</span>)}
                </div>
              )}
              {prefs.showZh && video.cues[active].zh && <div className="text-xl text-amber-200 mt-2" lang="zh-Hant">{video.cues[active].zh}</div>}
            </>
          ) : <div className="text-slate-500 text-sm">播放時，目前的句子會顯示在這裡。點任何英文字可以查詞。</div>}
        </div>
      </section>

      {/* right: tabs + content */}
      <section className="flex-1 min-h-0 min-w-0 flex flex-col">
        <div className="flex border-b border-line px-2 shrink-0">
          {tabs.map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)} data-testid={`tab-${t.k}`}
              className={`px-3 py-2.5 text-sm border-b-2 -mb-px ${tab === t.k ? 'border-sky-400 text-sky-300 font-semibold' : 'border-transparent text-slate-400'}`}>
              {t.label}{t.soon && <span className="ml-1 text-[9px] align-top text-amber-400">soon</span>}
            </button>
          ))}
          <div className="ml-auto self-center pr-2 text-xs text-slate-500">{video.cues.length} 句</div>
        </div>

        {tab === 'subs' && (
          <div ref={listRef} className="flex-1 min-h-0 scroll-y relative p-2 space-y-0.5" data-testid="cue-list">
            {video.cues.map((c, i) => (
              <CueRow key={i} cue={c} idx={i} active={i === active} prefs={prefs} saved={savedStarts.has(c.start)} savedWords={savedWords}
                onSeek={onSeek} onWord={onWord} onSave={onSave} onStructure={onStructure} />
            ))}
            {!video.cues.length && <div className="p-6 text-slate-400 text-sm">這部影片未有字幕。到首頁匯入 .srt / .vtt / .txt。</div>}
            <div className="h-24" />
          </div>
        )}
        {tab === 'structure' && (
          <div className="p-4 space-y-3 scroll-y">
            {curCue ? (
              <>
                <div className="card p-3 text-sm">
                  <div className="text-slate-200">{curCue.en}</div>
                  {curCue.zh && <div className="text-slate-400 mt-1">{curCue.zh}</div>}
                </div>
                <StructurePanel sentence={curCue.en} />
              </>
            ) : (
              <div className="card p-4 text-center text-slate-400 text-sm">
                點擊字幕列右側的 🧩 按鈕查看句型解釋
              </div>
            )}
          </div>
        )}
        {tab === 'exercise' && (
          <div className="p-4 scroll-y">
            <ExercisePanel videoId={id} cues={video.cues} />
          </div>
        )}
        {tab === 'shadow' && (
          <div className="p-4 scroll-y">
            <ShadowPanel cues={video.cues} currentIdx={active} videoId={id} player={get()} />
          </div>
        )}
      </section>

      {wordCtx && <WordSheet ctx={wordCtx} onClose={closeWord} />}
    </div>
  )
}

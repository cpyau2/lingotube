import { useCallback, useEffect, useRef, useState } from 'react'

export interface PlayerApi {
  getTime(): number
  seek(t: number): void
  play(): void
  pause(): void
  isPlaying(): boolean
  setRate(r: number): void
}

declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void }
}

let apiPromise: Promise<void> | null = null
function loadYT(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve() }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.onerror = () => { apiPromise = null; reject(new Error('offline')) }
    document.head.appendChild(s)
    setTimeout(() => { if (!window.YT?.Player) { apiPromise = null; reject(new Error('timeout')) } }, 10000)
  })
  return apiPromise
}

/** A stand-in clock used when the YouTube player can't load (offline / blocked): subtitles stay usable. */
class VirtualPlayer implements PlayerApi {
  private t = 0
  private playing = false
  private last = 0
  private rate = 1
  constructor(private duration: () => number) {}
  private tick() {
    if (this.playing) {
      const now = performance.now()
      this.t = Math.min(this.duration(), this.t + ((now - this.last) / 1000) * this.rate)
      this.last = now
      if (this.t >= this.duration()) this.playing = false
    }
  }
  getTime() { this.tick(); return this.t }
  seek(t: number) { this.tick(); this.t = Math.max(0, t); this.last = performance.now() }
  play() { this.tick(); this.playing = true; this.last = performance.now() }
  pause() { this.tick(); this.playing = false }
  isPlaying() { this.tick(); return this.playing }
  setRate(r: number) { this.tick(); this.rate = r }
}

export type PlayerStatus = 'loading' | 'ready' | 'fallback' | 'embed-blocked'

export function useYouTube(containerId: string, videoId: string, duration: () => number) {
  const [status, setStatus] = useState<PlayerStatus>('loading')
  const apiRef = useRef<PlayerApi | null>(null)
  const durRef = useRef(duration)
  durRef.current = duration

  useEffect(() => {
    let cancelled = false
    let yt: any = null
    setStatus('loading')
    apiRef.current = null
    if (!videoId) return
    const fallback = (s: PlayerStatus) => {
      if (cancelled) return
      apiRef.current = new VirtualPlayer(() => durRef.current())
      setStatus(s)
    }
    loadYT()
      .then(() => {
        if (cancelled) return
        const el = document.getElementById(containerId)
        if (!el) return
        el.innerHTML = '<div id="' + containerId + '-inner"></div>'
        yt = new window.YT.Player(containerId + '-inner', {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, cc_load_policy: 0, iv_load_policy: 3, origin: location.origin },
          events: {
            onReady: () => {
              if (cancelled) return
              // LingoTube draws its own bilingual subtitles; hide YouTube's built-in captions to avoid doubles
              try { yt.unloadModule?.('captions'); yt.unloadModule?.('cc') } catch { /* noop */ }
              apiRef.current = {
                getTime: () => yt.getCurrentTime?.() ?? 0,
                seek: (t) => yt.seekTo(t, true),
                play: () => yt.playVideo(),
                pause: () => yt.pauseVideo(),
                isPlaying: () => yt.getPlayerState?.() === 1,
                setRate: (r) => yt.setPlaybackRate?.(r),
              }
              setStatus('ready')
            },
            onStateChange: (e: any) => { if (e?.data === 1) { try { yt.unloadModule?.('captions'); yt.unloadModule?.('cc') } catch { /* noop */ } } },
            onError: (e: any) => {
              if (e?.data === 101 || e?.data === 150 || e?.data === 153) fallback('embed-blocked')
              else fallback('fallback')
            },
          },
        })
      })
      .catch(() => fallback('fallback'))
    return () => {
      cancelled = true
      try { yt?.destroy?.() } catch { /* noop */ }
    }
  }, [containerId, videoId])

  const get = useCallback(() => apiRef.current, [])
  return { status, get }
}

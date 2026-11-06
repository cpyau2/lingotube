import { useEffect, useRef, useState } from 'react'
import type { Cue } from '../lib/types'
import { speak } from '../lib/tts'

interface Props {
  cues: Cue[]
  currentIdx: number
}

interface Recognition {
  start: () => void
  stop: () => void
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: (event: any) => void
  onerror: (event: any) => void
  onend: () => void
}

declare global {
  interface Window {
    SpeechRecognition: any
    webkitSpeechRecognition: any
  }
}

function getSpeechRecognition(): any {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1].toLowerCase() === b[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1
      }
    }
  }
  return dp[m][n]
}

function calculateScore(target: string, recognized: string): number {
  if (!recognized.trim()) return 0
  const distance = levenshtein(target, recognized)
  const maxLen = Math.max(target.length, recognized.length)
  const accuracy = Math.max(0, 1 - distance / maxLen)
  return Math.round(accuracy * 100)
}

function getMissedWords(target: string, recognized: string): string[] {
  const targetWords = target.toLowerCase().split(/\s+/)
  const recognizedWords = recognized.toLowerCase().split(/\s+/)
  const recognizedSet = new Set(recognizedWords)
  return targetWords.filter((w) => !recognizedSet.has(w))
}

export function ShadowPanel({ cues, currentIdx }: Props) {
  const [idx, setIdx] = useState(Math.max(0, currentIdx))
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [score, setScore] = useState<number | null>(null)
  const [error, setError] = useState('')
  const recognitionRef = useRef<Recognition | null>(null)

  const SpeechRecog = getSpeechRecognition()
  const supported = !!SpeechRecog

  useEffect(() => {
    if (!SpeechRecog) return
    const recognition = new SpeechRecog() as Recognition
    recognition.lang = 'en-US'
    recognition.continuous = false
    recognition.interimResults = false

    recognition.onresult = (event: any) => {
      const result = event.results[0][0].transcript
      setTranscript(result)
      const cue = cues[idx]
      if (cue) {
        const s = calculateScore(cue.en, result)
        setScore(s)
      }
      setListening(false)
    }

    recognition.onerror = (event: any) => {
      setError(`錯誤：${event.error}`)
      setListening(false)
    }

    recognition.onend = () => {
      setListening(false)
    }

    recognitionRef.current = recognition

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch {}
      }
    }
  }, [SpeechRecog, idx, cues])

  const startListening = () => {
    if (!recognitionRef.current) return
    setTranscript('')
    setScore(null)
    setError('')
    setListening(true)
    try {
      recognitionRef.current.start()
    } catch (e: any) {
      setError(e.message)
      setListening(false)
    }
  }

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
    setListening(false)
  }

  const nextCue = () => {
    if (idx < cues.length - 1) {
      setIdx(idx + 1)
      setTranscript('')
      setScore(null)
      setError('')
    }
  }

  const prevCue = () => {
    if (idx > 0) {
      setIdx(idx - 1)
      setTranscript('')
      setScore(null)
      setError('')
    }
  }

  const playAudio = () => {
    const cue = cues[idx]
    if (cue) speak(cue.en)
  }

  if (!supported) {
    return (
      <div className="card p-6 bg-amber-500/10 border-amber-500/30">
        <div className="text-amber-300 font-medium mb-2">🎙️ 語音辨識不支援</div>
        <p className="text-sm text-slate-300 mb-3">
          這個瀏覽器不支援 Web Speech API（語音辨識）。請使用 Chrome 或 Safari。
        </p>
        <p className="text-xs text-slate-400">
          你仍可以點「播放」聽句子，然後自己跟讀練習。
        </p>
      </div>
    )
  }

  const cue = cues[idx]
  if (!cue) return null

  const missed = transcript && score !== null ? getMissedWords(cue.en, transcript) : []

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="text-xs text-slate-500 mb-2">
          句子 {idx + 1} / {cues.length}
        </div>
        <div className="text-lg text-slate-200 mb-2" lang="en">
          {cue.en}
        </div>
        {cue.zh && <div className="text-sm text-slate-400" lang="zh-Hant">{cue.zh}</div>}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button className="btn" onClick={playAudio}>
          🔊 播放
        </button>
        {!listening ? (
          <button className="btn" onClick={startListening}>
            🎙️ 開始跟讀
          </button>
        ) : (
          <button className="btn bg-rose-600 hover:bg-rose-700" onClick={stopListening}>
            ⏹️ 停止
          </button>
        )}
        <button className="btn ghost" onClick={prevCue} disabled={idx === 0}>
          ← 上一句
        </button>
        <button className="btn ghost" onClick={nextCue} disabled={idx === cues.length - 1}>
          下一句 →
        </button>
      </div>

      {listening && (
        <div className="card p-4 bg-sky-500/10 border-sky-500/30 text-center">
          <div className="text-sky-300 font-medium animate-pulse">🎙️ 聽緊你講嘢…</div>
        </div>
      )}

      {error && (
        <div className="card p-4 bg-rose-500/10 border-rose-500/30">
          <div className="text-rose-300 text-sm">{error}</div>
        </div>
      )}

      {transcript && (
        <div className="space-y-3">
          <div className="card p-4">
            <div className="text-xs text-slate-500 mb-1">你講咗</div>
            <div className="text-slate-200">{transcript}</div>
          </div>

          {score !== null && (
            <div className="card p-4">
              <div className="text-xs text-slate-500 mb-2">評分</div>
              <div className="flex items-center gap-3 mb-3">
                <div
                  className={`text-3xl font-bold ${
                    score >= 80
                      ? 'text-emerald-400'
                      : score >= 60
                        ? 'text-amber-400'
                        : 'text-rose-400'
                  }`}
                >
                  {score}%
                </div>
                <div className="flex-1">
                  <div className="h-2 bg-panel rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        score >= 80
                          ? 'bg-emerald-500'
                          : score >= 60
                            ? 'bg-amber-500'
                            : 'bg-rose-500'
                      }`}
                      style={{ width: `${score}%` }}
                    />
                  </div>
                </div>
              </div>

              {missed.length > 0 && (
                <div className="text-sm">
                  <div className="text-slate-400 mb-1">漏咗 / 錯咗嘅字：</div>
                  <div className="flex flex-wrap gap-1.5">
                    {missed.map((w, i) => (
                      <span key={i} className="px-2 py-1 bg-rose-500/20 text-rose-300 rounded text-xs">
                        {w}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-xs text-slate-500 mt-3">
                💡 評分基於語音辨識的文字與原句的相似度。多練習幾次會更準確！
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

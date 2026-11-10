import { useEffect, useRef, useState } from 'react'
import type { Cue } from '../lib/types'
import type { PlayerApi } from '../lib/player'
import { useRecordingScore } from '../lib/useRecordingScore'
import { ScoringDisplay } from './ScoringDisplay'

interface Props {
  cues: Cue[]
  currentIdx: number
  videoId: string
  player: PlayerApi | null
}

export function ShadowPanel({ cues, currentIdx, videoId, player }: Props) {
  const [idx, setIdx] = useState(Math.max(0, currentIdx))
  const stopOriginalRef = useRef<(() => void) | null>(null)
  
  const cue = cues[idx]
  const storageKey = cue ? `recording:video:${videoId}:${cue.start}` : undefined
  
  const {
    recording,
    recordedBlob,
    transcribing,
    scoringResult,
    hasMediaRecorder,
    startRecording,
    stopRecording,
    autoTranscribeAndScore,
    playRecording,
    loadCachedRecording,
    reset,
    cleanup,
  } = useRecordingScore({
    storageKey,
  })

  // Load cached recording when cue changes
  useEffect(() => {
    if (storageKey) {
      loadCachedRecording(storageKey)
    }
  }, [storageKey, loadCachedRecording])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup()
      stopOriginalRef.current?.()
    }
  }, [cleanup])

  // When recording stops, auto-transcribe and score (guard against double-fire)
  useEffect(() => {
    if (!recording && recordedBlob && cue && !scoringResult && !transcribing) {
      autoTranscribeAndScore(cue.en)
    }
  }, [recording, recordedBlob, cue, scoringResult, transcribing, autoTranscribeAndScore])

  const nextCue = () => {
    if (idx < cues.length - 1) {
      setIdx(idx + 1)
      reset()
    }
  }

  const prevCue = () => {
    if (idx > 0) {
      setIdx(idx - 1)
      reset()
    }
  }

  // Play original video audio for current cue
  const playOriginalAudio = () => {
    if (!player || !cue) return

    stopOriginalRef.current?.()
    
    const startTime = cue.start
    const endTime = cue.end
    
    player.seek(startTime)
    player.play()
    
    const checkInterval = setInterval(() => {
      if (player.getTime() >= endTime) {
        player.pause()
        stopOriginalRef.current?.()
      }
    }, 50)
    
    const safety = setTimeout(() => {
      stopOriginalRef.current?.()
    }, (endTime - startTime + 1) * 1000)

    stopOriginalRef.current = () => {
      clearInterval(checkInterval)
      clearTimeout(safety)
      stopOriginalRef.current = null
    }
  }

  const handleStartRecording = async () => {
    // Pause video while recording so mic doesn't pick it up
    if (player?.isPlaying()) {
      player.pause()
    }
    
    const success = await startRecording()
    if (!success) {
      alert('無法存取麥克風')
    }
  }

  if (!hasMediaRecorder) {
    return (
      <div className="card p-6 bg-amber-500/10 border-amber-500/30">
        <div className="text-amber-300 font-medium mb-2">🎙️ 錄音不支援</div>
        <p className="text-sm text-slate-300 mb-3">
          這個瀏覽器不支援錄音功能。請使用 Chrome 或 Safari。
        </p>
        <p className="text-xs text-slate-400">
          你仍可以點「播原音」聽影片句子，然後自己跟讀練習。
        </p>
      </div>
    )
  }

  if (!cue) return null

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
        <button className="btn" onClick={playOriginalAudio} disabled={!player}>
          🔊 播原音
        </button>
        {!recording ? (
          <button className="btn" onClick={handleStartRecording}>
            🎙️ 開始跟讀
          </button>
        ) : (
          <button className="btn bg-rose-600 hover:bg-rose-700" onClick={stopRecording}>
            ⏹️ 停止錄音
          </button>
        )}
        <button className="btn ghost" onClick={prevCue} disabled={idx === 0}>
          ← 上一句
        </button>
        <button className="btn ghost" onClick={nextCue} disabled={idx === cues.length - 1}>
          下一句 →
        </button>
      </div>

      {/* Recording playback buttons */}
      {recordedBlob && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-700">
          <button className="btn ghost text-sm" onClick={playRecording}>
            ▶ 播自己
          </button>
          <button className="btn ghost text-sm" onClick={playOriginalAudio} disabled={!player}>
            ▶ 播原音
          </button>
        </div>
      )}

      {recording && (
        <div className="card p-4 bg-sky-500/10 border-sky-500/30 text-center">
          <div className="text-sky-300 font-medium animate-pulse">🎙️ 錄緊音…</div>
        </div>
      )}

      {transcribing && (
        <div className="card p-4">
          <div className="text-sm text-slate-400">正在評分…</div>
        </div>
      )}

      {scoringResult && (
        <ScoringDisplay result={scoringResult} />
      )}
    </div>
  )
}

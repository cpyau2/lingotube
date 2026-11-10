import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Page } from '../components/Page'
import { db } from '../lib/db'
import { calculatePartProgress } from '../lib/articleParser'
import type { ArticleScript, ArticlePart, ArticleSentence } from '../lib/types'
import { newSrs } from '../lib/srs'
import { calculateDetailedScore, type ScoringResult } from '../lib/scoring'
import { ScoringDisplay } from '../components/ScoringDisplay'

type PlayMode = 'sentence' | 'part'

// Speech synthesis helper - prefer high-quality voices
function getEnglishVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices()
  
  // Prefer Google, Natural, or Samantha voices
  const preferred = voices.find(v => 
    v.lang.startsWith('en') && 
    (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha'))
  )
  if (preferred) return preferred
  
  // Fallback to any English voice
  return voices.find(v => v.lang.startsWith('en')) || voices[0] || null
}

export default function ArticlePractice() {
  const { id } = useParams<{ id: string }>()
  const article = useLiveQuery(() => db.articles.get(Number(id)), [id])
  
  const [partIdx, setPartIdx] = useState(0)
  const [sentenceIdx, setSentenceIdx] = useState(0)
  const [speed, setSpeed] = useState(1.0)
  const [repeat, setRepeat] = useState(1)
  const [chunkPauseMode, setChunkPauseMode] = useState(false) // Default OFF
  const [playing, setPlaying] = useState(false)
  const [currentChunk, setCurrentChunk] = useState(-1)
  const [recording, setRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const [scoringResult, setScoringResult] = useState<ScoringResult | null>(null)
  
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recognitionRef = useRef<any>(null)
  const repeatCountRef = useRef(0)
  const highlightTimerRef = useRef<number | null>(null)
  
  const hasSpeechSynthesis = typeof speechSynthesis !== 'undefined'
  const hasMediaRecorder = typeof MediaRecorder !== 'undefined'
  const hasSpeechRecognition = typeof (window as any).SpeechRecognition !== 'undefined' || 
                                typeof (window as any).webkitSpeechRecognition !== 'undefined'

  // Load cached recording on mount
  useEffect(() => {
    if (!article) return
    const key = `recording:${article.id}:${partIdx}:${sentenceIdx}`
    db.recordings.get(key).then(rec => {
      if (rec?.blob) setRecordedBlob(rec.blob)
    })
  }, [article, partIdx, sentenceIdx])

  useEffect(() => {
    // Load voices
    if (hasSpeechSynthesis) {
      speechSynthesis.getVoices()
      speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices()
    }
    
    // Setup recognition (fallback only)
    if (hasSpeechRecognition) {
      const SpeechRecog = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      const recognition = new SpeechRecog()
      recognition.lang = 'en-US'
      recognition.continuous = false
      recognition.interimResults = false
      recognitionRef.current = recognition
    }
    
    return () => {
      if (utteranceRef.current) {
        speechSynthesis.cancel()
      }
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop() } catch {}
      }
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current)
      }
    }
  }, [hasSpeechSynthesis, hasSpeechRecognition])
  
  const updateSentenceStats = useCallback(async (newScore: number) => {
    if (!article || !article.id) return
    
    const updated = { ...article }
    const sentence = updated.parts[partIdx].sentences[sentenceIdx]
    sentence.attempts++
    if (newScore > sentence.bestScore) {
      sentence.bestScore = newScore
    }
    sentence.lastPractised = Date.now()
    
    // If score < 70%, add to SRS
    if (newScore < 70) {
      const fullText = sentence.chunks.map(c => c.text).join(' ')
      const existing = await db.sentences
        .where('en').equals(fullText)
        .and(s => s.videoId === `article-${article.id}`)
        .first()
      
      if (!existing) {
        await db.sentences.add({
          en: fullText,
          videoId: `article-${article.id}`,
          videoTitle: article.title,
          start: 0,
          end: 0,
          createdAt: Date.now(),
          ...newSrs(),
        })
      }
    }
    
    await db.articles.put(updated)
  }, [article, partIdx, sentenceIdx])
  
  // Get or generate TTS audio for a sentence (Google TTS via Worker proxy)
  const getTTSAudio = useCallback(async (text: string): Promise<Blob | null> => {
    // Changed cache key prefix to v2 to invalidate old Aura audio
    const cacheKey = `tts-v2:${text}:google-en`
    
    // Check cache first
    const cached = await db.audioCache.get(cacheKey)
    if (cached?.blob) {
      return cached.blob
    }
    
    // Generate via Worker (GET endpoint for Google TTS proxy)
    try {
      const params = new URLSearchParams({ q: text, tl: 'en' })
      const resp = await fetch(`/api/tts?${params}`)
      
      if (!resp.ok) {
        console.error('TTS failed:', await resp.text())
        return null
      }
      
      const blob = await resp.blob()
      
      // Cache it
      await db.audioCache.put({
        key: cacheKey,
        blob,
        createdAt: Date.now(),
      })
      
      return blob
    } catch (e) {
      console.error('TTS error:', e)
      return null
    }
  }, [])
  
  // Approximate chunk highlighting during continuous playback
  const approximateChunkHighlight = useCallback((sentence: ArticleSentence, duration: number) => {
    const totalChars = sentence.chunks.reduce((sum, c) => sum + c.text.length, 0)
    let elapsed = 0
    
    sentence.chunks.forEach((chunk, idx) => {
      const chunkDuration = (chunk.text.length / totalChars) * duration
      const delay = elapsed
      
      highlightTimerRef.current = window.setTimeout(() => {
        setCurrentChunk(idx)
      }, delay * 1000)
      
      elapsed += chunkDuration
    })
    
    // Clear highlight at end
    highlightTimerRef.current = window.setTimeout(() => {
      setCurrentChunk(-1)
    }, duration * 1000)
  }, [])
  
  // Play sentence with Workers AI TTS + fallback to speechSynthesis
  const playSentence = useCallback(async () => {
    if (!article) return
    
    const sentence = article.parts[partIdx].sentences[sentenceIdx]
    if (!sentence) return
    
    // Stop any existing playback
    speechSynthesis.cancel()
    if (audioRef.current) {
      audioRef.current.pause()
    }
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current)
    }
    
    setPlaying(true)
    setCurrentChunk(-1)
    repeatCountRef.current = 0
    
    const fullText = sentence.chunks.map(c => c.text).join(' ')
    
    const playOnce = async (): Promise<void> => {
      // Try Workers AI TTS first
      const audioBlob = await getTTSAudio(fullText)
      
      if (audioBlob && !chunkPauseMode) {
        // Play via <audio> element with speed control
        return new Promise<void>((resolve) => {
          const audio = new Audio(URL.createObjectURL(audioBlob))
          audio.playbackRate = speed
          audio.preservesPitch = true
          audioRef.current = audio
          
          const duration = 0 // Unknown until loaded
          audio.onloadedmetadata = () => {
            approximateChunkHighlight(sentence, audio.duration / speed)
          }
          
          audio.onended = () => {
            URL.revokeObjectURL(audio.src)
            setTimeout(() => {
              repeatCountRef.current++
              const shouldRepeat = repeat === 0 || repeatCountRef.current < repeat
              if (shouldRepeat) {
                playOnce().then(resolve)
              } else {
                resolve()
              }
            }, 800)
          }
          
          audio.onerror = () => {
            console.error('Audio playback failed, falling back to speechSynthesis')
            URL.revokeObjectURL(audio.src)
            // Fallback to speechSynthesis
            playSpeechSynthesisFull(sentence, fullText).then(resolve)
          }
          
          audio.play().catch(() => {
            console.error('Audio play failed, falling back to speechSynthesis')
            URL.revokeObjectURL(audio.src)
            playSpeechSynthesisFull(sentence, fullText).then(resolve)
          })
        })
      } else if (hasSpeechSynthesis) {
        // Fallback to speechSynthesis
        if (chunkPauseMode) {
          // Chunk-by-chunk with pauses
          return playChunkByChunk(sentence)
        } else {
          // Full sentence at once
          return playSpeechSynthesisFull(sentence, fullText)
        }
      } else {
        return Promise.resolve()
      }
    }
    
    await playOnce()
    setPlaying(false)
    setCurrentChunk(-1)
  }, [article, partIdx, sentenceIdx, speed, repeat, chunkPauseMode, hasSpeechSynthesis, getTTSAudio, approximateChunkHighlight])
  
  // Play full sentence with speechSynthesis
  const playSpeechSynthesisFull = useCallback((sentence: ArticleSentence, text: string): Promise<void> => {
    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.voice = getEnglishVoice()
      utterance.rate = speed
      
      // Approximate chunk highlighting via character boundary events
      utterance.onboundary = (e) => {
        if (e.name === 'word') {
          const charIndex = e.charIndex
          let cumulative = 0
          for (let i = 0; i < sentence.chunks.length; i++) {
            cumulative += sentence.chunks[i].text.length + 1 // +1 for space
            if (charIndex < cumulative) {
              setCurrentChunk(i)
              break
            }
          }
        }
      }
      
      utterance.onend = () => {
        setTimeout(() => {
          repeatCountRef.current++
          const shouldRepeat = repeat === 0 || repeatCountRef.current < repeat
          if (shouldRepeat) {
            playSpeechSynthesisFull(sentence, text).then(resolve)
          } else {
            resolve()
          }
        }, 800)
      }
      
      utterance.onerror = () => {
        resolve()
      }
      
      utteranceRef.current = utterance
      speechSynthesis.speak(utterance)
    })
  }, [speed, repeat])
  
  // Play chunk-by-chunk with pauses (old behavior, now optional)
  const playChunkByChunk = useCallback((sentence: ArticleSentence): Promise<void> => {
    return new Promise<void>((resolve) => {
      let chunkIndex = 0
      const chunkPause = 400 // ms
      
      const playNextChunk = () => {
        if (chunkIndex >= sentence.chunks.length) {
          setTimeout(() => {
            repeatCountRef.current++
            const shouldRepeat = repeat === 0 || repeatCountRef.current < repeat
            if (shouldRepeat) {
              playChunkByChunk(sentence).then(resolve)
            } else {
              resolve()
            }
          }, 800)
          return
        }
        
        setCurrentChunk(chunkIndex)
        const chunk = sentence.chunks[chunkIndex]
        const utterance = new SpeechSynthesisUtterance(chunk.text)
        utterance.voice = getEnglishVoice()
        utterance.rate = speed
        utterance.onend = () => {
          setTimeout(() => {
            chunkIndex++
            playNextChunk()
          }, chunkPause)
        }
        utterance.onerror = () => {
          chunkIndex++
          playNextChunk()
        }
        utteranceRef.current = utterance
        speechSynthesis.speak(utterance)
      }
      
      playNextChunk()
    })
  }, [speed, repeat])
  
  const stopPlaying = () => {
    speechSynthesis.cancel()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current)
    }
    setPlaying(false)
    setCurrentChunk(-1)
  }
  
  const startRecording = async () => {
    if (!hasMediaRecorder) return
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      
      recorder.ondataavailable = (e) => chunks.push(e.data)
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        setRecordedBlob(blob)
        stream.getTracks().forEach(track => track.stop())
        
        // Save to IndexedDB
        if (article) {
          const key = `recording:${article.id}:${partIdx}:${sentenceIdx}`
          await db.recordings.put({
            key,
            blob,
            createdAt: Date.now(),
          })
        }
        
        // Auto-transcribe and score
        await transcribeAndScore(blob)
      }
      
      mediaRecorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch (e) {
      alert('無法存取麥克風')
    }
  }
  
  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop()
      setRecording(false)
    }
  }
  
  // Transcribe via Workers AI Whisper, with speechRecognition fallback
  const transcribeAndScore = async (blob: Blob) => {
    if (!article) return
    
    setTranscribing(true)
    setScoringResult(null)
    
    const sentence = article.parts[partIdx].sentences[sentenceIdx]
    const fullText = sentence.chunks.map(c => c.text).join(' ')
    
    let transcript = ''
    
    // Try Workers AI Whisper first
    try {
      const formData = new FormData()
      formData.append('audio', blob, 'recording.webm')
      
      const resp = await fetch('/api/stt', {
        method: 'POST',
        body: formData,
      })
      
      if (resp.ok) {
        const data = await resp.json()
        transcript = data.text || ''
      }
    } catch (e) {
      console.error('Whisper STT failed:', e)
    }
    
    // Fallback to browser SpeechRecognition if Whisper failed and available
    if (!transcript && hasSpeechRecognition && recognitionRef.current) {
      try {
        // Note: SpeechRecognition needs live mic input, can't process recorded blob
        // So this is limited - but we keep it as a fallback for when recording + recognition happen together
        // For now, we'll skip this fallback since it won't work with the recorded blob
        console.log('SpeechRecognition fallback not available for recorded audio')
      } catch {}
    }
    
    // Calculate score
    const result = calculateDetailedScore(fullText, transcript)
    setScoringResult(result)
    setTranscribing(false)
    
    // Update stats
    await updateSentenceStats(result.score)
  }
  
  const playRecording = () => {
    if (!recordedBlob) return
    const audio = new Audio(URL.createObjectURL(recordedBlob))
    audio.play()
    audio.onended = () => URL.revokeObjectURL(audio.src)
  }
  
  const playOriginal = async () => {
    await playSentence()
  }
  
  const nextSentence = () => {
    if (!article) return
    const part = article.parts[partIdx]
    if (sentenceIdx < part.sentences.length - 1) {
      setSentenceIdx(sentenceIdx + 1)
      reset()
    } else if (partIdx < article.parts.length - 1) {
      setPartIdx(partIdx + 1)
      setSentenceIdx(0)
      reset()
    }
  }
  
  const prevSentence = () => {
    if (sentenceIdx > 0) {
      setSentenceIdx(sentenceIdx - 1)
      reset()
    } else if (partIdx > 0) {
      setPartIdx(partIdx - 1)
      if (article) {
        setSentenceIdx(article.parts[partIdx - 1].sentences.length - 1)
      }
      reset()
    }
  }
  
  const reset = () => {
    setRecordedBlob(null)
    setScoringResult(null)
    setCurrentChunk(-1)
    stopPlaying()
  }
  
  if (!article) return <div className="p-6 text-slate-400">載入中…</div>
  if (!article.parts || article.parts.length === 0) {
    return (
      <Page
        title={article.title}
        right={<Link to="/articles" className="btn ghost text-sm">← 返回</Link>}
      >
        <div className="p-6">無法載入文章內容</div>
      </Page>
    )
  }
  
  const part = article.parts[partIdx]
  const sentence = part.sentences[sentenceIdx]
  const fullText = sentence.chunks.map(c => c.text).join(' ')
  const progress = calculatePartProgress(part)
  
  return (
    <Page
      title={article.title}
      right={<Link to="/articles" className="btn ghost text-sm">← 返回</Link>}
    >
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Part selector */}
        <div className="card p-4">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {article.parts.map((p, i) => (
              <button
                key={i}
                onClick={() => { setPartIdx(i); setSentenceIdx(0); reset() }}
                className={`chip shrink-0 ${i === partIdx ? '!bg-sky-500/20 !text-sky-300' : ''}`}
              >
                Part {i + 1}
                <span className="ml-1 text-xs opacity-70">({p.sentences.length})</span>
              </button>
            ))}
          </div>
          <div className="mt-3">
            <div className="text-sm font-medium mb-1">{part.title}</div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>進度</span>
              <div className="flex-1 h-1.5 bg-panel rounded-full overflow-hidden">
                <div className="h-full bg-sky-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <span>{progress}%</span>
            </div>
          </div>
        </div>

        {/* Sentence display */}
        <div className="card p-6">
          <div className="text-xs text-slate-500 mb-3">
            句子 {sentenceIdx + 1} / {part.sentences.length}
          </div>
          <div className="text-2xl leading-relaxed" lang="en">
            {sentence.chunks.map((chunk, i) => (
              <span
                key={i}
                className={`${chunk.stressed ? 'font-bold text-amber-300' : 'text-slate-200'} ${
                  i === currentChunk && playing ? 'bg-sky-500/30 px-1 rounded' : ''
                }`}
              >
                {chunk.text}
                {i < sentence.chunks.length - 1 && ' '}
              </span>
            ))}
          </div>
          {sentence.attempts > 0 && (
            <div className="mt-3 text-xs text-slate-400">
              已練習 {sentence.attempts} 次 · 最佳 {sentence.bestScore}%
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="card p-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={playSentence} disabled={playing || recording}>
              {playing ? '⏸ 播放中…' : '🔊 播放原句'}
            </button>
            {playing && (
              <button className="btn ghost" onClick={stopPlaying}>⏹ 停止</button>
            )}
            {!recording ? (
              <button className="btn" onClick={startRecording} disabled={playing || !hasMediaRecorder}>
                🎙️ 錄音跟讀
              </button>
            ) : (
              <button className="btn bg-rose-600 hover:bg-rose-700" onClick={stopRecording}>
                ⏹ 停止錄音
              </button>
            )}
          </div>
          
          {/* Recording playback buttons */}
          {recordedBlob && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-700">
              <button className="btn ghost text-sm" onClick={playRecording}>
                ▶ 播我的錄音
              </button>
              <button className="btn ghost text-sm" onClick={playOriginal} disabled={playing}>
                ▶ 播放原句
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <label className="block">
              <span className="text-xs text-slate-400 mb-1 block">速度</span>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="text-sm w-full">
                <option value={0.6}>0.6×</option>
                <option value={0.8}>0.8×</option>
                <option value={1.0}>1.0×</option>
                <option value={1.2}>1.2×</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-400 mb-1 block">重複</span>
              <select value={repeat} onChange={(e) => setRepeat(Number(e.target.value))} className="text-sm w-full">
                <option value={1}>1 次</option>
                <option value={3}>3 次</option>
                <option value={5}>5 次</option>
                <option value={0}>∞ 無限</option>
              </select>
            </label>
            <label className="flex items-center gap-2 col-span-2">
              <input 
                type="checkbox" 
                checked={chunkPauseMode} 
                onChange={(e) => setChunkPauseMode(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-xs text-slate-300">分段停頓</span>
            </label>
          </div>
        </div>

        {/* Scoring result */}
        {transcribing && (
          <div className="card p-4">
            <div className="text-sm text-slate-400">正在評分…</div>
          </div>
        )}
        
        {scoringResult && (
          <ScoringDisplay result={scoringResult} showLowScoreHint />
        )}

        {/* Navigation */}
        <div className="flex gap-3 justify-between">
          <button className="btn ghost" onClick={prevSentence} disabled={partIdx === 0 && sentenceIdx === 0}>
            ← 上一句
          </button>
          <button className="btn ghost" onClick={nextSentence} 
            disabled={partIdx === article.parts.length - 1 && sentenceIdx === part.sentences.length - 1}>
            下一句 →
          </button>
        </div>

        {/* Unsupported features */}
        {!hasMediaRecorder && (
          <div className="card p-4 bg-amber-500/10 border-amber-500/30">
            <div className="text-sm text-amber-300 font-medium mb-2">功能限制</div>
            <div className="text-xs text-slate-300">
              <p>• 此瀏覽器不支援錄音功能</p>
              <p className="mt-2">建議使用 Chrome 或 Safari 以獲得完整功能。</p>
            </div>
          </div>
        )}
      </div>
    </Page>
  )
}

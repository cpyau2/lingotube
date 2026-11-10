import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Page } from '../components/Page'
import { db } from '../lib/db'
import { calculatePartProgress } from '../lib/articleParser'
import type { ArticleScript, ArticlePart, ArticleSentence } from '../lib/types'
import { newSrs } from '../lib/srs'

type PlayMode = 'sentence' | 'part'

// Speech synthesis helper
function getEnglishVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices()
  return voices.find(v => v.lang.startsWith('en')) || voices[0] || null
}

export default function ArticlePractice() {
  const { id } = useParams<{ id: string }>()
  const article = useLiveQuery(() => db.articles.get(Number(id)), [id])
  
  const [partIdx, setPartIdx] = useState(0)
  const [sentenceIdx, setSentenceIdx] = useState(0)
  const [speed, setSpeed] = useState(1.0)
  const [repeat, setRepeat] = useState(1)
  const [chunkPause, setChunkPause] = useState(400) // ms
  const [playing, setPlaying] = useState(false)
  const [currentChunk, setCurrentChunk] = useState(-1)
  const [recording, setRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [comparing, setComparing] = useState(false)
  const [recognizedText, setRecognizedText] = useState('')
  const [score, setScore] = useState<number | null>(null)
  
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recognitionRef = useRef<any>(null)
  const repeatCountRef = useRef(0)
  
  const hasSpeechSynthesis = typeof speechSynthesis !== 'undefined'
  const hasMediaRecorder = typeof MediaRecorder !== 'undefined'
  const hasSpeechRecognition = typeof (window as any).SpeechRecognition !== 'undefined' || 
                                typeof (window as any).webkitSpeechRecognition !== 'undefined'

  useEffect(() => {
    // Load voices
    if (hasSpeechSynthesis) {
      speechSynthesis.getVoices()
      speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices()
    }
    
    // Setup recognition
    if (hasSpeechRecognition) {
      const SpeechRecog = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      const recognition = new SpeechRecog()
      recognition.lang = 'en-US'
      recognition.continuous = false
      recognition.interimResults = false
      
      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript
        setRecognizedText(transcript)
        
        // Calculate score
        if (article && article.parts[partIdx]) {
          const sentence = article.parts[partIdx].sentences[sentenceIdx]
          const fullText = sentence.chunks.map(c => c.text).join(' ')
          const s = calculateScore(fullText, transcript)
          setScore(s)
          
          // Update article stats
          updateSentenceStats(s)
        }
      }
      
      recognition.onerror = () => {
        setRecognizedText('語音辨識失敗')
      }
      
      recognitionRef.current = recognition
    }
    
    return () => {
      if (utteranceRef.current) {
        speechSynthesis.cancel()
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop() } catch {}
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
  
  const playSentence = useCallback(async () => {
    if (!article || !hasSpeechSynthesis) return
    
    const sentence = article.parts[partIdx].sentences[sentenceIdx]
    if (!sentence) return
    
    speechSynthesis.cancel()
    setPlaying(true)
    setCurrentChunk(-1)
    repeatCountRef.current = 0
    
    const playOnce = () => {
      return new Promise<void>((resolve) => {
        let chunkIndex = 0
        
        const playNextChunk = () => {
          if (chunkIndex >= sentence.chunks.length) {
            // Sentence complete
            setTimeout(() => {
              repeatCountRef.current++
              const shouldRepeat = repeat === 0 || repeatCountRef.current < repeat
              if (shouldRepeat) {
                playOnce().then(resolve)
              } else {
                resolve()
              }
            }, 800) // pause between repeats
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
    }
    
    await playOnce()
    setPlaying(false)
    setCurrentChunk(-1)
  }, [article, partIdx, sentenceIdx, speed, repeat, chunkPause, hasSpeechSynthesis])
  
  const stopPlaying = () => {
    speechSynthesis.cancel()
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
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        setRecordedBlob(blob)
        stream.getTracks().forEach(track => track.stop())
      }
      
      mediaRecorderRef.current = recorder
      recorder.start()
      setRecording(true)
      
      // Also start recognition
      if (recognitionRef.current) {
        setRecognizedText('')
        setScore(null)
        try {
          recognitionRef.current.start()
        } catch {}
      }
    } catch (e) {
      alert('無法存取麥克風')
    }
  }
  
  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop()
      setRecording(false)
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
    }
  }
  
  const playComparison = async () => {
    if (!article || !recordedBlob) return
    
    setComparing(true)
    
    // Play original
    await playSentence()
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // Play recording
    const audio = new Audio(URL.createObjectURL(recordedBlob))
    audio.play()
    await new Promise(resolve => { audio.onended = resolve })
    
    setComparing(false)
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
    setRecognizedText('')
    setScore(null)
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
              {playing ? '⏸ 播放中…' : '🔊 播放'}
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
            {recordedBlob && !comparing && (
              <button className="btn ghost" onClick={playComparison}>
                🔄 對比播放
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm">
            <label className="block">
              <span className="text-xs text-slate-400 mb-1 block">速度</span>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="text-sm">
                <option value={0.6}>0.6×</option>
                <option value={0.8}>0.8×</option>
                <option value={1.0}>1.0×</option>
                <option value={1.2}>1.2×</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-400 mb-1 block">重複</span>
              <select value={repeat} onChange={(e) => setRepeat(Number(e.target.value))} className="text-sm">
                <option value={1}>1 次</option>
                <option value={3}>3 次</option>
                <option value={5}>5 次</option>
                <option value={0}>∞ 無限</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-400 mb-1 block">停頓</span>
              <select value={chunkPause} onChange={(e) => setChunkPause(Number(e.target.value))} className="text-sm">
                <option value={200}>短</option>
                <option value={400}>中</option>
                <option value={600}>長</option>
              </select>
            </label>
          </div>
        </div>

        {/* Recognition result */}
        {recognizedText && (
          <div className="card p-4 space-y-3">
            <div className="text-xs text-slate-500">辨識結果</div>
            <div className="text-slate-200">{recognizedText}</div>
            {score !== null && (
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className={`text-2xl font-bold ${
                    score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : 'text-rose-400'
                  }`}>
                    {score}%
                  </div>
                  <div className="flex-1 h-2 bg-panel rounded-full overflow-hidden">
                    <div className={`h-full transition-all ${
                      score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-rose-500'
                    }`} style={{ width: `${score}%` }} />
                  </div>
                </div>
                {score < 70 && (
                  <div className="text-xs text-amber-300">
                    💡 分數較低的句子已自動加入複習列表
                  </div>
                )}
              </div>
            )}
          </div>
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
        {(!hasSpeechSynthesis || !hasMediaRecorder || !hasSpeechRecognition) && (
          <div className="card p-4 bg-amber-500/10 border-amber-500/30">
            <div className="text-sm text-amber-300 font-medium mb-2">功能限制</div>
            <div className="text-xs text-slate-300 space-y-1">
              {!hasSpeechSynthesis && <p>• 此瀏覽器不支援語音合成（TTS）</p>}
              {!hasMediaRecorder && <p>• 此瀏覽器不支援錄音功能</p>}
              {!hasSpeechRecognition && <p>• 此瀏覽器不支援語音辨識</p>}
              <p className="mt-2">建議使用 Chrome 或 Safari 以獲得完整功能。</p>
            </div>
          </div>
        )}
      </div>
    </Page>
  )
}

// Levenshtein distance scoring (reuse from ShadowPanel)
function calculateScore(target: string, recognized: string): number {
  if (!recognized.trim()) return 0
  const distance = levenshtein(target, recognized)
  const maxLen = Math.max(target.length, recognized.length)
  const accuracy = Math.max(0, 1 - distance / maxLen)
  return Math.round(accuracy * 100)
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
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

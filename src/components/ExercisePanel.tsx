import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Exercise } from '../lib/ai/provider'
import type { Cue } from '../lib/types'
import { db } from '../lib/db'

interface Props {
  videoId: string
  cues: Cue[]
}

interface ExerciseState extends Exercise {
  userAnswer: string
  checked: boolean
  correct: boolean
}

export function ExercisePanel({ videoId, cues }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exercises, setExercises] = useState<ExerciseState[]>([])

  useEffect(() => {
    const loadCached = async () => {
      const cacheKey = `exercises:${videoId}`
      const cached = await db.kv.get(cacheKey)
      if (cached?.value) {
        const ex = (cached.value as Exercise[]).map((e) => ({
          ...e,
          userAnswer: '',
          checked: false,
          correct: false,
        }))
        setExercises(ex)
      }
    }
    loadCached()
  }, [videoId])

  const generate = async () => {
    setLoading(true)
    setError('')

    try {
      // sample 8-20 cues
      const sample = cues.filter(() => Math.random() > 0.5).slice(0, 20)
      if (sample.length < 3) {
        // not enough, take first 8
        sample.push(...cues.slice(0, 8))
      }

      const sampleCues = sample.map((c) => ({ en: c.en, zh: c.zh }))

      const { getProvider } = await import('../lib/ai/provider')
      const provider = await getProvider()

      if (!provider.available) {
        throw new Error('尚未設定 AI 服務')
      }

      const result = await provider.generateExercises(sampleCues, 6)
      
      const cacheKey = `exercises:${videoId}`
      await db.kv.put({ key: cacheKey, value: result })

      const ex = result.map((e) => ({
        ...e,
        userAnswer: '',
        checked: false,
        correct: false,
      }))
      setExercises(ex)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const updateAnswer = (idx: number, answer: string) => {
    setExercises((prev) =>
      prev.map((e, i) => (i === idx ? { ...e, userAnswer: answer, checked: false } : e)),
    )
  }

  const checkAnswer = (idx: number) => {
    setExercises((prev) =>
      prev.map((e, i) => {
        if (i !== idx) return e
        const correct =
          e.userAnswer.trim().toLowerCase() === e.answer.trim().toLowerCase()
        return { ...e, checked: true, correct }
      }),
    )
  }

  if (exercises.length === 0) {
    return (
      <div className="space-y-3">
        <div className="card p-4">
          <p className="text-sm text-slate-400 mb-3">
            從這部影片的字幕生成填充、選擇、翻譯、排序等練習題。
          </p>
          <button className="btn" onClick={generate} disabled={loading || cues.length < 3}>
            {loading ? '⏳ 生成中…' : '✨ 生成練習題'}
          </button>
          {error && (
            <div className="mt-3 text-sm text-rose-300">
              ❌ {error}
              {error.includes('未設定') && (
                <Link to="/settings" className="ml-2 text-sky-400 hover:underline">
                  前往設定 →
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <button className="btn ghost text-sm" onClick={generate} disabled={loading}>
          {loading ? '⏳ 重新生成中…' : '🔄 重新生成'}
        </button>
      </div>

      {exercises.map((ex, i) => (
        <div key={i} className="card p-4 space-y-3">
          <div className="flex items-start gap-2">
            <span className="chip !px-2 !py-1 text-xs shrink-0">
              {ex.type === 'cloze'
                ? '填充'
                : ex.type === 'multiple-choice'
                  ? '選擇'
                  : ex.type === 'translate'
                    ? '翻譯'
                    : '排序'}
            </span>
            <div className="flex-1 text-sm text-slate-200">{ex.prompt}</div>
          </div>

          {ex.type === 'multiple-choice' && ex.choices ? (
            <div className="space-y-2">
              {ex.choices.map((choice, ci) => (
                <button
                  key={ci}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                    ex.userAnswer === choice
                      ? ex.checked
                        ? choice === ex.answer
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : 'border-rose-500 bg-rose-500/10'
                        : 'border-sky-500 bg-sky-500/10'
                      : 'border-line hover:border-slate-500'
                  }`}
                  onClick={() => !ex.checked && updateAnswer(i, choice)}
                  disabled={ex.checked}
                >
                  {choice}
                </button>
              ))}
            </div>
          ) : (
            <input
              type="text"
              value={ex.userAnswer}
              onChange={(e) => updateAnswer(i, e.target.value)}
              placeholder="輸入答案…"
              disabled={ex.checked}
              className="w-full"
            />
          )}

          <div className="flex gap-2 items-center">
            <button
              className="btn ghost text-sm"
              onClick={() => checkAnswer(i)}
              disabled={ex.checked || !ex.userAnswer.trim()}
            >
              檢查答案
            </button>
            {ex.checked && (
              <div
                className={`text-sm font-medium ${ex.correct ? 'text-emerald-300' : 'text-rose-300'}`}
              >
                {ex.correct ? '✅ 正確' : `❌ 錯誤，答案是：${ex.answer}`}
              </div>
            )}
          </div>

          {ex.checked && ex.explanationZh && (
            <div className="text-sm text-slate-400 bg-panel rounded-lg p-3">
              💡 {ex.explanationZh}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { SentenceExplanation } from '../lib/ai/provider'
import { db } from '../lib/db'

interface Props {
  sentence: string
  onError?: (err: string) => void
}

export function StructurePanel({ sentence, onError }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [explanation, setExplanation] = useState<SentenceExplanation | null>(null)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError('')

    const load = async () => {
      try {
        // check cache first
        const cacheKey = `struct:${sentence}`
        const cached = await db.kv.get(cacheKey)
        if (cached?.value) {
          if (mounted) {
            setExplanation(cached.value as SentenceExplanation)
            setLoading(false)
          }
          return
        }

        // call AI
        const { getProvider } = await import('../lib/ai/provider')
        const provider = await getProvider()
        
        if (!provider.available) {
          throw new Error('尚未設定 AI 服務')
        }

        const result = await provider.explainSentence(sentence)
        
        // cache result
        await db.kv.put({ key: cacheKey, value: result })
        
        if (mounted) {
          setExplanation(result)
          setLoading(false)
        }
      } catch (e: any) {
        if (mounted) {
          const msg = e.message || String(e)
          setError(msg)
          setLoading(false)
          onError?.(msg)
        }
      }
    }

    load()
    return () => { mounted = false }
  }, [sentence, onError])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-slate-400 text-sm animate-pulse">🧩 分析句型結構中…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card p-4 bg-rose-500/10 border-rose-500/30">
        <div className="text-rose-300 text-sm font-medium mb-2">❌ {error}</div>
        {error.includes('未設定') && (
          <Link to="/settings" className="text-sm text-sky-400 hover:underline">
            前往設定 →
          </Link>
        )}
      </div>
    )
  }

  if (!explanation) {
    return null
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="text-xs text-slate-500 mb-1">句型結構</div>
        <div className="text-slate-200 font-medium">{explanation.structure}</div>
      </div>

      {Array.isArray(explanation.breakdown) && explanation.breakdown.length > 0 && (
        <div className="card p-4">
          <div className="text-xs text-slate-500 mb-2">成分拆解</div>
          <div className="flex flex-wrap gap-2">
            {explanation.breakdown.map((part, i) => (
              <div key={i} className="inline-flex flex-col items-start bg-panel rounded-lg px-3 py-2 border border-line">
                <div className="text-slate-200 font-medium">{part.text}</div>
                <div className="text-xs text-slate-400 mt-0.5">{part.role}</div>
                {part.zh && <div className="text-xs text-amber-300 mt-0.5">{part.zh}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {Array.isArray(explanation.grammarNotes) && explanation.grammarNotes.length > 0 && (
        <div className="card p-4">
          <div className="text-xs text-slate-500 mb-2">文法重點</div>
          <ul className="space-y-2">
            {explanation.grammarNotes.map((note, i) => (
              <li key={i} className="text-sm text-slate-300 leading-relaxed flex gap-2">
                <span className="text-sky-400 shrink-0">•</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {explanation.translationZh && (
        <div className="card p-4">
          <div className="text-xs text-slate-500 mb-1">翻譯</div>
          <div className="text-amber-200" lang="zh-Hant">{explanation.translationZh}</div>
        </div>
      )}
    </div>
  )
}

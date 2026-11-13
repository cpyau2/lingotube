import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { SentenceExplanation } from '../lib/ai/provider'
import { db } from '../lib/db'
import {
  inferStructureModel,
  loadStructureTier,
  readStructureCache,
  structureModelLabel,
  writeStructureCache,
  type StructureTier,
} from '../lib/structureTier'

interface Props {
  sentence: string
  onError?: (err: string) => void
}

// Render nested notes with support for sub-bullets
function renderNote(note: string | { text: string; sub: string[] }, idx: number) {
  if (typeof note === 'string') {
    return (
      <li key={idx} className="text-sm text-slate-300 leading-relaxed">
        {note}
      </li>
    )
  }
  
  return (
    <li key={idx} className="text-sm text-slate-300 leading-relaxed">
      {note.text}
      {note.sub && note.sub.length > 0 && (
        <ul className="ml-4 mt-1 space-y-1 list-none">
          {note.sub.map((subNote, subIdx) => (
            <li key={subIdx} className="text-sm text-slate-400 leading-relaxed flex gap-2">
              <span className="text-sky-400/60 shrink-0">◦</span>
              <span>{subNote}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function StructurePanel({ sentence, onError }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [explanation, setExplanation] = useState<SentenceExplanation | null>(null)

  const load = async (opts?: { force?: boolean; tier?: StructureTier }) => {
    setLoading(true)
    setError('')

    try {
      const { getProvider } = await import('../lib/ai/provider')
      const provider = await getProvider()
      const isWorkers = provider.id === 'workers-ai'
      const tier: StructureTier = opts?.tier ?? (isWorkers ? loadStructureTier() : 'accurate')

      if (!opts?.force) {
        if (isWorkers) {
          const cached = await readStructureCache(sentence, tier)
          if (cached) {
            setExplanation(cached)
            setLoading(false)
            return
          }
        } else {
          const cached = await db.kv.get(`struct:v2:${sentence}`)
          if (cached?.value) {
            setExplanation(cached.value as SentenceExplanation)
            setLoading(false)
            return
          }
        }
      }

      if (!provider.available) {
        throw new Error('尚未設定 AI 服務')
      }

      const result = await provider.explainSentence(sentence, isWorkers ? { tier } : undefined)
      if (isWorkers) await writeStructureCache(sentence, result)
      else await db.kv.put({ key: `struct:v2:${sentence}`, value: result })

      setExplanation(result)
      setLoading(false)
    } catch (e: any) {
      const msg = e.message || String(e)
      setError(msg)
      setLoading(false)
      onError?.(msg)
    }
  }

  useEffect(() => {
    load()
  }, [sentence])

  const shownModel = inferStructureModel(explanation)
  const handleRefresh = () => {
    // When the visible result is 8B, offer a 70B rerun even if Settings is still on 慳額度.
    if (shownModel === '8b') load({ force: true, tier: 'accurate' })
    else load({ force: true })
  }

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

  // Check if this is the new format or legacy format
  const isNewFormat = explanation.components && explanation.components.length > 0

  // Render legacy format for backward compatibility
  if (!isNewFormat && explanation.breakdown) {
    return (
      <div className="space-y-4">
        <div className="card p-4">
          <div className="text-xs text-slate-500 mb-1">句型結構</div>
          <div className="text-slate-200 font-medium">{explanation.structure}</div>
        </div>

        {explanation.breakdown.length > 0 && (
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

        {explanation.grammarNotes && explanation.grammarNotes.length > 0 && (
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

  // Render new detailed format
  const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

  return (
    <div className="space-y-4">
      {/* Header with refresh button */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">句型拆解</div>
        <button 
          onClick={handleRefresh}
          className="text-xs text-sky-400 hover:text-sky-300 transition-colors px-2 py-1 rounded hover:bg-sky-500/10"
          data-testid="structure-refresh"
          title={shownModel === '8b' ? '用精準模式重新分析' : '重新分析'}
        >
          {shownModel === '8b' ? '用精準模式重新分析' : '🔄 重新分析'}
        </button>
      </div>

      {structureModelLabel(shownModel) && (
        <div className="text-[11px] text-slate-500" data-testid="structure-model" lang="zh-Hant">
          {structureModelLabel(shownModel)}
        </div>
      )}

      {explanation.degraded && (
        <div className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2" lang="zh-Hant">
          今日示範額度已用完，暫時改用較細嘅模型，結果可能冇咁準。
        </div>
      )}

      {/* Original sentence */}
      <div className="card p-4">
        <div className="text-xs text-slate-500 mb-2">原文</div>
        <div className="text-lg text-slate-200 font-medium leading-relaxed" lang="en">
          {sentence}
        </div>
      </div>

      {/* Overview structure */}
      {explanation.overview && (
        <div className="card p-4 bg-sky-500/5 border-sky-500/20">
          <div className="text-xs text-slate-500 mb-2">整體結構</div>
          <div className="text-slate-200 leading-relaxed">
            {explanation.overview}
          </div>
        </div>
      )}

      {/* Numbered components */}
      {explanation.components && explanation.components.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-medium text-slate-400">1. 句子結構拆解</div>
          {explanation.components.map((component, idx) => (
            <div key={idx} className="card p-4 bg-panel">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-2xl text-amber-400 shrink-0">
                  {circledNumbers[idx] || `${idx + 1}.`}
                </span>
                <div className="flex-1">
                  <div className="text-slate-200 font-medium mb-1">
                    {component.roleZh}
                    {component.roleEn && (
                      <span className="text-xs text-slate-400 ml-2">({component.roleEn})</span>
                    )}
                  </div>
                  {component.text && (
                    <div className="text-amber-300 font-medium mb-1" lang="en">
                      {component.text}
                    </div>
                  )}
                  {component.meaningZh && (
                    <div className="text-sm text-slate-400 mb-2">
                      （{component.meaningZh}）
                    </div>
                  )}
                </div>
              </div>
              
              {component.notes && component.notes.length > 0 && (
                <ul className="ml-9 space-y-2 list-none">
                  {component.notes.map((note, noteIdx) => renderNote(note, noteIdx))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Grammar highlights */}
      {explanation.highlights && explanation.highlights.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-medium text-slate-400">2. 核心語法與口語亮點總結</div>
          <div className="card p-4">
            <ul className="space-y-3 list-none">
              {explanation.highlights.map((highlight, idx) => (
                <li key={idx} className="leading-relaxed">
                  <div className="text-sm text-sky-300 font-medium mb-1 flex gap-2">
                    <span className="text-sky-400 shrink-0">•</span>
                    <span>{highlight.title}</span>
                  </div>
                  <div className="text-sm text-slate-300 ml-4">
                    {highlight.detail}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Alternative expressions */}
      {explanation.alternatives && explanation.alternatives.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-medium text-slate-400">3. 常見口語替換表達</div>
          <div className="card p-4">
            <div className="space-y-3">
              {explanation.alternatives.map((alt, idx) => (
                <div key={idx} className="leading-relaxed">
                  <div className="text-xs text-amber-400 font-medium mb-1">
                    {alt.label}
                  </div>
                  <div className="text-sm text-slate-200 mb-1" lang="en">
                    "{alt.en}"
                  </div>
                  <div className="text-sm text-slate-400">
                    （{alt.zh}）
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Translation */}
      {explanation.translationZh && (
        <div className="card p-4 bg-amber-500/5 border-amber-500/20">
          <div className="text-xs text-slate-500 mb-1">整句翻譯</div>
          <div className="text-amber-200" lang="zh-Hant">{explanation.translationZh}</div>
        </div>
      )}
    </div>
  )
}

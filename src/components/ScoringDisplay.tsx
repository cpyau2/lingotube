// Shared scoring display component with word-level feedback
// Used by both ArticlePractice and ShadowPanel

import type { ScoringResult } from '../lib/scoring'

interface Props {
  result: ScoringResult
  showLowScoreHint?: boolean
}

export function ScoringDisplay({ result, showLowScoreHint = false }: Props) {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className={`text-3xl font-bold ${
          result.score >= 80 ? 'text-emerald-400' : result.score >= 60 ? 'text-amber-400' : 'text-rose-400'
        }`}>
          {result.score}%
        </div>
        <div className="flex-1">
          <div className="h-2 bg-panel rounded-full overflow-hidden">
            <div className={`h-full transition-all ${
              result.score >= 80 ? 'bg-emerald-500' : result.score >= 60 ? 'bg-amber-500' : 'bg-rose-500'
            }`} style={{ width: `${result.score}%` }} />
          </div>
          <div className="flex gap-3 mt-1 text-xs text-slate-400">
            <span>正確 {result.correct}</span>
            <span>接近 {result.close}</span>
            <span>遺漏 {result.missing}</span>
          </div>
        </div>
      </div>
      
      {/* Word-level feedback */}
      <div className="text-sm leading-relaxed">
        {result.alignments.map((a, i) => (
          <span
            key={i}
            className={`inline-block mr-1 mb-1 px-1.5 py-0.5 rounded ${
              a.match === 'correct' ? 'bg-emerald-500/20 text-emerald-300' :
              a.match === 'close' ? 'bg-amber-500/20 text-amber-300' :
              'bg-rose-500/20 text-rose-300'
            }`}
            title={a.recognizedWord ? `聽到: ${a.recognizedWord}` : '遺漏'}
          >
            {a.targetWord}
          </span>
        ))}
      </div>
      
      {showLowScoreHint && result.score < 70 && (
        <div className="text-xs text-amber-300">
          💡 分數較低的句子已自動加入複習列表
        </div>
      )}
    </div>
  )
}

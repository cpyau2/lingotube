import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Page } from '../components/Page'
import { db, deleteArticle, deleteArticles } from '../lib/db'
import { calculateScriptProgress, createArticleScript } from '../lib/articleParser'
import { BRUNCH_DIMSUM_SCRIPT, BRUNCH_DIMSUM_TITLE, BRUNCH_DIMSUM_LEVEL } from '../data/brunchDimSum'

export default function ArticleList() {
  const articles = useLiveQuery(() => db.articles.orderBy('createdAt').reverse().toArray(), [])
  const nav = useNavigate()
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [deleting, setDeleting] = useState<number | null>(null)

  const toggleSelect = (id: number) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const handleDeleteOne = async (id: number) => {
    if (!deleting) return
    try {
      await deleteArticle(id)
      setDeleting(null)
    } catch (e: any) {
      alert('刪除失敗：' + (e?.message ?? e))
    }
  }

  const handleDeleteBatch = async () => {
    if (selected.size === 0) return
    if (!confirm(`確定要刪除 ${selected.size} 篇文章？無法復原。`)) return
    try {
      await deleteArticles(Array.from(selected))
      setSelected(new Set())
      setSelectMode(false)
    } catch (e: any) {
      alert('批次刪除失敗：' + (e?.message ?? e))
    }
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelected(new Set())
  }

  const loadDemo = async () => {
    try {
      // Check if demo already exists
      const existing = articles?.find(a => a.title === BRUNCH_DIMSUM_TITLE)
      if (existing) {
        nav(`/articles/${existing.id}`)
        return
      }
      
      const script = createArticleScript(BRUNCH_DIMSUM_TITLE, BRUNCH_DIMSUM_SCRIPT, BRUNCH_DIMSUM_LEVEL)
      const id = await db.articles.add(script)
      nav(`/articles/${id}`)
    } catch (e: any) {
      alert('載入失敗：' + (e?.message ?? e))
    }
  }

  return (
    <Page
      title="文章跟讀"
      right={
        selectMode ? (
          <div className="flex gap-2">
            <button className="btn ghost text-sm" onClick={exitSelectMode}>取消</button>
            <button
              className="btn text-sm bg-rose-600 hover:bg-rose-700 disabled:opacity-50"
              disabled={selected.size === 0}
              onClick={handleDeleteBatch}
            >
              刪除 {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            {articles && articles.length > 0 && (
              <button className="btn ghost text-sm" onClick={() => setSelectMode(true)}>選取</button>
            )}
            <Link to="/articles/new" className="btn">＋ 新增文章</Link>
          </div>
        )
      }
    >
      <p className="text-slate-400 text-sm -mt-3 mb-5">
        練習英文文章跟讀，提升口語流暢度與語感。每句拆分成小段，標示重音，可錄音對比並評分。
      </p>

      <div className="card p-4 bg-gradient-to-br from-emerald-500/10 to-sky-500/10 border-emerald-500/30 mb-4">
        <div className="flex items-start gap-3">
          <div className="text-3xl">📖</div>
          <div className="flex-1">
            <div className="font-semibold mb-1">內建示範：Brunch & Dim Sum (A2)</div>
            <p className="text-sm text-slate-300 mb-3">
              完整的跟讀腳本，包含 4 個部分、35 個句子，標示重音和停頓點。適合初級至中級學習者。
            </p>
            <button className="btn ghost text-sm" onClick={loadDemo}>
              {articles?.some(a => a.title === BRUNCH_DIMSUM_TITLE) ? '已載入，前往練習 →' : '✨ 一鍵載入示範'}
            </button>
          </div>
        </div>
      </div>

      {!articles || articles.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-slate-400 text-sm">載入示範文章開始練習，或點擊右上角「＋ 新增文章」新增自己的文章。</div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {articles.map((article) => {
            const progress = calculateScriptProgress(article)
            const totalSentences = article.parts.reduce((sum, p) => sum + p.sentences.length, 0)

            return (
              <div key={article.id} className="relative">
                {selectMode ? (
                  <button
                    onClick={() => toggleSelect(article.id!)}
                    className={`card w-full text-left transition-all ${
                      selected.has(article.id!) ? 'border-sky-500 bg-sky-500/10' : 'hover:border-sky-500/60'
                    }`}
                  >
                    <div className="p-4">
                      <div className="flex items-start gap-3 mb-3">
                        <div className={`w-6 h-6 rounded border-2 shrink-0 mt-0.5 grid place-items-center ${
                          selected.has(article.id!) ? 'bg-sky-500 border-sky-500' : 'border-line'
                        }`}>
                          {selected.has(article.id!) && <span className="text-sm">✓</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold leading-snug line-clamp-2">{article.title}</h3>
                          {article.level && (
                            <span className="text-xs text-slate-400">{article.level}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-slate-400">
                        {article.parts.length} 部分 · {totalSentences} 句
                      </div>
                      <div className="mt-2">
                        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                          <span>進度</span>
                          <span className="font-medium text-sky-400">{progress}%</span>
                        </div>
                        <div className="h-1.5 bg-panel rounded-full overflow-hidden">
                          <div className="h-full bg-sky-500 transition-all" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    </div>
                  </button>
                ) : (
                  <>
                    <Link
                      to={`/articles/${article.id}`}
                      className="card block hover:border-sky-500/60 transition-colors"
                    >
                      <div className="p-4">
                        <h3 className="font-semibold leading-snug line-clamp-2 mb-1">{article.title}</h3>
                        {article.level && (
                          <span className="text-xs text-slate-400">{article.level}</span>
                        )}
                        <div className="mt-2 text-xs text-slate-400">
                          {article.parts.length} 部分 · {totalSentences} 句
                        </div>
                        <div className="mt-3">
                          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                            <span>進度</span>
                            <span className="font-medium text-sky-400">{progress}%</span>
                          </div>
                          <div className="h-1.5 bg-panel rounded-full overflow-hidden">
                            <div className="h-full bg-sky-500 transition-all" style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                      </div>
                    </Link>
                    <button
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/70 hover:bg-rose-600 grid place-items-center text-lg transition-colors z-10"
                      onClick={(e) => {
                        e.preventDefault()
                        setDeleting(article.id!)
                      }}
                      title="刪除文章"
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {deleting && (
        <div className="fixed inset-0 bg-black/60 grid place-items-center z-50 p-4" onClick={() => setDeleting(null)}>
          <div className="card max-w-sm w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold text-lg">確定要刪除文章？</div>
            <p className="text-slate-300 text-sm">刪除後無法復原。</p>
            <div className="flex gap-3 justify-end">
              <button className="btn ghost" onClick={() => setDeleting(null)}>取消</button>
              <button className="btn bg-rose-600 hover:bg-rose-700" onClick={() => handleDeleteOne(deleting)}>
                確定刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </Page>
  )
}

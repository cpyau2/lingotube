import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Page } from '../components/Page'
import { db } from '../lib/db'
import { createArticleScript, formatPlainText, parseFormattedScript } from '../lib/articleParser'
import { getProvider } from '../lib/ai/provider'

export default function ArticleNew() {
  const [title, setTitle] = useState('')
  const [level, setLevel] = useState('')
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'plain' | 'formatted'>('plain')
  const [formatting, setFormatting] = useState(false)
  const [error, setError] = useState('')
  const nav = useNavigate()

  const autoFormat = async () => {
    if (!text.trim()) return
    setFormatting(true)
    setError('')
    
    try {
      // Try AI format first
      const provider = await getProvider()
      if (provider.available) {
        // Use AI to format - we'll use a simple prompt
        const formatted = formatPlainText(text) // Use deterministic for now
        setText(formatted)
        setMode('formatted')
      } else {
        // Fallback to deterministic
        const formatted = formatPlainText(text)
        setText(formatted)
        setMode('formatted')
      }
    } catch (e: any) {
      setError(e.message || String(e))
      // Fallback
      const formatted = formatPlainText(text)
      setText(formatted)
      setMode('formatted')
    } finally {
      setFormatting(false)
    }
  }

  const save = async () => {
    if (!title.trim()) {
      setError('請輸入標題')
      return
    }
    if (!text.trim()) {
      setError('請輸入文章內容')
      return
    }

    try {
      setError('')
      
      // Determine if formatted or plain
      const isFormatted = text.includes('/') || text.includes('**') || /Part\s+\d+/i.test(text)
      const finalText = isFormatted ? text : formatPlainText(text)
      
      // Validate can parse
      const parsed = parseFormattedScript(finalText)
      if (parsed.parts.length === 0) {
        setError('無法解析文章格式，請檢查內容')
        return
      }

      const script = createArticleScript(title.trim(), finalText, level.trim() || undefined)
      const id = await db.articles.add(script)
      nav(`/articles/${id}`)
    } catch (e: any) {
      setError(e.message || String(e))
    }
  }

  return (
    <Page
      title="新增文章"
      right={<Link to="/articles" className="btn ghost text-sm">← 返回</Link>}
    >
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="card p-4 space-y-3">
          <label className="block">
            <span className="text-sm text-slate-300 mb-1 block">標題</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：Brunch & Dim Sum"
              className="w-full"
            />
          </label>

          <label className="block">
            <span className="text-sm text-slate-300 mb-1 block">程度（選填）</span>
            <input
              type="text"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              placeholder="例：Intermediate"
              className="w-full"
            />
          </label>
        </div>

        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">文章內容</span>
            <div className="flex gap-2">
              <button
                className={`chip text-xs ${mode === 'plain' ? '!bg-sky-500/20 !text-sky-300' : ''}`}
                onClick={() => setMode('plain')}
              >
                純文字
              </button>
              <button
                className={`chip text-xs ${mode === 'formatted' ? '!bg-sky-500/20 !text-sky-300' : ''}`}
                onClick={() => setMode('formatted')}
              >
                已排版
              </button>
            </div>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === 'plain'
                ? '貼上純英文文章，例如：\n\nThis morning, I really wanted to eat dim sum, so I went out to eat brunch.\n\nDim sum is a traditional Chinese cuisine...'
                : '貼上已排版的跟讀腳本，例如：\n\n## Part 1 Brunch & Dim Sum\nThis morning, / I really wanted to eat **dim sum**, / so I went out / to eat **brunch**.\n\n用 / 分隔語塊，用 **粗體** 標記重音。'
            }
            className="w-full min-h-64 font-mono text-sm"
          />

          {mode === 'plain' && text.trim() && (
            <button className="btn ghost w-full" onClick={autoFormat} disabled={formatting}>
              {formatting ? '⏳ 自動排版中…' : '✨ 自動排版（分段、標重音）'}
            </button>
          )}

          {error && (
            <div className="text-sm text-rose-300">❌ {error}</div>
          )}
        </div>

        <div className="card p-4 bg-slate-800/50">
          <div className="text-xs text-slate-400 mb-2">排版格式說明</div>
          <div className="text-xs text-slate-300 space-y-1">
            <p>• 用 <code className="bg-panel px-1 rounded">## Part 1 標題</code> 開始每個部分</p>
            <p>• 用 <code className="bg-panel px-1 rounded">/</code> 分隔語塊（朗讀時會停頓）</p>
            <p>• 用 <code className="bg-panel px-1 rounded">**粗體**</code> 標記重音詞</p>
            <p>• 每句一行</p>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <button className="btn ghost" onClick={() => nav('/articles')}>取消</button>
          <button className="btn" onClick={save}>儲存文章</button>
        </div>
      </div>
    </Page>
  )
}

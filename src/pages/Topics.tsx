import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Page } from '../components/Page'
import { db } from '../lib/db'
import type { TopicGroup } from '../lib/ai/provider'

export default function Topics() {
  const words = useLiveQuery(() => db.words.toArray(), [])
  const sentences = useLiveQuery(() => db.sentences.toArray(), [])
  const videos = useLiveQuery(() => db.videos.toArray(), [])
  const [topics, setTopics] = useState<TopicGroup[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadCached = async () => {
      const cached = await db.kv.get('topics-cache')
      if (cached?.value) {
        setTopics(cached.value as TopicGroup[])
      }
    }
    loadCached()
  }, [])

  const generate = async () => {
    if (!words || !sentences || !videos) return
    setLoading(true)
    setError('')

    try {
      const items: { id: string; text: string }[] = []
      
      // add words
      words.forEach((w) => {
        items.push({ id: `word:${w.id}`, text: `${w.word}: ${w.context}` })
      })
      
      // add sentences
      sentences.forEach((s) => {
        items.push({ id: `sentence:${s.id}`, text: s.en })
      })
      
      // add video titles
      videos.forEach((v) => {
        items.push({ id: `video:${v.id}`, text: v.title })
      })

      if (items.length === 0) {
        setError('未有收藏的生字或句子')
        setLoading(false)
        return
      }

      const { getProvider } = await import('../lib/ai/provider')
      const provider = await getProvider()

      if (!provider.available) {
        throw new Error('尚未設定 AI 服務。你可以在「設定」輸入 API key，或使用已部署嘅 Workers AI。')
      }

      const result = await provider.groupTopics(items)
      setTopics(result)
      await db.kv.put({ key: 'topics-cache', value: result })
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const getItemLink = (id: string) => {
    const [type, rawId] = id.split(':')
    if (type === 'video') return `/watch/${rawId}`
    if (type === 'sentence') return '/saved?tab=sentences'
    if (type === 'word') return '/saved?tab=words'
    return '/saved'
  }

  return (
    <Page title="主題收藏">
      <div className="space-y-4">
        <div className="card p-4">
          <p className="text-sm text-slate-400 mb-3">
            自動將你收藏的生字、句子和影片按主題分組（例如「心理·自信」「科技」「日常對話」）。
          </p>
          <button 
            className="btn" 
            onClick={generate} 
            disabled={loading || !words?.length}
          >
            {loading ? '🔄 生成中…' : topics ? '🔄 重新生成主題' : '✨ 生成主題分組'}
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

        {!topics && !loading && !error && (
          <div className="card p-6 text-center text-slate-400">
            <div className="text-4xl mb-3">🗂️</div>
            <p className="text-sm">
              點擊上方按鈕生成主題分組
            </p>
          </div>
        )}

        {topics && topics.length > 0 && (
          <div className="space-y-3">
            {topics.map((topic, i) => (
              <div key={i} className="card p-4">
                <div className="font-semibold text-lg mb-1">{topic.topicZh}</div>
                <div className="text-sm text-slate-400 mb-3">{topic.topic}</div>
                <div className="space-y-1.5">
                  {topic.itemIds.map((id) => {
                    const [type, rawId] = id.split(':')
                    let label = id
                    let icon = '•'
                    
                    if (type === 'word') {
                      const w = words?.find((w) => String(w.id) === rawId)
                      if (w) {
                        label = w.word
                        icon = '📝'
                      }
                    } else if (type === 'sentence') {
                      const s = sentences?.find((s) => String(s.id) === rawId)
                      if (s) {
                        label = s.en.slice(0, 60) + (s.en.length > 60 ? '…' : '')
                        icon = '💬'
                      }
                    } else if (type === 'video') {
                      const v = videos?.find((v) => v.id === rawId)
                      if (v) {
                        label = v.title
                        icon = '🎬'
                      }
                    }

                    return (
                      <Link
                        key={id}
                        to={getItemLink(id)}
                        className="flex gap-2 items-start text-sm text-slate-300 hover:text-sky-400 transition-colors"
                      >
                        <span className="shrink-0">{icon}</span>
                        <span className="line-clamp-2">{label}</span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {topics && topics.length === 0 && !loading && (
          <div className="card p-6 text-center text-slate-400">
            <p className="text-sm">未能生成主題分組，請嘗試收藏更多內容。</p>
          </div>
        )}
      </div>
    </Page>
  )
}

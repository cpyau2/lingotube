import { useEffect, useRef, useState } from 'react'
import { Page, SoonPanel } from '../components/Page'
import { DEFAULT_AI_SETTINGS, loadAISettings, saveAISettings, type AISettings } from '../lib/ai/provider'
import { loadStructureTier, saveStructureTier, type StructureTier } from '../lib/structureTier'
import { db, exportAll, importAll } from '../lib/db'
import { DEFAULT_PROXY } from '../lib/captionsProxy'
import { speak, ttsSupported } from '../lib/tts'
import { SyncPanel } from '../components/SyncPanel'

export default function Settings() {
  const [ai, setAi] = useState<AISettings>(DEFAULT_AI_SETTINGS)
  const [structureTier, setStructureTier] = useState<StructureTier>('accurate')
  const [proxy, setProxy] = useState(DEFAULT_PROXY)
  const [msg, setMsg] = useState('')
  const [testMsg, setTestMsg] = useState('')
  const [testing, setTesting] = useState(false)
  const [installEvt, setInstallEvt] = useState<any>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadAISettings().then(setAi)
    setStructureTier(loadStructureTier())
    db.kv.get('proxy-url').then((r) => r && setProxy(r.value as string))
    const h = (e: Event) => { e.preventDefault(); setInstallEvt(e) }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])

  const save = async () => {
    await saveAISettings(ai); await db.kv.put({ key: 'proxy-url', value: proxy })
    setMsg('已儲存（只存喺這部裝置）'); setTimeout(() => setMsg(''), 2500)
  }
  
  const testAI = async () => {
    setTesting(true)
    setTestMsg('')
    try {
      await saveAISettings(ai)
      const { getProvider } = await import('../lib/ai/provider')
      const provider = await getProvider()
      if (!provider.available) {
        setTestMsg('❌ 未設定 AI 服務')
        return
      }
      const result = await provider.translate(['Hello world'], 'zh-Hant')
      if (result && result.length > 0) {
        setTestMsg(`✅ 連線成功！（${provider.label}）`)
      } else {
        setTestMsg('❌ AI 回應異常')
      }
    } catch (e: any) {
      setTestMsg(`❌ 連線失敗：${e.message || e}`)
    } finally {
      setTesting(false)
      setTimeout(() => setTestMsg(''), 5000)
    }
  }
  
  const doExport = async () => {
    const blob = new Blob([JSON.stringify(await exportAll(), null, 1)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `lingotube-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click()
  }
  const doImport = async (f?: File) => {
    if (!f) return
    try { await importAll(JSON.parse(await f.text())); setMsg('匯入完成') } catch (e: any) { setMsg(String(e.message ?? e)) }
  }

  return (
    <Page title="設定">
      <div className="space-y-5">
        {installEvt && (
          <div className="card p-4 flex items-center justify-between gap-3">
            <div><div className="font-semibold">安裝到主畫面</div><div className="text-sm text-slate-400">像 App 一樣全螢幕使用，離線都得。</div></div>
            <button className="btn" onClick={() => installEvt.prompt()}>安裝</button>
          </div>
        )}

        <div className="card p-4 space-y-3" data-testid="ai-settings">
          <div className="font-semibold">AI 服務</div>
          <p className="text-sm text-slate-400">用於翻譯、句型解釋、練習題與主題分組。未設定時會使用 Cloudflare Workers AI（免費但功能較簡單）。BYOK 可獲得更好效果。Key 只儲存喺你這部裝置的瀏覽器，不會上傳。</p>
          {!(ai.provider === 'openai-compatible' && ai.apiKey) && (
            <div className="space-y-2" data-testid="structure-tier">
              <div className="text-sm text-slate-300">句型拆解模式</div>
              <div className="flex gap-2">
                {([
                  { value: 'accurate' as const, label: '精準' },
                  { value: 'fast' as const, label: '慳額度' },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    data-testid={`structure-tier-${opt.value}`}
                    aria-pressed={structureTier === opt.value}
                    onClick={() => { setStructureTier(opt.value); saveStructureTier(opt.value) }}
                    className={`chip ${structureTier === opt.value ? 'bg-sky-500/20 text-sky-200 border-sky-400/50' : ''}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500" lang="zh-Hant">
                精準用 70B 大模型，較準但較耗額度；慳額度用 8B 細模型，快啲、用量約六分之一，長句可能拆得冇咁準。
              </p>
            </div>
          )}
          <label className="block text-sm space-y-1"><span className="text-slate-300">服務類型</span>
            <select value={ai.provider} onChange={(e) => setAi({ ...ai, provider: e.target.value as AISettings['provider'] })}>
              <option value="none">不使用 AI</option>
              <option value="openai-compatible">OpenAI 相容（OpenAI / OpenRouter / Groq / Ollama…）</option>
            </select></label>
          {ai.provider === 'openai-compatible' && (
            <>
              <label className="block text-sm space-y-1"><span className="text-slate-300">Base URL</span><input type="text" value={ai.baseUrl} onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })} /></label>
              <label className="block text-sm space-y-1"><span className="text-slate-300">Model</span><input type="text" value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} /></label>
              <label className="block text-sm space-y-1"><span className="text-slate-300">API key</span><input type="password" autoComplete="off" value={ai.apiKey} onChange={(e) => setAi({ ...ai, apiKey: e.target.value })} placeholder="sk-…" /></label>
            </>
          )}
          <div className="flex gap-2">
            <button className="btn ghost" onClick={testAI} disabled={testing} data-testid="test-ai">
              {testing ? '測試中…' : '測試連線'}
            </button>
            {testMsg && <span className={`text-sm ${testMsg.startsWith('✅') ? 'text-emerald-300' : 'text-rose-300'}`}>{testMsg}</span>}
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <div className="font-semibold">字幕來源</div>
          <label className="block text-sm space-y-1"><span className="text-slate-300">本機字幕代理網址（可選）</span><input type="text" value={proxy} onChange={(e) => setProxy(e.target.value)} /></label>
          <p className="text-xs text-slate-500">在你電腦執行 <code>npm run captions-proxy</code>（需要安裝 yt-dlp），之後在首頁「加影片」可一鍵抓取字幕。</p>
        </div>

        <div className="flex items-center gap-3">
          <button className="btn" onClick={save} data-testid="save-settings">儲存設定</button>
          {msg && <span className="text-sm text-emerald-300">{msg}</span>}
        </div>

        <SyncPanel />

        <div className="card p-4 space-y-3">
          <div className="font-semibold">資料備份</div>
          <p className="text-sm text-slate-400">所有生字、句子、影片都只存喺這部裝置。換機前請先匯出。（匯出不含 API key）</p>
          <div className="flex gap-2 flex-wrap">
            <button className="btn ghost" onClick={doExport}>匯出 JSON</button>
            <button className="btn ghost" onClick={() => fileRef.current?.click()}>匯入 JSON</button>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => doImport(e.target.files?.[0])} />
          </div>
        </div>

        <div className="card p-4 space-y-2">
          <div className="font-semibold">發音測試</div>
          <button className="btn ghost" onClick={() => speak('Confidence turns thoughts into action.')}>🔊 播放示範句</button>
          {!ttsSupported() && <div className="text-sm text-amber-300">這個瀏覽器不支援語音合成。</div>}
        </div>

        <div className="card p-4 space-y-2">
          <div className="font-semibold">🎙️ 語音辨識（跟讀）</div>
          <p className="text-sm text-slate-400">使用瀏覽器的 SpeechRecognition API（Chrome / Safari）。不支援的瀏覽器會顯示備用方案。</p>
        </div>
      </div>
    </Page>
  )
}

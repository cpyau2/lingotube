import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { renderSVG } from 'uqr'
import {
  createSyncCode,
  formatLastSynced,
  formatSyncCode,
  isValidSyncCode,
  joinSyncCode,
  stopSync,
  subscribeSyncStatus,
  syncNow,
  type SyncStatus,
} from '../lib/sync'

export function SyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [joinOpen, setJoinOpen] = useState(false)
  const [joinInput, setJoinInput] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)
  const [params, setParams] = useSearchParams()

  useEffect(() => subscribeSyncStatus(setStatus), [])

  useEffect(() => {
    const q = params.get('join')
    if (q) {
      setJoinInput(formatSyncCode(q))
      setJoinOpen(true)
      params.delete('join')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  const qr = useMemo(() => {
    if (!status?.code) return ''
    const url = `${location.origin}${location.pathname}#/settings?join=${encodeURIComponent(status.code)}`
    return renderSVG(url, { border: 2 })
  }, [status?.code])

  const flash = (t: string) => { setMsg(t); window.setTimeout(() => setMsg(''), 3500) }

  const onCreate = async () => {
    setBusy('create')
    try {
      await createSyncCode()
      flash('已建立同步碼。請喺其他裝置輸入同一組代碼。')
    } catch (e: any) {
      flash(e?.message || String(e))
    } finally { setBusy('') }
  }

  const onJoin = async () => {
    if (!isValidSyncCode(joinInput)) { flash('同步碼格式唔正確（應該係一組 xxxx-xxxx-… 嘅代碼）'); return }
    setBusy('join')
    try {
      await joinSyncCode(joinInput)
      setJoinOpen(false)
      setJoinInput('')
      flash('已加入同步。本機原有資料會同另一邊合併，唔會被清走。')
    } catch (e: any) {
      flash(e?.message || String(e))
    } finally { setBusy('') }
  }

  const onSync = async () => {
    setBusy('sync')
    try {
      const s = await syncNow()
      flash(s.error || '同步完成')
    } finally { setBusy('') }
  }

  const onCopy = async () => {
    if (!status?.code) return
    try {
      await navigator.clipboard.writeText(status.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      flash('複製失敗，請手動選取同步碼。')
    }
  }

  const onStop = async () => {
    await stopSync()
    setConfirmStop(false)
    flash('已喺呢部裝置停止同步。同步碼已忘掉，本機資料仍然保留。')
  }

  return (
    <div className="card p-4 space-y-3" data-testid="sync-panel">
      <div className="font-semibold">裝置同步</div>
      <p className="text-sm text-slate-400">用一組同步碼，喺你其他裝置之間分享影片、字幕、生字同複習進度。唔使開帳戶。</p>
      <p className="text-sm text-amber-300">⚠️ 同步碼等同鎖匙。任何人拿到都可以讀同改你嘅資料，唔好傳俾其他人。</p>
      <p className="text-xs text-slate-500">跟讀錄音同 AI／語音快取只會留喺呢部裝置，唔會同步。</p>

      {!status?.code ? (
        <div className="flex flex-wrap gap-2">
          <button className="btn" data-testid="sync-create" disabled={!!busy} onClick={onCreate}>
            {busy === 'create' ? '建立緊…' : '建立同步碼'}
          </button>
          <button className="btn ghost" data-testid="sync-join-open" disabled={!!busy} onClick={() => setJoinOpen((v) => !v)}>
            輸入同步碼
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="text-xs text-slate-500 mb-1">目前同步碼</div>
            <div className="flex items-start gap-3 flex-wrap">
              <code className="text-base tracking-wider text-slate-100 break-all" data-testid="sync-code">{status.code}</code>
              <button className="btn ghost text-sm !py-1" data-testid="sync-copy" onClick={onCopy}>{copied ? '已複製' : '複製'}</button>
            </div>
          </div>
          {qr && (
            <div className="flex items-start gap-3">
              <div
                data-testid="sync-qr"
                className="w-36 h-36 bg-white rounded-lg p-1.5 [&>svg]:w-full [&>svg]:h-full"
                aria-label="同步碼 QR"
                dangerouslySetInnerHTML={{ __html: qr }}
              />
              <p className="text-xs text-slate-500 flex-1">用另一部裝置掃呢個 QR，會開啟本 App 嘅設定頁並帶入同步碼。唔好將呢張圖傳俾其他人。</p>
            </div>
          )}
          <div className="text-sm text-slate-400" data-testid="sync-last">
            上次同步：{status.syncing ? '同步緊…' : formatLastSynced(status.lastSyncedAt)}
          </div>
          {status.error && <div className="text-sm text-rose-300" data-testid="sync-error">{status.error}</div>}
          <div className="flex flex-wrap gap-2">
            <button className="btn" data-testid="sync-now" disabled={!!busy || status.syncing} onClick={onSync}>
              {busy === 'sync' || status.syncing ? '同步緊…' : '立即同步'}
            </button>
            <button className="btn ghost" data-testid="sync-stop" disabled={!!busy} onClick={() => setConfirmStop(true)}>停止同步</button>
          </div>
        </div>
      )}

      {joinOpen && !status?.code && (
        <div className="space-y-2 pt-1" data-testid="sync-join-form">
          <label className="block text-sm space-y-1">
            <span className="text-slate-300">另一部裝置嘅同步碼</span>
            <input
              data-testid="sync-join-input"
              type="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx"
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
            />
          </label>
          <button className="btn" data-testid="sync-join-submit" disabled={!!busy} onClick={onJoin}>
            {busy === 'join' ? '加入緊…' : '加入並同步'}
          </button>
        </div>
      )}

      {confirmStop && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 space-y-2">
          <p className="text-sm text-slate-200">確定喺呢部裝置停止同步？同步碼會被忘掉，但本機資料唔會刪除。</p>
          <div className="flex gap-2">
            <button className="btn bg-rose-600 hover:bg-rose-700" data-testid="sync-stop-confirm" onClick={onStop}>確定停止</button>
            <button className="btn ghost" onClick={() => setConfirmStop(false)}>取消</button>
          </div>
        </div>
      )}

      {msg && <div className="text-sm text-emerald-300" data-testid="sync-msg">{msg}</div>}
    </div>
  )
}

import { useState } from 'react'
import type { TimerService } from '../../application/TimerService'
import type { FocusSession } from '../../domain/models'

interface RecoveryDialogProps {
  activeSession: FocusSession
  timerService: TimerService
  now?: () => Date
  onRecovered: () => Promise<void> | void
}

export function RecoveryDialog({ activeSession, timerService, now = () => new Date(), onRecovered }: RecoveryDialogProps) {
  const [manual, setManual] = useState(false)
  const [endedAt, setEndedAt] = useState(formatDateTimeLocal(now()))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resolved, setResolved] = useState(false)

  async function recover(choice: 'end_now' | 'discard' | 'end_at') {
    setSaving(true)
    setError(null)
    try {
      const current = now()
      if (choice === 'end_at') {
        const manualEnd = new Date(endedAt)
        if (Number.isNaN(manualEnd.getTime()) || manualEnd <= new Date(activeSession.startedAt) || manualEnd > current) {
          throw new Error('专注时间范围无效')
        }
        await timerService.recover({ type: 'end_at', endedAt: manualEnd, now: current })
      } else if (choice === 'discard') {
        await timerService.recover({ type: 'discard' }, current)
      } else {
        await timerService.recover({ type: 'end_now', now: current })
      }
      await onRecovered()
      setResolved(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '恢复失败，请重试')
      setSaving(false)
    }
  }

  if (resolved) return null

  return <div className="dialog-backdrop recovery-backdrop">
    <section className="entity-dialog recovery-dialog" role="dialog" aria-modal="true" aria-label="恢复未结束的计时">
      <header className="dialog-header"><div><span className="eyebrow">需要处理</span><h2>恢复未结束的计时</h2></div></header>
      <p>检测到应用上次退出时仍在进行的专注记录。请先处理这条记录，再继续使用 Focus Mind。</p>
      {manual && <label className="field"><span>结束时间</span><input type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} required /></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="dialog-actions recovery-actions">
        <button className="button-secondary" type="button" disabled={saving} onClick={() => setManual(true)}>手动设置结束时间</button>
        <button className="button-secondary" type="button" disabled={saving} onClick={() => { void recover('discard') }}>放弃本次记录</button>
        {manual
          ? <button className="button-primary" type="button" disabled={saving} onClick={() => { void recover('end_at') }}>确认结束</button>
          : <button className="button-primary" type="button" disabled={saving} onClick={() => { void recover('end_now') }}>现在结束</button>}
      </footer>
    </section>
  </div>
}

function formatDateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

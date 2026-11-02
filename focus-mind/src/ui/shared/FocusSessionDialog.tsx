import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { FocusSessionSegment } from '../../application/ScheduleService'
import type { TimerService } from '../../application/TimerService'

interface FocusSessionDialogProps {
  segment: FocusSessionSegment
  timerService: TimerService
  now?: () => Date
  onClose: () => void
  onChanged: () => Promise<void>
}

export function FocusSessionDialog({ segment, timerService, now = () => new Date(), onClose, onChanged }: FocusSessionDialogProps) {
  const [startedAt, setStartedAt] = useState(formatDateTimeLocal(new Date(segment.sourceStartedAt)))
  const [endedAt, setEndedAt] = useState(formatDateTimeLocal(new Date(segment.sourceEndedAt ?? segment.endedAt)))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const startRef = useRef<HTMLInputElement>(null)

  useEffect(() => { startRef.current?.focus() }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await timerService.updateSession({
        taskId: segment.taskId,
        sessionId: segment.sessionId,
        startedAt,
        endedAt,
      }, now())
      await onChanged()
      onClose()
    } catch (caught) {
      setError(messageFor(caught))
      setSaving(false)
    }
  }

  async function deleteRecord() {
    setSaving(true)
    setError(null)
    try {
      await timerService.deleteSession(segment.sessionId)
      await onChanged()
      onClose()
    } catch (caught) {
      setError(messageFor(caught))
      setSaving(false)
    }
  }

  return <div className="dialog-backdrop" onKeyDown={(event) => { if (event.key === 'Escape' && !saving) onClose() }}>
    <section className="entity-dialog focus-session-dialog" role="dialog" aria-modal="true" aria-label="编辑专注记录">
      <header className="dialog-header">
        <div><span className="eyebrow">{segment.theme.name} · {segment.goal.name}</span><h2>编辑专注记录</h2></div>
        <button className="icon-button" type="button" aria-label="关闭" disabled={saving} onClick={onClose}>×</button>
      </header>
      <div className="focus-session-task"><i style={{ background: segment.theme.color }} /><div><strong>{segment.task.name}</strong><span>时长由开始和结束时间自动计算</span></div></div>
      <form onSubmit={(event) => { void submit(event) }}>
        <label className="field"><span>开始时间</span><input ref={startRef} type="datetime-local" required value={startedAt} onChange={(event) => setStartedAt(event.target.value)} /></label>
        <label className="field"><span>结束时间</span><input type="datetime-local" required value={endedAt} onChange={(event) => setEndedAt(event.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {confirmingDelete && <p className="focus-delete-confirm">删除后日、周、月统计会立即刷新，此操作无法撤销。</p>}
        <footer className="dialog-actions focus-dialog-actions">
          {confirmingDelete
            ? <button className="button-danger" type="button" disabled={saving} aria-label="确认删除记录" onClick={() => { void deleteRecord() }}>{saving ? '删除中…' : '确认删除'}</button>
            : <button className="button-secondary focus-delete" type="button" disabled={saving} onClick={() => setConfirmingDelete(true)}>删除记录</button>}
          <span />
          <button className="button-secondary" type="button" disabled={saving} onClick={onClose}>取消</button>
          <button className="button-primary" type="submit" disabled={saving}>{saving ? '保存中…' : '保存记录'}</button>
        </footer>
      </form>
    </section>
  </div>
}

function formatDateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请重试'
}

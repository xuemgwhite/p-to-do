import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ManualFocusInterval, TaskService, TaskTargetInput } from '../../application/TaskService'
import type { LocalDate } from '../../domain/models'

interface CompletionDialogProps {
  target: TaskTargetInput
  taskName: string
  now: Date
  initialDate?: LocalDate
  taskService: TaskService
  onClose: () => void
  onCompleted: () => Promise<void>
}

export function CompletionDialog({ target, taskName, now, initialDate, taskService, onClose, onCompleted }: CompletionDialogProps) {
  const defaultStart = new Date(now.getTime() - 30 * 60_000)
  const [date, setDate] = useState(initialDate ?? formatDate(now))
  const [startedTime, setStartedTime] = useState(formatTime(defaultStart))
  const [endedTime, setEndedTime] = useState(formatTime(now))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const startRef = useRef<HTMLInputElement>(null)
  useEffect(() => { startRef.current?.focus() }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    const endedAt = localDateTime(date, endedTime)
    const sameDayStart = localDateTime(date, startedTime)
    const interval: ManualFocusInterval = { startedAt: sameDayStart > endedAt ? new Date(sameDayStart.getTime() - 86_400_000) : sameDayStart, endedAt }
    try {
      await taskService.completeTask(target, endedAt, interval, date as LocalDate)
      await onCompleted()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '完成失败，请重试')
      setSaving(false)
    }
  }

  return <div className="dialog-backdrop" onKeyDown={(event) => { if (event.key === 'Escape' && !saving) onClose() }}>
    <section className="entity-dialog completion-dialog" role="dialog" aria-modal="true" aria-label="完成任务">
      <header className="dialog-header"><div><span className="eyebrow">补填专注记录</span><h2>完成任务</h2></div><button className="icon-button" type="button" aria-label="关闭" disabled={saving} onClick={onClose}>×</button></header>
      <p>“{taskName}”还没有专注记录，请填写本次实际专注时间。</p>
      <form onSubmit={(event) => { void submit(event) }}>
        <label className="field"><span>完成日期</span><input ref={startRef} type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <div className="field-row">
          <label className="field"><span>开始时刻</span><input className="numeric" type="time" step="60" required value={startedTime} onChange={(event) => setStartedTime(event.target.value)} /></label>
          <label className="field"><span>完成时刻</span><input className="numeric" type="time" step="60" required value={endedTime} onChange={(event) => setEndedTime(event.target.value)} /></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="dialog-actions"><button className="button-secondary" type="button" disabled={saving} onClick={onClose}>取消</button><button className="button-primary" type="submit" disabled={saving}>{saving ? '完成中…' : '确认完成'}</button></footer>
      </form>
    </section>
  </div>
}

function formatDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
function formatTime(date: Date): string { return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
function localDateTime(date: string, time: string): Date { return new Date(`${date}T${time}:00`) }

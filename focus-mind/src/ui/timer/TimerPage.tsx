import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ScheduleService, ScheduleTaskItem, WeeklyQuotaReminder } from '../../application/ScheduleService'
import type { TimerService } from '../../application/TimerService'
import { splitIntervalByLocalDay, startOfLocalDay, toLocalDate } from '../../domain/dates'
import type { FocusSession } from '../../domain/models'
import './timer.css'

type Candidate = ScheduleTaskItem | WeeklyQuotaReminder

interface TimerPageProps {
  timerService: TimerService
  scheduleService: ScheduleService
  now?: () => Date
}

interface TimerState {
  candidates: Candidate[]
  active: FocusSession | null
  records: FocusSession[]
  taskNames: Record<string, string>
}

const systemNow = () => new Date()

export function TimerPage({ timerService, scheduleService, now = systemNow }: TimerPageProps) {
  const [state, setState] = useState<TimerState | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [displayNow, setDisplayNow] = useState(Date.now())
  const [error, setError] = useState<string | null>(null)
  const today = toLocalDate(now())

  const refresh = useCallback(async () => {
    const dayStart = startOfLocalDay(today)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const [day, active, records] = await Promise.all([
      scheduleService.getDay(today, now()),
      timerService.getActiveSession(),
      timerService.listSessions(dayStart.toISOString(), dayEnd.toISOString()),
    ])
    const candidates = [...day.pending, ...day.weeklyQuotaReminders]
    const taskIds = [...new Set(records.map((record) => record.taskId))]
    const taskNames = Object.fromEntries((await Promise.all(taskIds.map(async (taskId) => [taskId, await timerService.getTaskName(taskId)] as const)))
      .filter((entry): entry is readonly [string, string] => entry[1] !== null))
    setState({ candidates, active, records, taskNames })
    setSelectedId((current) => current ?? candidateIdForSession(candidates, active) ?? candidates[0]?.id ?? null)
  }, [now, scheduleService, timerService, today])

  useEffect(() => { void refresh().catch((caught) => setError(messageFor(caught))) }, [refresh])
  useEffect(() => {
    if (state?.active === null || state?.active === undefined) return
    setDisplayNow(Date.now())
    const interval = window.setInterval(() => setDisplayNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [state?.active])

  const selected = useMemo(() => state?.candidates.find((candidate) => candidate.id === selectedId) ?? null, [selectedId, state?.candidates])
  const activeMatchesSelected = selected !== null && matchesSession(selected, state?.active ?? null)
  const elapsed = state?.active === null || state?.active === undefined ? 0 : Math.max(0, displayNow - new Date(state.active.startedAt).getTime())

  async function toggle() {
    if (selected === null) return
    try {
      setError(null)
      if (activeMatchesSelected) await timerService.stop(now())
      else await timerService.start({ taskId: selected.task.id, occurrenceId: occurrenceIdFor(selected) }, now())
      await refresh()
    } catch (caught) {
      setError(messageFor(caught))
    }
  }

  const totalDuration = state === null ? 0 : state.records.reduce((total, record) => total + durationForToday(record, today, now()), 0)
  const sortedRecords = state === null ? [] : [...state.records].sort((left, right) => right.startedAt.localeCompare(left.startedAt))
  return <main className="timer-page">
    {state === null
      ? <p role="status">正在载入计时器…</p>
      : <div className="timer-content">
        <section className="timer-stage" aria-label="计时控制">
          <div className="timer-stage-center">
            <label className="timer-task-select"><ListIcon /><select aria-label="选择计时任务" value={selectedId ?? ''} disabled={state.candidates.length === 0} onChange={(event) => setSelectedId(event.target.value || null)}><option value="" disabled>{state.candidates.length === 0 ? '今天没有可开始的任务' : '选择一个任务'}</option>{state.candidates.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.task.name}</option>)}</select><ChevronIcon /></label>
            <strong className="timer-digits" data-testid="elapsed-time">{formatElapsed(elapsed)}</strong>
            <button className={`timer-primary-control${activeMatchesSelected ? ' is-active' : ''}`} type="button" disabled={selected === null} onClick={() => { void toggle() }}>
              {activeMatchesSelected ? <StopIcon /> : <PlayIcon />}
              <span className="sr-only">{activeMatchesSelected ? '结束计时' : '开始计时'}</span>
            </button>
          </div>
        </section>

        <aside className="timer-records-panel" aria-label="今日专注记录">
          <section className="timer-overview" aria-labelledby="timer-overview-title">
            <h2 id="timer-overview-title">今日概览</h2>
            <div className="timer-overview-card">
              <span><b>{state.records.length}</b><small>专注</small></span>
              <span><b>{formatSummaryDuration(totalDuration)}</b><small>总时长</small></span>
            </div>
          </section>
          <section className="timer-records" aria-labelledby="timer-records-title">
            <h2 id="timer-records-title">今日记录</h2>
            <div className="timer-record-list">
              {sortedRecords.map((record) => <FocusRecordCard key={record.id} record={record} taskName={state.taskNames[record.taskId] ?? '专注任务'} today={today} current={now()} />)}
              {state.records.length === 0 && <p>今天还没有专注记录。</p>}
            </div>
          </section>
        </aside>
      </div>}
    {error && <div className="error-toast" role="alert">{error}</div>}
  </main>
}

function FocusRecordCard({ record, taskName, today, current }: { record: FocusSession; taskName: string; today: string; current: Date }) {
  const active = record.endedAt === null
  const duration = durationForToday(record, today, current)
  return <article className={`timer-record-card${active ? ' active' : ''}`} data-testid="focus-record">
    <header><span className="timer-record-title"><i />{taskName}</span><span className="timer-record-status">{active ? '专注中' : '已结束'}</span></header>
    <div className="timer-record-details">
      <div><small>开始</small><time dateTime={record.startedAt}>{formatClock(record.startedAt)}</time></div>
      {!active && <div><small>结束</small><time dateTime={record.endedAt ?? undefined}>{formatClock(record.endedAt ?? record.startedAt)}</time></div>}
      <strong>{formatSummaryDuration(duration)}</strong>
    </div>
  </article>
}

function occurrenceIdFor(candidate: Candidate): string | null | undefined {
  return 'occurrence' in candidate ? candidate.occurrence?.id ?? null : undefined
}

function matchesSession(candidate: Candidate, session: FocusSession | null): boolean {
  return session !== null && session.taskId === candidate.task.id && (occurrenceIdFor(candidate) === undefined || session.occurrenceId === occurrenceIdFor(candidate))
}

function candidateIdForSession(candidates: Candidate[], session: FocusSession | null): string | null {
  return session === null ? null : candidates.find((candidate) => matchesSession(candidate, session))?.id ?? null
}

function durationForToday(session: FocusSession, today: string, current: Date): number {
  const end = session.endedAt === null ? current : new Date(session.endedAt)
  if (end <= new Date(session.startedAt)) return 0
  return splitIntervalByLocalDay(new Date(session.startedAt), end).find((part) => part.date === today)?.durationMs ?? 0
}

function formatElapsed(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1_000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function formatSummaryDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000)
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} 小时`
  return `${minutes} 分钟`
}

function formatClock(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function ListIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h2v2H4V6Zm4 0h12v2H8V6ZM4 11h2v2H4v-2Zm4 0h12v2H8v-2ZM4 16h2v2H4v-2Zm4 0h12v2H8v-2Z" /></svg> }
function ChevronIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5 1.4 1.4-6.4 6.4-6.4-6.4L7 9Z" /></svg> }
function PlayIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7L8 5Z" /></svg> }
function StopIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7V7Z" /></svg> }

function messageFor(error: unknown): string { return error instanceof Error ? error.message : '操作失败，请重试' }

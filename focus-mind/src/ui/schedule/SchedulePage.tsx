import { addDays, addMonths, addWeeks, format, isValid, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useCallback, useEffect, useState } from 'react'
import type {
  DaySchedule,
  FocusSessionSegment,
  MonthSchedule,
  ScheduleService,
  ScheduleTaskItem,
  WeekSchedule,
  WeeklyQuotaReminder,
} from '../../application/ScheduleService'
import { ApplicationError, type TaskService, type TaskTargetInput } from '../../application/TaskService'
import type { TimerService } from '../../application/TimerService'
import { toLocalDate } from '../../domain/dates'
import type { FocusSession, LocalDate } from '../../domain/models'
import type { FocusMindRepository } from '../../ports/FocusMindRepository'
import { CompletionDialog } from '../shared/CompletionDialog'
import { FocusSessionDialog } from '../shared/FocusSessionDialog'
import { DayView } from './DayView'
import { MonthView } from './MonthView'
import './schedule.css'
import { WeekView } from './WeekView'

type ScheduleView = 'day' | 'week' | 'month'
type LoadedSchedule =
  | { view: 'day'; data: DaySchedule }
  | { view: 'week'; data: WeekSchedule }
  | { view: 'month'; data: MonthSchedule }

interface SchedulePageProps {
  repository: FocusMindRepository
  scheduleService: ScheduleService
  taskService: TaskService
  timerService: TimerService
  now?: () => Date
}

const systemNow = () => new Date()

export function SchedulePage({ repository, scheduleService, taskService, timerService, now = systemNow }: SchedulePageProps) {
  const [selection, setSelection] = useState(readSelection)
  const [loaded, setLoaded] = useState<LoadedSchedule | null>(null)
  const [activeSession, setActiveSession] = useState<FocusSession | null>(null)
  const [selectedSession, setSelectedSession] = useState<FocusSessionSegment | null>(null)
  const [completionTarget, setCompletionTarget] = useState<{ target: TaskTargetInput; name: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const today = toLocalDate(now())

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [data, active] = await Promise.all([
        selection.view === 'day'
          ? scheduleService.getDay(selection.date, now())
          : selection.view === 'week'
            ? scheduleService.getWeek(selection.date, now())
            : scheduleService.getMonth(selection.date, now()),
        repository.getActiveFocusSession(),
      ])
      setLoaded({ view: selection.view, data } as LoadedSchedule)
      setActiveSession(active)
      setError(null)
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setLoading(false)
    }
  }, [now, repository, scheduleService, selection.date, selection.view])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    function popState() { setSelection(readSelection()) }
    window.addEventListener('popstate', popState)
    return () => window.removeEventListener('popstate', popState)
  }, [])

  function select(next: { view: ScheduleView; date: LocalDate }) {
    const params = new URLSearchParams(window.location.search)
    params.set('view', next.view)
    params.set('date', next.date)
    window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`)
    setSelection(next)
  }

  function moveDate(direction: -1 | 1) {
    const date = parseISO(selection.date)
    const moved = selection.view === 'day'
      ? addDays(date, direction)
      : selection.view === 'week' ? addWeeks(date, direction) : addMonths(date, direction)
    select({ ...selection, date: toLocalDate(moved) })
  }

  async function start(item: ScheduleTaskItem | WeeklyQuotaReminder) {
    if (selection.date !== today) return
    try {
      const occurrenceId = 'occurrence' in item ? item.occurrence?.id ?? null : null
      if (activeSession?.taskId === item.task.id && activeSession.occurrenceId === occurrenceId) {
        await timerService.stop(now())
      } else {
        await timerService.start({ taskId: item.task.id, occurrenceId }, now())
      }
      await refresh()
    } catch (caught) {
      setError(messageFor(caught))
    }
  }

  async function complete(item: ScheduleTaskItem | WeeklyQuotaReminder) {
    try {
      const occurrenceId = 'occurrence' in item ? item.occurrence?.id ?? null : undefined
      const target = { taskId: item.task.id, occurrenceId }
      if (activeSession?.taskId === item.task.id && (occurrenceId === undefined || occurrenceId === null || activeSession.occurrenceId === occurrenceId)) {
        await timerService.stop(now())
      }
      await taskService.completeTask(target, now())
      await refresh()
    } catch (caught) {
      if (caught instanceof ApplicationError && caught.code === 'MANUAL_SESSION_REQUIRED') {
        setCompletionTarget({
          target: { taskId: item.task.id, occurrenceId: 'occurrence' in item ? item.occurrence?.id : undefined },
          name: item.task.name,
        })
      } else setError(messageFor(caught))
    }
  }

  async function restore(item: ScheduleTaskItem) {
    try {
      await taskService.restoreTask({ taskId: item.task.id, occurrenceId: item.occurrence?.id ?? null })
      await refresh()
    } catch (caught) {
      setError(messageFor(caught))
    }
  }

  return <main className="schedule-workspace">
    <section className="schedule-content">
      <header className="schedule-header">
        <div className="schedule-heading">
          <h1>{headingFor(selection.view, selection.date)}</h1>
        </div>
        <div className="schedule-controls">
          <div className="date-controls">
            <button type="button" aria-label={previousLabel(selection.view)} onClick={() => moveDate(-1)}>‹</button>
            <button type="button" onClick={() => select({ ...selection, date: today })}>今天</button>
            <button type="button" aria-label={nextLabel(selection.view)} onClick={() => moveDate(1)}>›</button>
          </div>
          <div className="view-switch" aria-label="日程视图">
            {([['day', '日'], ['week', '周'], ['month', '月']] as const).map(([view, label]) => <button
              key={view}
              type="button"
              aria-pressed={selection.view === view}
              onClick={() => select({ view, date: selection.date })}
            >{label}</button>)}
          </div>
        </div>
      </header>
      <div className="schedule-scroll">
        {loaded?.view === 'day' && selection.view === 'day' && <DayView schedule={loaded.data} today={today} activeSession={activeSession} onStart={start} onComplete={complete} onCompleteReminder={complete} onRestore={restore} />}
        {loaded?.view === 'week' && selection.view === 'week' && <WeekView schedule={loaded.data} today={today} onOpenSession={setSelectedSession} />}
        {loaded?.view === 'month' && selection.view === 'month' && <MonthView schedule={loaded.data} today={today} onOpenSession={setSelectedSession} />}
        {!loading && loaded === null && !error && <p className="schedule-empty">没有日程数据。</p>}
      </div>
    </section>
    {loading && loaded === null && <div className="loading-state" role="status">正在载入日程…</div>}
    {error && <div className="error-toast" role="alert"><span>{error}</span><button type="button" onClick={() => { setError(null); void refresh() }}>重试</button></div>}
    {selectedSession && <FocusSessionDialog segment={selectedSession} timerService={timerService} now={now} onClose={() => setSelectedSession(null)} onChanged={refresh} />}
    {completionTarget && <CompletionDialog target={completionTarget.target} taskName={completionTarget.name} now={now()} taskService={taskService} onClose={() => setCompletionTarget(null)} onCompleted={refresh} />}
  </main>
}

function readSelection(): { view: ScheduleView; date: LocalDate } {
  const params = new URLSearchParams(window.location.search)
  const rawView = params.get('view')
  const view: ScheduleView = rawView === 'week' || rawView === 'month' ? rawView : 'day'
  const rawDate = params.get('date')
  const parsed = rawDate === null ? null : parseISO(rawDate)
  const date = parsed !== null && isValid(parsed) && format(parsed, 'yyyy-MM-dd') === rawDate
    ? rawDate as LocalDate
    : toLocalDate(new Date())
  return { view, date }
}

function headingFor(view: ScheduleView, date: LocalDate): string {
  const parsed = parseISO(date)
  if (view === 'day') return format(parsed, 'M月d日 EEEE', { locale: zhCN })
  if (view === 'week') {
    const sunday = addDays(parsed, -parsed.getDay())
    const saturday = addDays(sunday, 6)
    return `${format(sunday, 'M月d日')} – ${format(saturday, 'M月d日')}`
  }
  return format(parsed, 'yyyy年 M月')
}

function previousLabel(view: ScheduleView): string { return view === 'day' ? '前一天' : view === 'week' ? '前一周' : '前一月' }
function nextLabel(view: ScheduleView): string { return view === 'day' ? '后一天' : view === 'week' ? '后一周' : '后一月' }
function messageFor(error: unknown): string { return error instanceof Error ? error.message : '操作失败，请重试' }

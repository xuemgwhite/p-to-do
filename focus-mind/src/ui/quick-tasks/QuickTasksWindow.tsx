import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { DaySchedule, ScheduleService, ScheduleTaskItem, WeeklyQuotaReminder } from '../../application/ScheduleService'
import type { TaskService } from '../../application/TaskService'
import type { TimerService } from '../../application/TimerService'
import { startOfLocalDay, toLocalDate } from '../../domain/dates'
import type { FocusSession, LocalDate } from '../../domain/models'
import type { RuntimeMode } from '../../ports/DesktopPort'
import './quick-tasks.css'

type QuickTask = ScheduleTaskItem | WeeklyQuotaReminder

interface QuickTasksWindowProps {
  scheduleService: ScheduleService
  taskService?: TaskService
  timerService?: TimerService
  runtimeMode: RuntimeMode
  now?: () => Date
  onStartTask?: (taskId: string) => void | Promise<void>
  onExpandedChange?: (expanded: boolean) => void | Promise<void>
}

interface ThemeGroup {
  id: string
  name: string
  color: string
  tasks: QuickTask[]
}

const systemNow = () => new Date()

export function QuickTasksWindow({
  scheduleService,
  taskService,
  timerService,
  runtimeMode,
  now = systemNow,
  onStartTask,
  onExpandedChange,
}: QuickTasksWindowProps) {
  const [expanded, setExpanded] = useState(false)
  const [schedule, setSchedule] = useState<DaySchedule | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [completedCollapsed, setCompletedCollapsed] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeSession, setActiveSession] = useState<FocusSession | null>(null)
  const [activeTaskName, setActiveTaskName] = useState<string | null>(null)
  const [todaySessions, setTodaySessions] = useState<FocusSession[]>([])
  const [displayNow, setDisplayNow] = useState(Date.now())
  const [pointerInside, setPointerInside] = useState(false)
  const [closing, setClosing] = useState(false)
  const dragOrigin = useRef<{ x: number; y: number } | null>(null)
  const ballWasDragged = useRef(false)
  const today = toLocalDate(now())

  const refresh = useCallback(async () => {
    try {
      const dayStart = startOfLocalDay(today)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)
      const [nextSchedule, active, sessions] = await Promise.all([
        scheduleService.getDay(today, now()),
        timerService?.getActiveSession() ?? Promise.resolve(null),
        timerService?.listSessions(dayStart.toISOString(), dayEnd.toISOString()) ?? Promise.resolve([]),
      ])
      setSchedule(nextSchedule)
      setActiveSession(active)
      setTodaySessions(sessions)
      setActiveTaskName(active === null ? null : await timerService?.getTaskName(active.taskId) ?? null)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取今日任务失败')
    }
  }, [now, scheduleService, timerService, today])

  useEffect(() => {
    document.documentElement.classList.add('quick-tasks-document')
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 30_000)
    return () => {
      document.documentElement.classList.remove('quick-tasks-document')
      window.clearInterval(interval)
    }
  }, [refresh])
  useEffect(() => {
    if (activeSession === null) return
    setDisplayNow(Date.now())
    const interval = window.setInterval(() => setDisplayNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [activeSession])
  useEffect(() => {
    if (runtimeMode !== 'tauri' || !('__TAURI_INTERNALS__' in window)) return
    let disposed = false
    let unlisten: (() => void)[] = []
    void import('@tauri-apps/api/event').then(async ({ listen }) => Promise.all([
      listen('main-timer-changed', () => { void refresh() }),
      listen('force-collapse-quick-tasks', () => { setPointerInside(false); setExpanded(false); void refresh() }),
    ])).then((stops) => {
      if (disposed) stops.forEach((stop) => stop())
      else unlisten = stops
    })
    return () => {
      disposed = true
      unlisten.forEach((stop) => stop())
    }
  }, [refresh, runtimeMode])

  const pending = useMemo(
    () => schedule === null ? [] : uniqueQuickTasks([...schedule.pending, ...schedule.weeklyQuotaReminders]),
    [schedule],
  )
  const groups = useMemo(() => groupByTheme(pending), [pending])

  async function changeExpanded(next: boolean) {
    if (closing) return
    if (!next && expanded) {
      setClosing(true)
      await wait(150)
    }
    try {
      if (onExpandedChange) await onExpandedChange(next)
      else if (runtimeMode === 'tauri') {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('set_quick_tasks_expanded', { expanded: next })
      }
      setPointerInside(true)
      setExpanded(next)
      if (next) void refresh()
    } finally {
      setClosing(false)
    }
  }

  async function toggleTimer(item: QuickTask) {
    try {
      setError(null)
      if (onStartTask) await onStartTask(item.task.id)
      else if (timerService) {
        if (activeSession?.taskId === item.task.id) await timerService.stop(now())
        else await timerService.start({ taskId: item.task.id, occurrenceId: occurrenceIdFor(item) }, now())
      }
      await refresh()
      await notifyTimerChanged(runtimeMode)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '计时操作失败')
    }
  }

  async function stopTimer() {
    if (!timerService) return
    try {
      setError(null)
      await timerService.stop(now())
      await refresh()
      await notifyTimerChanged(runtimeMode)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '停止计时失败')
    }
  }

  async function completeTask(item: QuickTask) {
    if (!taskService) return
    try {
      setError(null)
      if (activeSession?.taskId === item.task.id && timerService) await timerService.stop(now())
      await taskService.completeTask({
        taskId: item.task.id,
        occurrenceId: occurrenceIdFor(item),
      }, now(), undefined, today)
      await refresh()
      await notifyTimerChanged(runtimeMode)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '完成任务失败')
    }
  }

  function toggleGroup(groupId: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  function beginBallPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    dragOrigin.current = { x: event.clientX, y: event.clientY }
    ballWasDragged.current = false
  }

  async function moveBallPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    const origin = dragOrigin.current
    if (origin === null || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 4) return
    dragOrigin.current = null
    ballWasDragged.current = true
    if (runtimeMode === 'tauri') {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().startDragging()
    }
  }

  function endBallPointer() {
    dragOrigin.current = null
    if (ballWasDragged.current) window.setTimeout(() => { ballWasDragged.current = false }, 0)
  }

  function openFromBall() {
    if (ballWasDragged.current) return
    void changeExpanded(true)
  }

  if (!expanded) {
    return <main className="quick-ball-stage" aria-label="今日任务悬浮球">
      <button className="quick-ball" type="button" onClick={openFromBall} onPointerDown={beginBallPointer} onPointerMove={(event) => { void moveBallPointer(event) }} onPointerUp={endBallPointer} onPointerCancel={endBallPointer} aria-label={`打开今日任务，还有 ${pending.length} 项未完成`}>
        <b>{pending.length}</b>
      </button>
      {activeSession && <span className="quick-ball-active">专注中</span>}
    </main>
  }

  return <main className={`quick-panel${pointerInside ? '' : ' is-idle'}${closing ? ' is-closing' : ''}`} onPointerEnter={() => setPointerInside(true)} onPointerLeave={() => setPointerInside(false)}>
    <header className="quick-panel-header" data-tauri-drag-region>
      <span aria-hidden="true" />
      <h1 data-tauri-drag-region>{formatDate(now())} · {formatWeekday(now())}</h1>
      <button type="button" onClick={() => { void changeExpanded(false) }} aria-label="收起今日任务"><EyeIcon /></button>
    </header>

    {activeSession && <section className="quick-active-timer" aria-label="当前计时">
      <div><small>专注中</small><strong>{activeTaskName ?? '专注任务'}</strong></div>
      <time>{formatElapsed(Math.max(0, displayNow - new Date(activeSession.startedAt).getTime()))}</time>
      <button type="button" onClick={() => { void stopTimer() }} aria-label="停止计时"><StopIcon /></button>
    </section>}

    <section className="quick-task-scroll" aria-label="今日任务">
      {groups.map((group) => {
        const collapsed = collapsedGroups.has(group.id)
        return <section className="quick-theme-group" key={group.id}>
          <button className="quick-theme-heading" type="button" onClick={() => toggleGroup(group.id)} aria-expanded={!collapsed}>
            <i style={{ backgroundColor: group.color }} />
            <strong>{group.name}</strong>
            <span>{group.tasks.length}</span>
            <ChevronIcon collapsed={collapsed} />
          </button>
          {!collapsed && <div className="quick-theme-tasks">
            {group.tasks.map((item) => <article className="quick-task" key={item.id}>
              <button className="quick-task-check" type="button" disabled={!taskService} onClick={() => { void completeTask(item) }} aria-label={`完成 ${item.task.name}`} />
              <span className="quick-task-main"><span className="quick-task-name">{item.task.name}</span><small>{formatFocusDuration(focusDurationForTask(todaySessions, item.task.id, displayNow, today))}</small></span>
              <button className={`quick-start${activeSession?.taskId === item.task.id ? ' is-active' : ''}`} type="button" onClick={() => { void toggleTimer(item) }} aria-label={`${activeSession?.taskId === item.task.id ? '停止' : '开始'} ${item.task.name}`}>
                {activeSession?.taskId === item.task.id ? <StopIcon /> : <PlayIcon />}
              </button>
            </article>)}
          </div>}
        </section>
      })}

      {groups.length === 0 && schedule !== null && <div className="quick-empty"><CheckListIcon /><p>今天的任务都完成了</p></div>}
      {schedule === null && !error && <p className="quick-loading">正在读取今日任务…</p>}
      {error && <p className="quick-error" role="alert">{error}</p>}

      {(schedule?.completed.length ?? 0) > 0 && <section className="quick-theme-group quick-completed-group">
        <button className="quick-theme-heading" type="button" onClick={() => setCompletedCollapsed((current) => !current)} aria-expanded={!completedCollapsed}>
          <i />
          <strong>已完成</strong>
          <span>{schedule?.completed.length}</span>
          <ChevronIcon collapsed={completedCollapsed} />
        </button>
        {!completedCollapsed && <div className="quick-theme-tasks">
          {schedule?.completed.map((item) => <article className="quick-task is-completed" key={item.id}>
            <span className="quick-task-check" aria-hidden="true"><CheckIcon /></span>
            <span className="quick-task-name">{item.task.name}</span>
          </article>)}
        </div>}
      </section>}
    </section>
  </main>
}

function groupByTheme(tasks: QuickTask[]): ThemeGroup[] {
  const groups = new Map<string, ThemeGroup>()
  for (const item of tasks) {
    const existing = groups.get(item.theme.id)
    if (existing) existing.tasks.push(item)
    else groups.set(item.theme.id, {
      id: item.theme.id,
      name: item.theme.name,
      color: item.theme.color,
      tasks: [item],
    })
  }
  return [...groups.values()]
}

function uniqueQuickTasks(tasks: QuickTask[]): QuickTask[] {
  const seen = new Set<string>()
  return tasks.filter((item) => {
    if (seen.has(item.task.id)) return false
    seen.add(item.task.id)
    return true
  })
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

function formatWeekday(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(date)
}

function occurrenceIdFor(item: QuickTask): string | null | undefined {
  return 'occurrence' in item ? item.occurrence?.id ?? null : undefined
}

async function notifyTimerChanged(runtimeMode: RuntimeMode) {
  if (runtimeMode !== 'tauri') return
  const { emitTo } = await import('@tauri-apps/api/event')
  await emitTo('main', 'quick-timer-changed')
}

function formatElapsed(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1_000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function wait(duration: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, duration))
}

function focusDurationForTask(sessions: FocusSession[], taskId: string, currentTime: number, today: LocalDate): number {
  const dayStart = startOfLocalDay(today).getTime()
  const dayEnd = dayStart + 24 * 60 * 60 * 1_000
  return sessions.filter((session) => session.taskId === taskId).reduce((total, session) => {
    const start = Math.max(dayStart, new Date(session.startedAt).getTime())
    const end = Math.min(dayEnd, session.endedAt === null ? currentTime : new Date(session.endedAt).getTime())
    return total + Math.max(0, end - start)
  }, 0)
}

function formatFocusDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000)
  if (minutes < 60) return `${minutes}分钟`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0 ? `${hours}小时` : `${hours}小时${remainder}分钟`
}

function CheckListIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 7 2 2 3.5-4M11 7h9M4 14l2 2 3.5-4M11 14h9M11 20h9" /></svg> }
function EyeIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.4-5 9-5 9 5 9 5-3.4 5-9 5-9-5-9-5Z" /><circle cx="12" cy="12" r="2.4" /></svg> }
function ChevronIcon({ collapsed }: { collapsed: boolean }) { return <svg className={collapsed ? 'is-collapsed' : ''} viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4" /></svg> }
function PlayIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7v10l8-5-8-5Z" /></svg> }
function StopIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /></svg> }
function CheckIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-9" /></svg> }

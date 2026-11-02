import type {
  DaySchedule,
  ScheduleTaskItem,
  WeeklyQuotaReminder,
} from '../../application/ScheduleService'
import type { FocusSession } from '../../domain/models'
import { recurrenceLabel } from '../../domain/taskLabels'

interface DayViewProps {
  schedule: DaySchedule
  today: string
  activeSession: FocusSession | null
  onStart: (item: ScheduleTaskItem | WeeklyQuotaReminder) => Promise<void>
  onComplete: (item: ScheduleTaskItem) => Promise<void>
  onCompleteReminder: (item: WeeklyQuotaReminder) => Promise<void>
  onRestore: (item: ScheduleTaskItem) => Promise<void>
  quickTasksEnabled?: boolean
  onToggleQuickTasks?: () => Promise<void>
}

export function DayView({ schedule, today, activeSession, onStart, onComplete, onCompleteReminder, onRestore, quickTasksEnabled = true, onToggleQuickTasks }: DayViewProps) {
  const canStart = schedule.date === today
  return <div className="schedule-day-view">
    <section className="schedule-day-section" role="region" aria-label="待办">
      <div className="schedule-day-section-heading">
        <h2>待办</h2>
        {onToggleQuickTasks && <button className={`show-quick-tasks-button${quickTasksEnabled ? ' is-enabled' : ''}`} type="button" aria-pressed={quickTasksEnabled} aria-label={`${quickTasksEnabled ? '关闭' : '开启'}悬浮球`} onClick={() => { void onToggleQuickTasks() }}><FloatingIcon /><span>悬浮球</span><i aria-hidden="true"><b /></i></button>}
      </div>
      <div className="schedule-day-list">
        {schedule.pending.map((item) => <DayTaskCard
          key={item.id}
          item={item}
          active={matchesSession(item, activeSession)}
          canStart={canStart}
          onStart={onStart}
          onComplete={onComplete}
          onRestore={onRestore}
        />)}
        {schedule.weeklyQuotaReminders.map((reminder) => <WeeklyReminderCard
          key={reminder.id}
          reminder={reminder}
          active={activeSession?.taskId === reminder.task.id}
          canStart={canStart}
          onStart={onStart}
          onComplete={onCompleteReminder}
        />)}
        {schedule.pending.length === 0 && schedule.weeklyQuotaReminders.length === 0 && <p className="schedule-empty">这一天没有待办。</p>}
      </div>
    </section>
    <section className="schedule-day-section schedule-completed" role="region" aria-label="已完成">
      <h2>已完成</h2>
      <div className="schedule-day-list">
        {schedule.completed.map((item) => <DayTaskCard
          key={item.id}
          item={item}
          active={false}
          canStart={false}
          onStart={onStart}
          onComplete={onComplete}
          onRestore={onRestore}
        />)}
        {schedule.completed.length === 0 && <p className="schedule-empty">还没有完成项。</p>}
      </div>
    </section>
  </div>
}

function DayTaskCard({ item, active, canStart, onStart, onComplete, onRestore }: {
  item: ScheduleTaskItem
  active: boolean
  canStart: boolean
  onStart: DayViewProps['onStart']
  onComplete: DayViewProps['onComplete']
  onRestore: DayViewProps['onRestore']
}) {
  const completed = item.state === 'completed'
  const recurrence = recurrenceLabel(item.task)
  return <article
    className={`schedule-task-card${completed ? ' completed' : ''}${active ? ' active' : ''}`}
    data-testid={`schedule-task-${item.id}`}
  >
    <div className="schedule-task-main">
      <label className="completion-control">
        <input
          type="checkbox"
          checked={completed}
          aria-label={`${completed ? '恢复' : '完成'} ${item.task.name}`}
          onChange={() => { void (completed ? onRestore(item) : onComplete(item)) }}
        />
        <span aria-hidden="true">✓</span>
      </label>
      <div className="schedule-task-copy">
        <h3>{item.task.name}</h3>
        {item.task.description && <p>{item.task.description}</p>}
      </div>
      {!completed && <button
        className={`schedule-start-button${active ? ' active' : ''}`}
        type="button"
        aria-label={`${active ? '结束' : '开始'} ${item.task.name}`}
        disabled={!canStart}
        title={canStart ? undefined : '只能在系统当天开始计时'}
        onClick={() => { void onStart(item) }}
      >{active ? '■' : '▶'}</button>}
    </div>
    {!completed && <div className="schedule-task-tags">
      {active && <span className="tag active-tag">▶ 专注中</span>}
      <span className="tag deadline-tag">{formatDate(item.task.endDate)} 结束</span>
      {recurrence && <span className="tag repeat-tag">↻ {recurrence}</span>}
    </div>}
  </article>
}

function WeeklyReminderCard({ reminder, active, canStart, onStart, onComplete }: {
  reminder: WeeklyQuotaReminder
  active: boolean
  canStart: boolean
  onStart: DayViewProps['onStart']
  onComplete: DayViewProps['onCompleteReminder']
}) {
  return <article className="schedule-task-card schedule-weekly-reminder" data-testid={`weekly-reminder-${reminder.task.id}`}>
    <div className="schedule-task-main">
      <label className="completion-control">
        <input type="checkbox" aria-label={`完成 ${reminder.task.name}`} onChange={() => { void onComplete(reminder) }} />
        <span aria-hidden="true">✓</span>
      </label>
      <div className="schedule-task-copy"><h3>{reminder.task.name}</h3><p>{reminder.completed}/{reminder.quota} 已完成 · 还需 {reminder.remaining} 次</p></div>
      <button className={`schedule-start-button${active ? ' active' : ''}`} type="button" aria-label={`${active ? '结束' : '开始'} ${reminder.task.name}`} disabled={!canStart} title={canStart ? undefined : '只能在系统当天开始计时'} onClick={() => { void onStart(reminder) }}>{active ? '■' : '▶'}</button>
    </div>
    <div className="schedule-task-tags"><span className="tag repeat-tag">↻ 每周 {reminder.quota} 次</span></div>
  </article>
}

function matchesSession(item: ScheduleTaskItem, session: FocusSession | null): boolean {
  if (session === null || session.taskId !== item.task.id) return false
  return item.occurrence === null || session.occurrenceId === item.occurrence.id
}

function formatDate(date: string): string {
  const [, month, day] = date.split('-')
  return `${Number(month)}月${Number(day)}日`
}

function FloatingIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></svg> }

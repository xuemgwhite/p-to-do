import {
  addDays,
  endOfISOWeek,
  endOfWeek,
  endOfMonth,
  parseISO,
  startOfISOWeek,
  startOfWeek,
  startOfMonth,
} from 'date-fns'
import {
  splitIntervalByLocalDay,
  startOfLocalDay,
  toLocalDate,
} from '../domain/dates'
import type {
  FocusSession,
  Goal,
  LocalDate,
  Task,
  TaskOccurrence,
  Theme,
} from '../domain/models'
import {
  occurrencesForRange,
  weeklyQuotaProgress,
} from '../domain/recurrence'
import type { FocusMindRepository } from '../ports/FocusMindRepository'

export interface ScheduleTaskItem {
  id: string
  date: LocalDate
  task: Task
  occurrence: TaskOccurrence | null
  state: 'pending' | 'completed'
  goal: Goal
  theme: Theme
  hasFocusSessions: boolean
}

export interface WeeklyQuotaReminder {
  id: string
  task: Task
  goal: Goal
  theme: Theme
  completed: number
  quota: number
  remaining: number
  overage: number
}

export interface DaySchedule {
  date: LocalDate
  pending: ScheduleTaskItem[]
  completed: ScheduleTaskItem[]
  weeklyQuotaReminders: WeeklyQuotaReminder[]
}

export interface FocusSessionSegment {
  kind: 'session'
  id: string
  sessionId: string
  taskId: string
  occurrenceId: string | null
  task: Task
  goal: Goal
  theme: Theme
  date: LocalDate
  startedAt: string
  endedAt: string
  sourceStartedAt: string
  sourceEndedAt: string | null
}

export interface WeekScheduleDay {
  date: LocalDate
  allDay: ScheduleTaskItem[]
  completed: ScheduleTaskItem[]
}

export interface WeekSchedule {
  from: LocalDate
  to: LocalDate
  days: WeekScheduleDay[]
  unboundWeeklyQuota: WeeklyQuotaReminder[]
  timedSegments: FocusSessionSegment[]
}

export type MonthScheduleItem =
  | FocusSessionSegment
  | ({ kind: 'task' } & ScheduleTaskItem)

export interface MonthScheduleDay {
  date: LocalDate
  items: MonthScheduleItem[]
}

export interface MonthSchedule {
  from: LocalDate
  to: LocalDate
  days: MonthScheduleDay[]
}

interface Catalog {
  tasks: Task[]
  goalsById: Map<string, Goal>
  themesById: Map<string, Theme>
}

export class ScheduleService {
  private readonly repository: FocusMindRepository

  constructor(repository: FocusMindRepository) {
    this.repository = repository
  }

  async getDay(date: LocalDate, _now: Date = new Date()): Promise<DaySchedule> {
    const catalog = await this.loadCatalog()
    const rangeOccurrences = await this.repository.listOccurrences(date, date)
    const dayStart = startOfLocalDay(date)
    const dayEnd = addDays(dayStart, 1)
    const sessions = await this.repository.listFocusSessions(
      dayStart.toISOString(),
      dayEnd.toISOString(),
    )
    const pending: ScheduleTaskItem[] = []
    const completed: ScheduleTaskItem[] = []
    const weeklyQuotaReminders: WeeklyQuotaReminder[] = []

    for (const task of catalog.tasks) {
      const hierarchy = hierarchyFor(task, catalog)
      if (task.recurrenceType === 'none') {
        const state = ordinaryStateOnDate(task, date)
        if (state === null) continue
        const item = scheduleTaskItem(task, null, date, state, hierarchy, sessions)
        ;(state === 'completed' ? completed : pending).push(item)
        continue
      }

      const taskOccurrences = task.recurrenceType === 'weekly_quota'
        ? await this.repository.listOccurrencesForTask(task.id)
        : rangeOccurrences.filter((item) => item.taskId === task.id)

      if (task.recurrenceType === 'daily') {
        const occurrences = occurrencesForRange(task, taskOccurrences, date, date, date)
        for (const occurrence of occurrences.filter((item) => item.plannedDate === date)) {
          const item = scheduleTaskItem(
            task,
            occurrence,
            date,
            occurrence.state,
            hierarchy,
            sessions,
          )
          ;(occurrence.state === 'completed' ? completed : pending).push(item)
        }
        continue
      }

      const weekStart = toLocalDate(startOfISOWeek(parseISO(date)))
      const weekEnd = toLocalDate(endOfISOWeek(parseISO(date)))
      const occurrences = occurrencesForRange(
        task,
        taskOccurrences,
        weekStart,
        weekEnd,
        date,
      )
      for (const occurrence of occurrences.filter((item) => item.boundDate === date)) {
        const item = scheduleTaskItem(
          task,
          occurrence,
          date,
          occurrence.state,
          hierarchy,
          sessions,
        )
        ;(occurrence.state === 'completed' ? completed : pending).push(item)
      }

      if (taskIsActiveOnDate(task, date)) {
        const progress = weeklyQuotaProgress(occurrences, task.weeklyQuota ?? 0)
        const hasUnboundPending = occurrences.some(
          (item) => item.state === 'pending' && item.boundDate === null,
        )
        if (progress.remaining > 0 && hasUnboundPending) {
          weeklyQuotaReminders.push({
            id: `weekly-reminder:${task.id}:${weekStart}`,
            task,
            ...hierarchy,
            ...progress,
          })
        }
      }
    }

    return {
      date,
      pending: sortTaskItems(pending),
      completed: sortTaskItems(completed),
      weeklyQuotaReminders: sortReminders(weeklyQuotaReminders),
    }
  }

  async getWeek(date: LocalDate, now: Date = new Date()): Promise<WeekSchedule> {
    const from = toLocalDate(startOfWeek(parseISO(date), { weekStartsOn: 0 }))
    const to = toLocalDate(endOfWeek(parseISO(date), { weekStartsOn: 0 }))
    const dates = datesInRange(from, to)
    const daySchedules = dedupeOrdinaryTasks(
      await Promise.all(dates.map((item) => this.getDay(item, now))),
      from,
      to,
      toLocalDate(now),
    )
    const catalog = await this.loadCatalog()
    const timedSegments = await this.loadSegments(from, addDays(parseISO(to), 1), catalog, now)
    const reminders = new Map<string, WeeklyQuotaReminder>()
    for (const day of daySchedules) {
      for (const reminder of day.weeklyQuotaReminders) reminders.set(reminder.task.id, reminder)
    }

    return {
      from,
      to,
      days: daySchedules.map((day) => ({
        date: day.date,
        allDay: day.pending,
        completed: day.completed,
      })),
      unboundWeeklyQuota: sortReminders([...reminders.values()]),
      timedSegments,
    }
  }

  async getMonth(date: LocalDate, now: Date = new Date()): Promise<MonthSchedule> {
    const from = toLocalDate(startOfMonth(parseISO(date)))
    const to = toLocalDate(endOfMonth(parseISO(date)))
    const dates = datesInRange(from, to)
    const daySchedules = dedupeOrdinaryTasks(
      await Promise.all(dates.map((item) => this.getDay(item, now))),
      from,
      to,
      toLocalDate(now),
    )
    const catalog = await this.loadCatalog()
    const segments = await this.loadSegments(from, addDays(parseISO(to), 1), catalog, now)

    return {
      from,
      to,
      days: daySchedules.map((day) => {
        const timed = segments.filter((segment) => segment.date === day.date)
        const scheduled = [...day.pending, ...day.completed]
          .filter((item) => item.state === 'pending' || !timed.some((segment) => (
            item.occurrence === null
              ? segment.taskId === item.task.id
              : segment.occurrenceId === item.occurrence.id
          )))
          .map<MonthScheduleItem>((item) => ({ kind: 'task', ...item }))
        return { date: day.date, items: [...timed, ...scheduled] }
      }),
    }
  }

  private async loadCatalog(): Promise<Catalog> {
    const themes = await this.repository.listThemes()
    const goals = (await Promise.all(
      themes.map((theme) => this.repository.listGoals(theme.id)),
    )).flat()
    const tasks = (await Promise.all(
      goals.map((goal) => this.repository.listTasks(goal.id)),
    )).flat()
    return {
      tasks,
      goalsById: new Map(goals.map((goal) => [goal.id, goal])),
      themesById: new Map(themes.map((theme) => [theme.id, theme])),
    }
  }

  private async loadSegments(
    from: LocalDate,
    exclusiveTo: Date,
    catalog: Catalog,
    now: Date,
  ): Promise<FocusSessionSegment[]> {
    const sessions = await this.repository.listFocusSessions(
      startOfLocalDay(from).toISOString(),
      exclusiveTo.toISOString(),
    )
    return sessions.flatMap((session) => sessionSegments(session, catalog, now))
      .filter((segment) => segment.date >= from && segment.date < toLocalDate(exclusiveTo))
      .sort((left, right) => (
        left.date.localeCompare(right.date)
        || left.startedAt.localeCompare(right.startedAt)
        || left.id.localeCompare(right.id)
      ))
  }
}

function hierarchyFor(task: Task, catalog: Catalog): { goal: Goal; theme: Theme } {
  const goal = catalog.goalsById.get(task.goalId)
  if (goal === undefined) throw new Error(`Goal not found for task: ${task.id}`)
  const theme = catalog.themesById.get(goal.themeId)
  if (theme === undefined) throw new Error(`Theme not found for goal: ${goal.id}`)
  return { goal, theme }
}

function scheduleTaskItem(
  task: Task,
  occurrence: TaskOccurrence | null,
  date: LocalDate,
  state: 'pending' | 'completed',
  hierarchy: { goal: Goal; theme: Theme },
  sessions: FocusSession[],
): ScheduleTaskItem {
  const hasFocusSessions = sessions.some((session) => occurrence === null
    ? session.taskId === task.id
    : session.occurrenceId === occurrence.id)
  return {
    id: occurrence?.id ?? `task:${task.id}:${date}`,
    date,
    task,
    occurrence,
    state,
    ...hierarchy,
    hasFocusSessions,
  }
}

function ordinaryStateOnDate(task: Task, date: LocalDate): 'pending' | 'completed' | null {
  if (date < task.startDate) return null
  if (task.completedAt === null) return 'pending'
  const completedDate = toLocalDate(new Date(task.completedAt))
  if (date < completedDate) return 'pending'
  return date === completedDate ? 'completed' : null
}

function dedupeOrdinaryTasks(days: DaySchedule[], from: LocalDate, to: LocalDate, today: LocalDate): DaySchedule[] {
  return days.map((day) => ({
    ...day,
    pending: day.pending.filter((item) => item.task.recurrenceType !== 'none' || preferredOrdinaryDate(item.task, from, to, today) === day.date),
    completed: day.completed.filter((item) => item.task.recurrenceType !== 'none' || preferredOrdinaryDate(item.task, from, to, today) === day.date),
  }))
}

function preferredOrdinaryDate(task: Task, from: LocalDate, to: LocalDate, today: LocalDate): LocalDate | null {
  if (task.completedAt !== null) {
    const completedDate = toLocalDate(new Date(task.completedAt))
    return completedDate >= from && completedDate <= to ? completedDate : null
  }
  if (today >= from && today <= to && today >= task.startDate) return today
  if (task.startDate >= from && task.startDate <= to) return task.startDate
  if (task.startDate < from && task.endDate >= from) return from
  return null
}

function taskIsActiveOnDate(task: Task, date: LocalDate): boolean {
  if (date < task.startDate || date > task.endDate) return false
  return task.completedAt === null || date <= toLocalDate(new Date(task.completedAt))
}

function sessionSegments(session: FocusSession, catalog: Catalog, now: Date): FocusSessionSegment[] {
  const task = catalog.tasks.find((item) => item.id === session.taskId)
  if (task === undefined) return []
  const hierarchy = hierarchyFor(task, catalog)
  const start = new Date(session.startedAt)
  const end = session.endedAt === null ? now : new Date(session.endedAt)
  if (end <= start) return []
  return splitIntervalByLocalDay(start, end).map((part, index) => ({
    kind: 'session',
    id: `${session.id}:${index}:${part.date}`,
    sessionId: session.id,
    taskId: session.taskId,
    occurrenceId: session.occurrenceId,
    task,
    ...hierarchy,
    date: part.date,
    startedAt: part.start.toISOString(),
    endedAt: part.end.toISOString(),
    sourceStartedAt: session.startedAt,
    sourceEndedAt: session.endedAt,
  }))
}

function datesInRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const dates: LocalDate[] = []
  for (let date = parseISO(from); toLocalDate(date) <= to; date = addDays(date, 1)) {
    dates.push(toLocalDate(date))
  }
  return dates
}

function sortTaskItems(items: ScheduleTaskItem[]): ScheduleTaskItem[] {
  return items.sort((left, right) => (
    left.theme.sortOrder - right.theme.sortOrder
    || left.goal.sortOrder - right.goal.sortOrder
    || left.task.sortOrder - right.task.sortOrder
    || left.id.localeCompare(right.id)
  ))
}

function sortReminders(items: WeeklyQuotaReminder[]): WeeklyQuotaReminder[] {
  return items.sort((left, right) => (
    left.theme.sortOrder - right.theme.sortOrder
    || left.goal.sortOrder - right.goal.sortOrder
    || left.task.sortOrder - right.task.sortOrder
    || left.id.localeCompare(right.id)
  ))
}

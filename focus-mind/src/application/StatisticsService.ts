import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  endOfMonth,
  endOfYear,
  format,
  getDay,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { startOfLocalDay, toLocalDate } from '../domain/dates'
import type { FocusSession, LocalDate, Task, Theme } from '../domain/models'
import type { FocusMindRepository } from '../ports/FocusMindRepository'

export type StatisticsPeriod = 'day' | 'week' | 'month' | 'year'
const HEATMAP_START_DATE: LocalDate = '2026-07-15'

export interface StatisticsHeatmapDay {
  date: LocalDate
  durationMs: number
  intensity: 0 | 1 | 2 | 3 | 4 | 5
}

export interface ThemeFocusStatistic {
  themeId: string
  name: string
  color: string
  durationMs: number
}

export interface FocusTrendPoint {
  key: string
  label: string
  durationMs: number
}

export interface StatisticsSnapshot {
  period: StatisticsPeriod
  comparisonLabel: string
  from: LocalDate
  to: LocalDate
  totalFocusMs: number
  previousFocusMs: number
  completedTasks: number
  previousCompletedTasks: number
  heatmap: StatisticsHeatmapDay[]
  themes: ThemeFocusStatistic[]
  trend: FocusTrendPoint[]
  averageFocusMs: number
}

interface Catalog {
  themes: Theme[]
  tasks: Task[]
  themeByTaskId: Map<string, Theme>
}

interface DateRange {
  start: Date
  end: Date
}

export class StatisticsService {
  private readonly repository: FocusMindRepository

  constructor(repository: FocusMindRepository) {
    this.repository = repository
  }

  async getSnapshot(
    period: StatisticsPeriod,
    anchor: Date = new Date(),
    now: Date = anchor,
  ): Promise<StatisticsSnapshot> {
    const current = rangeFor(period, anchor)
    const previous = previousRange(period, current)
    const heatmapRange = {
      start: startOfLocalDay(HEATMAP_START_DATE),
      end: addDays(startOfLocalDay(toLocalDate(now)), 1),
    }
    const catalog = await this.loadCatalog()
    const sessions = await this.repository.listFocusSessions(
      (previous.start < heatmapRange.start ? previous.start : heatmapRange.start).toISOString(),
      (current.end > heatmapRange.end ? current.end : heatmapRange.end).toISOString(),
    )
    const occurrenceFrom = toLocalDate(previous.start)
    const occurrenceTo = toLocalDate(addDays(current.end, -1))
    const occurrences = await this.repository.listOccurrences(occurrenceFrom, occurrenceTo)
    const totalFocusMs = totalDuration(sessions, current, now)
    const trend = trendFor(period, current, sessions, now)

    return {
      period,
      comparisonLabel: period === 'day' ? '较前一日' : period === 'week' ? '较上周' : period === 'month' ? '较上月' : '较上年',
      from: toLocalDate(current.start),
      to: toLocalDate(addDays(current.end, -1)),
      totalFocusMs,
      previousFocusMs: totalDuration(sessions, previous, now),
      completedTasks: completionCount(catalog.tasks, occurrences, current),
      previousCompletedTasks: completionCount(catalog.tasks, occurrences, previous),
      heatmap: heatmapFor(heatmapRange, sessions, now),
      themes: themeStatistics(catalog, sessions, current, now),
      trend,
      averageFocusMs: trend.length === 0 ? 0 : totalFocusMs / trend.length,
    }
  }

  private async loadCatalog(): Promise<Catalog> {
    const themes = await this.repository.listThemes()
    const goals = (await Promise.all(themes.map((theme) => this.repository.listGoals(theme.id)))).flat()
    const tasks = (await Promise.all(goals.map((goal) => this.repository.listTasks(goal.id)))).flat()
    const goalById = new Map(goals.map((goal) => [goal.id, goal]))
    const themeById = new Map(themes.map((theme) => [theme.id, theme]))
    const themeByTaskId = new Map<string, Theme>()
    for (const task of tasks) {
      const goal = goalById.get(task.goalId)
      const theme = goal === undefined ? undefined : themeById.get(goal.themeId)
      if (theme !== undefined) themeByTaskId.set(task.id, theme)
    }
    return { themes, tasks, themeByTaskId }
  }
}

function rangeFor(period: StatisticsPeriod, now: Date): DateRange {
  if (period === 'day') {
    const start = startOfLocalDay(toLocalDate(now))
    return { start, end: addDays(start, 1) }
  }
  if (period === 'week') {
    const start = startOfWeek(now, { weekStartsOn: 1 })
    return { start, end: addWeeks(start, 1) }
  }
  if (period === 'month') {
    const start = startOfMonth(now)
    return { start, end: addMonths(start, 1) }
  }
  const start = startOfYear(now)
  return { start, end: addYears(start, 1) }
}

function previousRange(period: StatisticsPeriod, current: DateRange): DateRange {
  if (period === 'day') {
    const start = addDays(current.start, -1)
    return { start, end: current.start }
  }
  if (period === 'week') {
    const start = addWeeks(current.start, -1)
    return { start, end: current.start }
  }
  if (period === 'month') {
    const start = addMonths(current.start, -1)
    return { start, end: current.start }
  }
  const start = addYears(current.start, -1)
  return { start, end: current.start }
}

function totalDuration(
  sessions: readonly FocusSession[],
  range: DateRange,
  now: Date,
): number {
  return sessions.reduce((total, session) => total + overlapDuration(session, range, now), 0)
}

function overlapDuration(session: FocusSession, range: DateRange, now: Date): number {
  const start = Math.max(new Date(session.startedAt).getTime(), range.start.getTime())
  const rawEnd = session.endedAt === null ? now : new Date(session.endedAt)
  const end = Math.min(rawEnd.getTime(), range.end.getTime(), now.getTime())
  return Math.max(0, end - start)
}

function completionCount(
  tasks: readonly Task[],
  occurrences: readonly { state: string; completedAt: string | null }[],
  range: DateRange,
): number {
  const ordinary = tasks.filter((task) =>
    task.recurrenceType === 'none'
    && task.completedAt !== null
    && dateInRange(new Date(task.completedAt), range),
  ).length
  const recurring = occurrences.filter((occurrence) =>
    occurrence.state === 'completed'
    && occurrence.completedAt !== null
    && dateInRange(new Date(occurrence.completedAt), range),
  ).length
  return ordinary + recurring
}

function dateInRange(date: Date, range: DateRange): boolean {
  return date >= range.start && date < range.end
}

function heatmapFor(
  range: DateRange,
  sessions: readonly FocusSession[],
  now: Date,
): StatisticsHeatmapDay[] {
  const days: Array<Omit<StatisticsHeatmapDay, 'intensity'>> = []
  for (let cursor = range.start; cursor < range.end; cursor = addDays(cursor, 1)) {
    const date = toLocalDate(cursor)
    const dayRange = { start: startOfLocalDay(date), end: addDays(startOfLocalDay(date), 1) }
    days.push({ date, durationMs: totalDuration(sessions, dayRange, now) })
  }
  const maximum = Math.max(0, ...days.map((day) => day.durationMs))
  return days.map((day) => ({
    ...day,
    intensity: intensityFor(day.durationMs, maximum),
  }))
}

function intensityFor(durationMs: number, maximum: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (durationMs <= 0 || maximum <= 0) return 0
  return Math.min(5, Math.max(1, Math.ceil(durationMs / maximum * 5))) as 1 | 2 | 3 | 4 | 5
}

function themeStatistics(
  catalog: Catalog,
  sessions: readonly FocusSession[],
  range: DateRange,
  now: Date,
): ThemeFocusStatistic[] {
  const totals = new Map<string, number>()
  for (const session of sessions) {
    const theme = catalog.themeByTaskId.get(session.taskId)
    if (theme === undefined) continue
    totals.set(theme.id, (totals.get(theme.id) ?? 0) + overlapDuration(session, range, now))
  }
  return catalog.themes
    .map((theme) => ({
      themeId: theme.id,
      name: theme.name,
      color: theme.color,
      durationMs: totals.get(theme.id) ?? 0,
    }))
    .filter((item) => item.durationMs > 0)
    .sort((left, right) => right.durationMs - left.durationMs)
}

function trendFor(
  period: StatisticsPeriod,
  range: DateRange,
  sessions: readonly FocusSession[],
  now: Date,
): FocusTrendPoint[] {
  if (period === 'day') {
    return Array.from({ length: 24 }, (_, index) => {
      const start = new Date(range.start)
      start.setHours(index, 0, 0, 0)
      return {
        key: `${toLocalDate(start)}-${String(index).padStart(2, '0')}`,
        label: `${index}时`,
        durationMs: totalDuration(sessions, { start, end: new Date(start.getTime() + 3_600_000) }, now),
      }
    })
  }
  if (period === 'week') {
    return Array.from({ length: 7 }, (_, index) => {
      const start = addDays(range.start, index)
      return {
        key: toLocalDate(start),
        label: format(start, 'EEE', { locale: zhCN }),
        durationMs: totalDuration(sessions, { start, end: addDays(start, 1) }, now),
      }
    })
  }
  if (period === 'month') {
    const points: FocusTrendPoint[] = []
    for (let start = range.start, index = 1; start < range.end; start = addWeeks(start, 1), index += 1) {
      const end = addWeeks(start, 1) < range.end ? addWeeks(start, 1) : range.end
      points.push({
        key: toLocalDate(start),
        label: `第 ${index} 周`,
        durationMs: totalDuration(sessions, { start, end }, now),
      })
    }
    return points
  }
  return Array.from({ length: 12 }, (_, index) => {
    const start = addMonths(range.start, index)
    return {
      key: format(start, 'yyyy-MM'),
      label: `${index + 1}月`,
      durationMs: totalDuration(sessions, { start, end: addMonths(start, 1) }, now),
    }
  })
}

export function heatmapLeadingSlots(date: LocalDate): number {
  return getDay(parseISO(date))
}

export function statisticsRangeLabel(snapshot: StatisticsSnapshot): string {
  if (snapshot.period === 'day') {
    return format(parseISO(snapshot.from), 'yyyy年 M月d日 EEEE', { locale: zhCN })
  }
  if (snapshot.period === 'week') {
    return `${format(parseISO(snapshot.from), 'M月d日')} – ${format(parseISO(snapshot.to), 'M月d日')}`
  }
  if (snapshot.period === 'month') return format(endOfMonth(parseISO(snapshot.from)), 'yyyy年 M月')
  return format(endOfYear(parseISO(snapshot.from)), 'yyyy年')
}

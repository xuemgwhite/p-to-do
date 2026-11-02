import { addDays, format, getDay, parseISO, startOfISOWeek } from 'date-fns'
import { toLocalDate } from './dates'
import type { LocalDate, Task, TaskOccurrence, Weekday } from './models'

export interface WeeklyQuotaProgress {
  completed: number
  quota: number
  remaining: number
  overage: number
}

/**
 * `effectiveFrom` is the first date whose output may be changed by the task's
 * current configuration. It is required even when it equals `from`, so callers
 * explicitly distinguish historical rows from the current/future rule range.
 * Existing rows before it are returned as history.
 */
export function occurrencesForRange(
  task: Task,
  existing: TaskOccurrence[],
  from: LocalDate,
  to: LocalDate,
  effectiveFrom: LocalDate,
): TaskOccurrence[] {
  const taskOccurrences = existing.filter((occurrence) => occurrence.taskId === task.id)
  const historicalOccurrences = historicalOccurrencesForRange(
    task,
    taskOccurrences,
    from,
    to,
    effectiveFrom,
  )
  const range = applicableRange(task, maxDate(from, effectiveFrom), to)
  if (range === null) {
    return historicalOccurrences
  }

  if (task.recurrenceType === 'daily') {
    return uniqueByKey([
      ...historicalOccurrences,
      ...dailyOccurrences(task, taskOccurrences, range.from, range.to),
    ])
  }

  if (task.recurrenceType === 'weekly_quota') {
    return uniqueByKey([
      ...historicalOccurrences,
      ...weeklyOccurrences(task, taskOccurrences, range.from, range.to),
    ])
  }

  return historicalOccurrences
}

export function weeklyQuotaProgress(
  occurrences: TaskOccurrence[],
  quota: number,
): WeeklyQuotaProgress {
  const normalizedQuota = normalizeQuota(quota)
  const completed = occurrences.filter((occurrence) => occurrence.state === 'completed').length

  return {
    completed,
    quota: normalizedQuota,
    remaining: Math.max(normalizedQuota - completed, 0),
    overage: Math.max(completed - normalizedQuota, 0),
  }
}

export function bindWeeklyOccurrence(
  occurrences: TaskOccurrence[],
  date: LocalDate,
): TaskOccurrence {
  const weekKey = format(startOfISOWeek(parseISO(date)), "RRRR-'W'II")
  const occurrence = occurrences.find(
    (item) => item.periodKey.startsWith(`weekly:${item.taskId}:${weekKey}:`)
      && item.state === 'pending'
      && item.boundDate === null,
  )

  if (occurrence === undefined) {
    throw new Error('没有可绑定的每周实例')
  }

  return {
    ...occurrence,
    boundDate: date,
  }
}

function dailyOccurrences(
  task: Task,
  existing: TaskOccurrence[],
  from: LocalDate,
  to: LocalDate,
): TaskOccurrence[] {
  const byKey = new Map(existing.map((occurrence) => [occurrence.periodKey, occurrence]))
  const occurrences: TaskOccurrence[] = []

  for (let date = from; date <= to; date = nextDate(date)) {
    const key = dailyKey(task.id, date)
    const existingOccurrence = byKey.get(key)
    if (task.excludedWeekdays?.includes(getDay(parseISO(date)) as Weekday)) {
      if (existingOccurrence?.state === 'completed') occurrences.push(existingOccurrence)
      continue
    }
    occurrences.push(existingOccurrence ?? createDailyOccurrence(task.id, key, date))
  }

  return occurrences
}

function weeklyOccurrences(
  task: Task,
  existing: TaskOccurrence[],
  from: LocalDate,
  to: LocalDate,
): TaskOccurrence[] {
  const quota = normalizeQuota(task.weeklyQuota)
  const occurrences: TaskOccurrence[] = []

  for (
    let weekStart = startOfISOWeek(parseISO(from));
    toLocalDate(weekStart) <= to;
    weekStart = addDays(weekStart, 7)
  ) {
    const weekKey = format(weekStart, "RRRR-'W'II")
    const prefix = `weekly:${task.id}:${weekKey}:`
    const periodOccurrences = uniqueByKey(
      existing.filter((occurrence) => occurrence.periodKey.startsWith(prefix)),
    )

    occurrences.push(...reconcileWeeklyQuota(task.id, weekKey, periodOccurrences, quota))
  }

  return occurrences
}

function reconcileWeeklyQuota(
  taskId: string,
  weekKey: string,
  existing: TaskOccurrence[],
  quota: number,
): TaskOccurrence[] {
  const protectedOccurrences = existing.filter((occurrence) => !isRemovableSurplus(occurrence))
  const removableOccurrences = existing
    .filter(isRemovableSurplus)
    .sort(compareWeeklySlot)
  const retained = [
    ...protectedOccurrences,
    ...removableOccurrences.slice(0, Math.max(quota - protectedOccurrences.length, 0)),
  ]
  const occupiedSlots = new Set(retained.map(weeklySlotIndex))

  while (retained.length < quota) {
    const slotIndex = nextAvailableSlot(occupiedSlots)
    const key = weeklyKey(taskId, weekKey, slotIndex)
    retained.push(createWeeklyOccurrence(taskId, key))
    occupiedSlots.add(slotIndex)
  }

  return retained.sort(compareWeeklySlot)
}

function historicalOccurrencesForRange(
  task: Task,
  existing: TaskOccurrence[],
  from: LocalDate,
  to: LocalDate,
  effectiveFrom: LocalDate,
): TaskOccurrence[] {
  const historicalWeekPrefixes = new Set(
    weekKeysInRange(from, to)
      .filter((weekKey) => weekKey.start < isoWeekStart(effectiveFrom))
      .map((weekKey) => `weekly:${task.id}:${weekKey.key}:`),
  )

  return uniqueByKey(existing.filter((occurrence) => {
    if (occurrence.periodKey.startsWith(`daily:${task.id}:`)) {
      return occurrence.plannedDate !== null
        && occurrence.plannedDate >= from
        && occurrence.plannedDate <= to
        && occurrence.plannedDate < effectiveFrom
    }

    return [...historicalWeekPrefixes].some((prefix) => occurrence.periodKey.startsWith(prefix))
  }))
}

function weekKeysInRange(
  from: LocalDate,
  to: LocalDate,
): Array<{ key: string; start: LocalDate }> {
  const weeks: Array<{ key: string; start: LocalDate }> = []

  for (
    let weekStart = startOfISOWeek(parseISO(from));
    toLocalDate(weekStart) <= to;
    weekStart = addDays(weekStart, 7)
  ) {
    weeks.push({
      key: format(weekStart, "RRRR-'W'II"),
      start: toLocalDate(weekStart),
    })
  }

  return weeks
}

function applicableRange(
  task: Task,
  from: LocalDate,
  to: LocalDate,
): { from: LocalDate; to: LocalDate } | null {
  const completedDate = task.completedAt === null
    ? undefined
    : toLocalDate(parseISO(task.completedAt))
  const start = maxDate(from, task.startDate)
  const end = minDate(to, task.endDate, completedDate)

  return start <= end ? { from: start, to: end } : null
}

function createDailyOccurrence(taskId: string, key: string, date: LocalDate): TaskOccurrence {
  return {
    id: key,
    taskId,
    periodKey: key,
    plannedDate: date,
    boundDate: null,
    state: 'pending',
    completedAt: null,
  }
}

function createWeeklyOccurrence(taskId: string, key: string): TaskOccurrence {
  return {
    id: key,
    taskId,
    periodKey: key,
    plannedDate: null,
    boundDate: null,
    state: 'pending',
    completedAt: null,
  }
}

function dailyKey(taskId: string, date: LocalDate): string {
  return `daily:${taskId}:${date}`
}

function weeklyKey(taskId: string, weekKey: string, slotIndex: number): string {
  return `weekly:${taskId}:${weekKey}:${slotIndex}`
}

function isRemovableSurplus(occurrence: TaskOccurrence): boolean {
  return occurrence.state === 'pending' && occurrence.boundDate === null
}

function uniqueByKey(occurrences: TaskOccurrence[]): TaskOccurrence[] {
  return [...new Map(occurrences.map((occurrence) => [occurrence.periodKey, occurrence])).values()]
}

function compareWeeklySlot(left: TaskOccurrence, right: TaskOccurrence): number {
  return weeklySlotIndex(left) - weeklySlotIndex(right)
}

function weeklySlotIndex(occurrence: TaskOccurrence): number {
  const slot = Number(occurrence.periodKey.slice(occurrence.periodKey.lastIndexOf(':') + 1))
  return Number.isInteger(slot) && slot >= 0 ? slot : Number.MAX_SAFE_INTEGER
}

function nextAvailableSlot(occupiedSlots: Set<number>): number {
  let slotIndex = 0
  while (occupiedSlots.has(slotIndex)) {
    slotIndex += 1
  }
  return slotIndex
}

function normalizeQuota(quota: number | null): number {
  return quota !== null && Number.isInteger(quota) && quota > 0 ? quota : 0
}

function nextDate(date: LocalDate): LocalDate {
  return toLocalDate(addDays(parseISO(date), 1))
}

function isoWeekStart(date: LocalDate): LocalDate {
  return toLocalDate(startOfISOWeek(parseISO(date)))
}

function maxDate(...dates: LocalDate[]): LocalDate {
  return dates.reduce((latest, date) => (date > latest ? date : latest))
}

function minDate(...dates: Array<LocalDate | undefined>): LocalDate {
  return dates.reduce<LocalDate | undefined>(
    (earliest, date) => date !== undefined && (earliest === undefined || date < earliest) ? date : earliest,
    undefined,
  ) as LocalDate
}

import { addDays, format, isAfter, parseISO, startOfDay } from 'date-fns'
import type { LocalDate } from './models'

export interface LocalDayIntervalPart {
  date: LocalDate
  start: Date
  end: Date
  durationMs: number
}

export function assertDateRange(startDate: LocalDate, endDate: LocalDate): void {
  if (isAfter(parseISO(startDate), parseISO(endDate))) {
    throw new Error('开始日期不能晚于结束日期')
  }
}

export function toLocalDate(value: Date): LocalDate {
  return format(value, 'yyyy-MM-dd') as LocalDate
}

export function startOfLocalDay(value: Date | LocalDate): Date {
  return startOfDay(typeof value === 'string' ? parseISO(value) : value)
}

export function splitIntervalByLocalDay(start: Date, end: Date): LocalDayIntervalPart[] {
  if (end <= start) {
    throw new Error('结束时间必须晚于开始时间')
  }

  const parts: LocalDayIntervalPart[] = []
  let partStart = start

  while (partStart < end) {
    const nextMidnight = addDays(startOfLocalDay(partStart), 1)
    const partEnd = nextMidnight < end ? nextMidnight : end

    parts.push({
      date: toLocalDate(partStart),
      start: partStart,
      end: partEnd,
      durationMs: partEnd.getTime() - partStart.getTime(),
    })

    partStart = partEnd
  }

  return parts
}

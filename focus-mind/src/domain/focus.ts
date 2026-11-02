import { splitIntervalByLocalDay, toLocalDate } from './dates'
import type { FocusSession, Id, LocalDate, Task } from './models'

export type DerivedTaskStatus = 'focusing' | 'completed' | 'in_progress' | 'pending'

export interface DayFocusSummary {
  count: number
  durationMs: number
}

export interface FocusIntervalValidationOptions {
  now?: Date
  excludeSessionId?: Id
}

export function validateFocusInterval(
  start: Date,
  end: Date,
  existingSessions: readonly FocusSession[],
  options: FocusIntervalValidationOptions = {},
): void {
  const now = options.now ?? new Date()

  if (end <= start) {
    throw new Error('结束时间必须晚于开始时间')
  }

  if (end > now) {
    throw new Error('结束时间不能晚于当前时间')
  }

  const hasOverlap = existingSessions.some((session) => {
    if (session.id === options.excludeSessionId) {
      return false
    }

    const existingStart = new Date(session.startedAt)
    const existingEnd = session.endedAt === null ? now : new Date(session.endedAt)

    return start < existingEnd && end > existingStart
  })

  if (hasOverlap) {
    throw new Error('专注记录不能重叠')
  }
}

export function deriveTaskStatus(task: Task, sessions: readonly FocusSession[]): DerivedTaskStatus {
  const taskSessions = sessions.filter((session) => session.taskId === task.id)

  if (taskSessions.some((session) => session.endedAt === null)) {
    return 'focusing'
  }

  if (task.completedAt !== null) {
    return 'completed'
  }

  if (taskSessions.length > 0) {
    return 'in_progress'
  }

  return 'pending'
}

export function summarizeDay(
  date: LocalDate,
  sessions: readonly FocusSession[],
  now: Date = new Date(),
): DayFocusSummary {
  return sessions.reduce<DayFocusSummary>((summary, session) => {
    const start = new Date(session.startedAt)
    const end = session.endedAt === null ? now : new Date(session.endedAt)

    if (toLocalDate(start) === date) {
      summary.count += 1
    }

    for (const part of splitIntervalByLocalDay(start, end)) {
      if (part.date === date) {
        summary.durationMs += part.durationMs
      }
    }

    return summary
  }, { count: 0, durationMs: 0 })
}

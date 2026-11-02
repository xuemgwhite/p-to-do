export type Id = string
export type LocalDate = `${number}-${number}-${number}`
export type RecurrenceType = 'none' | 'daily' | 'weekly_quota'
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type CompletionState = 'pending' | 'completed'

export interface Theme {
  id: Id
  name: string
  color: string
  sortOrder: number
}

export interface Goal {
  id: Id
  themeId: Id
  name: string
  sortOrder: number
}

export interface Task {
  id: Id
  goalId: Id
  name: string
  description: string
  startDate: LocalDate
  endDate: LocalDate
  recurrenceType: RecurrenceType
  weeklyQuota: number | null
  excludedWeekdays?: Weekday[]
  completedAt: string | null
  sortOrder: number
}

export interface TaskOccurrence {
  id: Id
  taskId: Id
  periodKey: string
  plannedDate: LocalDate | null
  boundDate: LocalDate | null
  state: CompletionState
  completedAt: string | null
}

export interface FocusSession {
  id: Id
  taskId: Id
  occurrenceId: Id | null
  startedAt: string
  endedAt: string | null
  source: 'timer' | 'completion_form'
}

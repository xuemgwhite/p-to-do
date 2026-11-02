import type {
  FocusSession,
  Goal,
  Task,
  TaskOccurrence,
  Theme,
} from '../../domain/models'

export interface ThemeRow {
  id: string
  name: string
  color: string
  sort_order: number
}

export interface GoalRow {
  id: string
  theme_id: string
  name: string
  sort_order: number
}

export interface TaskRow {
  id: string
  goal_id: string
  name: string
  description: string
  start_date: Task['startDate']
  end_date: Task['endDate']
  recurrence_type: Task['recurrenceType']
  weekly_quota: number | null
  completed_at: string | null
  sort_order: number
}

export interface TaskOccurrenceRow {
  id: string
  task_id: string
  period_key: string
  planned_date: TaskOccurrence['plannedDate']
  bound_date: TaskOccurrence['boundDate']
  state: TaskOccurrence['state']
  completed_at: string | null
}

export interface FocusSessionRow {
  id: string
  task_id: string
  occurrence_id: string | null
  started_at: string
  ended_at: string | null
  source: FocusSession['source']
}

export function themeFromRow(row: ThemeRow): Theme {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    sortOrder: Number(row.sort_order),
  }
}

export function goalFromRow(row: GoalRow): Goal {
  return {
    id: row.id,
    themeId: row.theme_id,
    name: row.name,
    sortOrder: Number(row.sort_order),
  }
}

export function taskFromRow(row: TaskRow): Task {
  return {
    id: row.id,
    goalId: row.goal_id,
    name: row.name,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    recurrenceType: row.recurrence_type,
    weeklyQuota: row.weekly_quota === null ? null : Number(row.weekly_quota),
    completedAt: row.completed_at,
    sortOrder: Number(row.sort_order),
  }
}

export function occurrenceFromRow(row: TaskOccurrenceRow): TaskOccurrence {
  return {
    id: row.id,
    taskId: row.task_id,
    periodKey: row.period_key,
    plannedDate: row.planned_date,
    boundDate: row.bound_date,
    state: row.state,
    completedAt: row.completed_at,
  }
}

export function focusSessionFromRow(row: FocusSessionRow): FocusSession {
  return {
    id: row.id,
    taskId: row.task_id,
    occurrenceId: row.occurrence_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    source: row.source,
  }
}

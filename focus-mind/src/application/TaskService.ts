import { endOfISOWeek, parseISO, startOfISOWeek } from 'date-fns'
import { toLocalDate } from '../domain/dates'
import type {
  Goal,
  FocusSession,
  Id,
  LocalDate,
  Task,
  TaskOccurrence,
  Theme,
} from '../domain/models'
import {
  bindWeeklyOccurrence,
  occurrencesForRange,
  weeklyQuotaProgress,
} from '../domain/recurrence'
import type { DeletionImpact, FocusMindRepository } from '../ports/FocusMindRepository'

export type ApplicationErrorCode =
  | 'MANUAL_SESSION_REQUIRED'
  | 'INVALID_DATE_RANGE'
  | 'NO_OCCURRENCE_TODAY'
  | 'WEEKLY_QUOTA_COMPLETE'
  | 'FOCUS_OVERLAP'

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode

  constructor(code: ApplicationErrorCode, message: string) {
    super(message)
    this.name = 'ApplicationError'
    this.code = code
  }
}

export interface TaskTarget {
  taskId: Id
  occurrenceId?: Id | null
}

export type TaskTargetInput = Id | TaskTarget

export interface ManualFocusInterval {
  startedAt: Date | string
  endedAt: Date | string
}

export interface ResolvedTaskTarget {
  task: Task
  occurrence: TaskOccurrence | null
}

type IdFactory = () => Id

export class TaskService {
  private readonly repository: FocusMindRepository
  private readonly createId: IdFactory

  constructor(
    repository: FocusMindRepository,
    createId: IdFactory = defaultIdFactory,
  ) {
    this.repository = repository
    this.createId = createId
  }

  async getTask(id: Id): Promise<Task> {
    return requireTask(this.repository, id)
  }

  async getTaskEditorCatalog(): Promise<{ themes: Theme[]; goals: Goal[] }> {
    const themes = await this.repository.listThemes()
    const goals = (await Promise.all(themes.map((theme) => this.repository.listGoals(theme.id)))).flat()
    return { themes, goals }
  }

  async saveTask(task: Task): Promise<void> {
    await this.repository.saveTask(task)
  }

  async restoreTask(targetInput: TaskTargetInput): Promise<void> {
    const target = normalizeTarget(targetInput)
    const task = await requireTask(this.repository, target.taskId)
    if (task.recurrenceType === 'none') {
      await this.repository.saveTask({ ...task, completedAt: null })
      return
    }
    if (target.occurrenceId === undefined || target.occurrenceId === null) {
      throw new ApplicationError('NO_OCCURRENCE_TODAY', '找不到要恢复的任务实例')
    }
    const occurrence = (await this.repository.listOccurrencesForTask(task.id))
      .find((item) => item.id === target.occurrenceId)
    if (occurrence === undefined) {
      throw new ApplicationError('NO_OCCURRENCE_TODAY', '找不到要恢复的任务实例')
    }
    await this.repository.upsertOccurrences([{ ...occurrence, state: 'pending', completedAt: null }])
  }

  async getTaskDeletionImpact(taskId: Id): Promise<DeletionImpact> {
    return this.repository.countDeletionImpact('task', taskId)
  }

  async deleteTask(taskId: Id): Promise<void> {
    await this.repository.transaction(async (transaction) => {
      await transaction.deleteCascade('task', taskId)
    })
  }

  async completeTask(
    targetInput: TaskTargetInput,
    now: Date = new Date(),
    manualInterval?: ManualFocusInterval,
  ): Promise<ResolvedTaskTarget> {
    const target = normalizeTarget(targetInput)
    const task = await requireTask(this.repository, target.taskId)
    const occurrences = await this.repository.listOccurrencesForTask(task.id)
    const resolved = resolveTaskTarget(task, occurrences, toLocalDate(now), target.occurrenceId)
    const taskSessions = await this.repository.listFocusSessionsForTask(task.id)
    const relevantSessions = resolved.occurrence === null
      ? taskSessions
      : taskSessions.filter((session) => session.occurrenceId === resolved.occurrence?.id)

    let completionSession: FocusSession | null = null
    if (relevantSessions.length === 0) {
      if (manualInterval === undefined) {
        throw new ApplicationError(
          'MANUAL_SESSION_REQUIRED',
          '完成前需要填写实际专注开始和结束时间',
        )
      }
      const startedAt = asDate(manualInterval.startedAt)
      const endedAt = asDate(manualInterval.endedAt)
      validateManualInterval(startedAt, endedAt, now, [])
      const overlappingSessions = await this.repository.listFocusSessions(
        startedAt.toISOString(),
        endedAt.toISOString(),
      )
      validateManualInterval(startedAt, endedAt, now, overlappingSessions)
      completionSession = {
        id: this.createId(),
        taskId: task.id,
        occurrenceId: resolved.occurrence?.id ?? null,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        source: 'completion_form',
      }
    }

    const completedAt = now.toISOString()
    const completedTarget: ResolvedTaskTarget = resolved.occurrence === null
      ? { task: { ...resolved.task, completedAt }, occurrence: null }
      : {
          task: resolved.task,
          occurrence: {
            ...resolved.occurrence,
            state: 'completed',
            completedAt,
          },
        }

    await this.repository.transaction(async (transaction) => {
      if (completedTarget.occurrence !== null) {
        if (completionSession !== null && resolved.occurrence !== null) {
          await transaction.upsertOccurrences([resolved.occurrence])
          await transaction.saveFocusSession(completionSession)
        }
        await transaction.upsertOccurrences([completedTarget.occurrence])
      } else {
        if (completionSession !== null) await transaction.saveFocusSession(completionSession)
        await transaction.saveTask(completedTarget.task)
      }
    })

    return completedTarget
  }

  async startEarly(
    targetInput: TaskTargetInput,
    today: LocalDate,
  ): Promise<ResolvedTaskTarget> {
    const target = normalizeTarget(targetInput)
    const task = await requireTask(this.repository, target.taskId)
    const occurrences = await this.repository.listOccurrencesForTask(task.id)
    const resolved = resolveTaskTarget(task, occurrences, today, target.occurrenceId)

    await this.repository.transaction(async (transaction) => {
      if (!sameTask(task, resolved.task)) await transaction.saveTask(resolved.task)
      if (resolved.occurrence !== null) {
        await transaction.upsertOccurrences([resolved.occurrence])
      }
    })
    return resolved
  }
}

export function resolveTaskTarget(
  task: Task,
  occurrences: TaskOccurrence[],
  today: LocalDate,
  occurrenceId?: Id | null,
): ResolvedTaskTarget {
  if (task.completedAt !== null) {
    throw new ApplicationError('NO_OCCURRENCE_TODAY', '已完成任务不能开始专注')
  }

  if (task.recurrenceType === 'none') {
    return {
      task: {
        ...task,
        startDate: task.startDate > today ? today : task.startDate,
        endDate: task.endDate < today ? today : task.endDate,
      },
      occurrence: null,
    }
  }

  if (today < task.startDate || today > task.endDate) {
    throw new ApplicationError('NO_OCCURRENCE_TODAY', '今天没有可开始的任务实例')
  }

  if (task.recurrenceType === 'daily') {
    const generated = occurrencesForRange(task, occurrences, today, today, today)
    const occurrence = occurrenceId === undefined || occurrenceId === null
      ? generated.find((item) => item.plannedDate === today)
      : generated.find((item) => item.id === occurrenceId && item.plannedDate === today)
    if (occurrence === undefined || occurrence.state === 'completed') {
      throw new ApplicationError('NO_OCCURRENCE_TODAY', '今天没有可开始的每日任务实例')
    }
    return { task, occurrence }
  }

  const weekStart = toLocalDate(startOfISOWeek(parseISO(today)))
  const weekEnd = toLocalDate(endOfISOWeek(parseISO(today)))
  const generated = occurrencesForRange(task, occurrences, weekStart, weekEnd, today)
  const progress = weeklyQuotaProgress(generated, task.weeklyQuota ?? 0)
  const hasExplicitOccurrence = occurrenceId !== undefined && occurrenceId !== null
  if (hasExplicitOccurrence) {
    const requested = generated.find((item) => item.id === occurrenceId)
    if (requested === undefined || requested.state === 'completed') {
      throw new ApplicationError('NO_OCCURRENCE_TODAY', '该实例今天不可开始')
    }
    if (progress.completed >= progress.quota) {
      throw new ApplicationError('WEEKLY_QUOTA_COMPLETE', '本周配额已经完成')
    }
    if (requested.boundDate === today) return { task, occurrence: requested }
    if (requested.boundDate === null) {
      return { task, occurrence: { ...requested, boundDate: today } }
    }
    throw new ApplicationError('NO_OCCURRENCE_TODAY', '该实例已绑定到其他日期')
  }

  if (progress.completed >= progress.quota) {
    throw new ApplicationError('WEEKLY_QUOTA_COMPLETE', '本周配额已经完成')
  }

  const alreadyBoundToday = generated.find(
    (item) => item.state === 'pending' && item.boundDate === today,
  )
  if (alreadyBoundToday !== undefined) return { task, occurrence: alreadyBoundToday }

  try {
    return { task, occurrence: bindWeeklyOccurrence(generated, today) }
  } catch {
    throw new ApplicationError('NO_OCCURRENCE_TODAY', '今天没有可绑定的每周实例')
  }
}

export function normalizeTarget(target: TaskTargetInput): TaskTarget {
  return typeof target === 'string' ? { taskId: target } : target
}

export async function requireTask(
  repository: FocusMindRepository,
  taskId: Id,
): Promise<Task> {
  const task = await repository.getTask(taskId)
  if (task === null) throw new Error(`Task not found: ${taskId}`)
  return task
}

export function validateManualInterval(
  start: Date,
  end: Date,
  now: Date,
  existingSessions: readonly FocusSession[],
  excludeSessionId?: Id,
): void {
  if (!isValidDate(start) || !isValidDate(end) || end <= start || end > now) {
    throw new ApplicationError('INVALID_DATE_RANGE', '专注时间范围无效')
  }
  const overlaps = existingSessions.some((session) => {
    if (session.id === excludeSessionId) return false
    const existingStart = new Date(session.startedAt)
    const existingEnd = session.endedAt === null ? now : new Date(session.endedAt)
    return start < existingEnd && end > existingStart
  })
  if (overlaps) throw new ApplicationError('FOCUS_OVERLAP', '专注记录不能重叠')
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime())
}

function sameTask(left: Task, right: Task): boolean {
  return left.startDate === right.startDate && left.endDate === right.endDate
}

function defaultIdFactory(): Id {
  return crypto.randomUUID()
}

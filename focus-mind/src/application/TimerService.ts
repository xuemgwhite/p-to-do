import { toLocalDate } from '../domain/dates'
import { validateFocusInterval } from '../domain/focus'
import type { FocusSession, Id } from '../domain/models'
import type { FocusMindRepository } from '../ports/FocusMindRepository'
import {
  ApplicationError,
  normalizeTarget,
  requireTask,
  resolveTaskTarget,
  type TaskTargetInput,
  validateManualInterval,
} from './TaskService'

type IdFactory = () => Id

export interface FocusSessionUpdate {
  taskId: Id
  sessionId: Id
  startedAt: Date | string
  endedAt: Date | string
}

export type RecoveryChoice =
  | 'end_now'
  | 'discard'
  | { type: 'end_now'; now?: Date }
  | { type: 'end_at'; endedAt: Date | string; now?: Date }
  | { type: 'discard' }

export class TimerService {
  private readonly repository: FocusMindRepository
  private readonly createId: IdFactory

  constructor(
    repository: FocusMindRepository,
    createId: IdFactory = () => crypto.randomUUID(),
  ) {
    this.repository = repository
    this.createId = createId
  }

  async getActiveSession(): Promise<FocusSession | null> {
    return this.repository.getActiveFocusSession()
  }

  async listSessions(fromIso: string, toIso: string): Promise<FocusSession[]> {
    return this.repository.listFocusSessions(fromIso, toIso)
  }

  async getTaskName(taskId: Id): Promise<string | null> {
    return (await this.repository.getTask(taskId))?.name ?? null
  }

  async getSession(taskId: Id, sessionId: Id): Promise<FocusSession | null> {
    return (await this.repository.listFocusSessionsForTask(taskId))
      .find((session) => session.id === sessionId) ?? null
  }

  async updateSession(input: FocusSessionUpdate, now: Date = new Date()): Promise<FocusSession> {
    const start = input.startedAt instanceof Date ? input.startedAt : new Date(input.startedAt)
    const end = input.endedAt instanceof Date ? input.endedAt : new Date(input.endedAt)
    validateManualInterval(start, end, now, [], input.sessionId)
    const sessions = await this.repository.listFocusSessions(start.toISOString(), end.toISOString())
    validateManualInterval(start, end, now, sessions, input.sessionId)
    const original = await this.getSession(input.taskId, input.sessionId)
    if (original === null) throw new Error('专注记录不存在或已删除')
    const updated = { ...original, startedAt: start.toISOString(), endedAt: end.toISOString() }
    await this.repository.saveFocusSession(updated)
    return updated
  }

  async deleteSession(sessionId: Id): Promise<void> {
    await this.repository.deleteFocusSession(sessionId)
  }

  async start(targetInput: TaskTargetInput, now: Date = new Date()): Promise<FocusSession> {
    assertValidNow(now)
    const target = normalizeTarget(targetInput)
    const task = await requireTask(this.repository, target.taskId)
    const occurrences = await this.repository.listOccurrencesForTask(task.id)
    const active = await this.repository.getActiveFocusSession()
    const resolved = resolveTaskTarget(task, occurrences, toLocalDate(now), target.occurrenceId)

    if (active !== null && now <= new Date(active.startedAt)) {
      throw new ApplicationError('INVALID_DATE_RANGE', '新的结束时间必须晚于活动段开始时间')
    }
    if (active !== null) {
      const existing = await this.repository.listFocusSessions(active.startedAt, now.toISOString())
      validateTimerInterval(active, now, existing)
    } else {
      const pointEnd = new Date(now.getTime() + 1)
      const existing = await this.repository.listFocusSessions(
        now.toISOString(),
        pointEnd.toISOString(),
      )
      if (existing.some((session) => (
        session.endedAt !== null
        && new Date(session.startedAt) <= now
        && new Date(session.endedAt) > now
      ))) {
        throw new ApplicationError('FOCUS_OVERLAP', '开始时间不能落在已有专注记录内')
      }
    }

    const session: FocusSession = {
      id: this.createId(),
      taskId: resolved.task.id,
      occurrenceId: resolved.occurrence?.id ?? null,
      startedAt: now.toISOString(),
      endedAt: null,
      source: 'timer',
    }

    await this.repository.transaction(async (transaction) => {
      if (resolved.task.startDate !== task.startDate || resolved.task.endDate !== task.endDate) {
        await transaction.saveTask(resolved.task)
      }
      if (resolved.occurrence !== null) {
        await transaction.upsertOccurrences([resolved.occurrence])
      }
      if (active !== null) {
        await transaction.saveFocusSession({ ...active, endedAt: now.toISOString() })
      }
      await transaction.saveFocusSession(session)
    })

    return session
  }

  async stop(now: Date = new Date()): Promise<FocusSession | null> {
    assertValidNow(now)
    const active = await this.repository.getActiveFocusSession()
    if (active === null) return null
    if (now <= new Date(active.startedAt)) {
      throw new ApplicationError('INVALID_DATE_RANGE', '结束时间必须晚于开始时间')
    }
    const existing = await this.repository.listFocusSessions(active.startedAt, now.toISOString())
    validateTimerInterval(active, now, existing)
    const stopped = { ...active, endedAt: now.toISOString() }
    await this.repository.saveFocusSession(stopped)
    return stopped
  }

  async recover(choice: RecoveryChoice, fallbackNow: Date = new Date()): Promise<FocusSession | null> {
    const active = await this.repository.getActiveFocusSession()
    if (active === null) return null

    const type = typeof choice === 'string' ? choice : choice.type
    if (type === 'discard') {
      await this.repository.deleteFocusSession(active.id)
      return null
    }

    const now = typeof choice === 'object' && 'now' in choice && choice.now !== undefined
      ? choice.now
      : fallbackNow
    const endedAt = typeof choice === 'object' && choice.type === 'end_at'
      ? (choice.endedAt instanceof Date ? choice.endedAt : new Date(choice.endedAt))
      : now
    const activeStartedAt = new Date(active.startedAt)
    if (
      Number.isNaN(endedAt.getTime())
      || Number.isNaN(now.getTime())
      || endedAt <= activeStartedAt
      || endedAt > now
    ) {
      throw new ApplicationError('INVALID_DATE_RANGE', '专注时间范围无效')
    }
    const existing = await this.repository.listFocusSessions(active.startedAt, endedAt.toISOString())
    validateManualInterval(
      activeStartedAt,
      endedAt,
      now,
      existing,
      active.id,
    )
    const recovered = { ...active, endedAt: endedAt.toISOString() }
    await this.repository.saveFocusSession(recovered)
    return recovered
  }
}

function assertValidNow(now: Date): void {
  if (Number.isNaN(now.getTime())) {
    throw new ApplicationError('INVALID_DATE_RANGE', '系统时间无效')
  }
}

function validateTimerInterval(
  active: FocusSession,
  endedAt: Date,
  existing: readonly FocusSession[],
): void {
  try {
    validateFocusInterval(
      new Date(active.startedAt),
      endedAt,
      existing,
      { now: endedAt, excludeSessionId: active.id },
    )
  } catch (error) {
    if (error instanceof Error && error.message === '专注记录不能重叠') {
      throw new ApplicationError('FOCUS_OVERLAP', error.message)
    }
    throw new ApplicationError(
      'INVALID_DATE_RANGE',
      error instanceof Error ? error.message : '专注时间范围无效',
    )
  }
}

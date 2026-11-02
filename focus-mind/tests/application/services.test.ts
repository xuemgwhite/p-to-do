import { describe, expect, it } from 'vitest'
import { TaskService } from '../../src/application/TaskService'
import { TimerService } from '../../src/application/TimerService'
import { ScheduleService } from '../../src/application/ScheduleService'
import { createApplicationRuntime } from '../../src/app/bootstrap'
import type {
  FocusSession,
  Goal,
  Task,
  TaskOccurrence,
  Theme,
} from '../../src/domain/models'
import {
  PreviewRepository,
  type PreviewRepositorySeed,
} from '../../src/infrastructure/preview/PreviewRepository'
import { PreviewDesktopPort } from '../../src/infrastructure/preview/PreviewDesktopPort'

const theme: Theme = { id: 'theme-1', name: '生活', color: '#28A47A', sortOrder: 0 }
const goal: Goal = { id: 'goal-1', themeId: theme.id, name: '保持节奏', sortOrder: 0 }
const ordinaryTask: Task = {
  id: 'task-ordinary',
  goalId: goal.id,
  name: '整理本周计划',
  description: '',
  startDate: '2026-07-01',
  endDate: '2026-07-31',
  recurrenceType: 'none',
  weeklyQuota: null,
  completedAt: null,
  sortOrder: 0,
}
const now = new Date('2026-07-18T09:00:00+08:00')

function repository(seed: Partial<PreviewRepositorySeed> = {}) {
  return new PreviewRepository({
    themes: [theme],
    goals: [goal],
    tasks: [ordinaryTask],
    occurrences: [],
    focusSessions: [],
    ...seed,
  })
}

class TrackingPreviewRepository extends PreviewRepository {
  transactionCount = 0

  override async transaction<T>(work: Parameters<PreviewRepository['transaction']>[0]) {
    this.transactionCount += 1
    return super.transaction(work) as Promise<T>
  }
}

describe('TaskService', () => {
  it('owns task editor reads, saves, restores, impact lookup, and deletion', async () => {
    const completedTask = { ...ordinaryTask, completedAt: now.toISOString() }
    const repo = repository({ tasks: [completedTask] })
    const service = new TaskService(repo)

    expect(await service.getTask(completedTask.id)).toEqual(completedTask)
    expect(await service.getTaskEditorCatalog()).toEqual({ themes: [theme], goals: [goal] })

    await service.saveTask({ ...completedTask, name: '更新后的任务' })
    expect((await service.getTask(completedTask.id)).name).toBe('更新后的任务')

    await service.restoreTask(completedTask.id)
    expect((await service.getTask(completedTask.id)).completedAt).toBeNull()
    expect(await service.getTaskDeletionImpact(completedTask.id)).toMatchObject({ tasks: 1 })

    await service.deleteTask(completedTask.id)
    await expect(service.getTask(completedTask.id)).rejects.toThrow('Task not found')
  })

  it('restores a completed recurring occurrence without restoring the task body', async () => {
    const dailyTask = { ...ordinaryTask, id: 'task-daily-restore', recurrenceType: 'daily' as const }
    const occurrence: TaskOccurrence = {
      id: 'daily-restore', taskId: dailyTask.id, periodKey: 'daily:task-daily-restore:2026-07-18',
      plannedDate: '2026-07-18', boundDate: null, state: 'completed', completedAt: now.toISOString(),
    }
    const repo = repository({ tasks: [dailyTask], occurrences: [occurrence] })

    await new TaskService(repo).restoreTask({ taskId: dailyTask.id, occurrenceId: occurrence.id })

    expect(await repo.getTask(dailyTask.id)).toEqual(dailyTask)
    expect(await repo.listOccurrencesForTask(dailyTask.id)).toMatchObject([{ state: 'pending', completedAt: null }])
  })

  it('requires a manual focus interval when completing a target without sessions', async () => {
    const service = new TaskService(repository(), () => 'manual-session')

    await expect(service.completeTask(ordinaryTask.id, now)).rejects.toMatchObject({
      code: 'MANUAL_SESSION_REQUIRED',
    })
  })

  it('completes a task directly when a saved session already exists', async () => {
    const repo = repository()
    const savedSession: FocusSession = {
      id: 'saved-session',
      taskId: ordinaryTask.id,
      occurrenceId: null,
      startedAt: '2026-07-18T00:00:00.000Z',
      endedAt: '2026-07-18T00:30:00.000Z',
      source: 'timer',
    }
    await repo.saveFocusSession(savedSession)

    await new TaskService(repo).completeTask(ordinaryTask.id, now)

    expect(await repo.getTask(ordinaryTask.id)).toMatchObject({
      completedAt: now.toISOString(),
    })
    expect(await repo.listFocusSessionsForTask(ordinaryTask.id)).toEqual([savedSession])
  })

  it('rejects a completion-form interval that overlaps another task session', async () => {
    const otherTask: Task = { ...ordinaryTask, id: 'task-other', name: '其他任务' }
    const repo = repository({
      tasks: [ordinaryTask, otherTask],
      focusSessions: [{
        id: 'other-session',
        taskId: otherTask.id,
        occurrenceId: null,
        startedAt: '2026-07-18T00:00:00.000Z',
        endedAt: '2026-07-18T00:45:00.000Z',
        source: 'timer',
      }],
    })

    await expect(new TaskService(repo).completeTask(ordinaryTask.id, now, {
      startedAt: '2026-07-18T00:30:00.000Z',
      endedAt: '2026-07-18T00:50:00.000Z',
    })).rejects.toMatchObject({ code: 'FOCUS_OVERLAP' })
  })

  it('moves a future ordinary task start date to today before starting', async () => {
    const futureTask: Task = {
      ...ordinaryTask,
      startDate: '2026-07-20',
      endDate: '2026-07-25',
    }
    const repo = repository({ tasks: [futureTask] })

    const resolved = await new TaskService(repo).startEarly(futureTask.id, '2026-07-18')

    expect(resolved.task).toMatchObject({
      startDate: '2026-07-18',
      endDate: '2026-07-25',
    })
    expect(await repo.getTask(futureTask.id)).toEqual(resolved.task)
  })

  it('extends an ordinary task end date when starting after its original range', async () => {
    const endedTask: Task = {
      ...ordinaryTask,
      endDate: '2026-07-10',
    }
    const repo = repository({ tasks: [endedTask] })

    const resolved = await new TaskService(repo).startEarly(endedTask.id, '2026-07-18')

    expect(resolved.task).toMatchObject({
      startDate: endedTask.startDate,
      endDate: '2026-07-18',
    })
  })

  it('rejects a daily task when today has no scheduled occurrence', async () => {
    const dailyTask: Task = {
      ...ordinaryTask,
      id: 'task-daily',
      recurrenceType: 'daily',
      startDate: '2026-07-19',
      endDate: '2026-07-31',
    }
    const service = new TaskService(repository({ tasks: [dailyTask] }))

    await expect(service.startEarly(dailyTask.id, '2026-07-18')).rejects.toMatchObject({
      code: 'NO_OCCURRENCE_TODAY',
    })
  })

  it('rejects starting an already completed ordinary task', async () => {
    const completedTask: Task = {
      ...ordinaryTask,
      completedAt: '2026-07-17T01:00:00.000Z',
    }
    const service = new TaskService(repository({ tasks: [completedTask] }))

    await expect(service.startEarly(completedTask.id, '2026-07-18')).rejects.toMatchObject({
      code: 'NO_OCCURRENCE_TODAY',
    })
  })

  it('binds one weekly quota slot to today', async () => {
    const weeklyTask: Task = {
      ...ordinaryTask,
      id: 'task-weekly',
      recurrenceType: 'weekly_quota',
      weeklyQuota: 2,
    }
    const repo = repository({ tasks: [weeklyTask] })

    const resolved = await new TaskService(repo).startEarly(weeklyTask.id, '2026-07-18')

    expect(resolved.occurrence).toMatchObject({
      taskId: weeklyTask.id,
      boundDate: '2026-07-18',
      state: 'pending',
    })
    expect(await repo.listOccurrencesForTask(weeklyTask.id)).toContainEqual(resolved.occurrence)
  })

  it.each([
    ['unknown', 'missing-slot', []],
    ['deleted', 'deleted-slot', []],
    ['wrong-week', 'wrong-week-slot', [{
      id: 'wrong-week-slot',
      taskId: 'task-weekly-explicit',
      periodKey: 'weekly:task-weekly-explicit:2026-W28:0',
      plannedDate: null,
      boundDate: null,
      state: 'pending' as const,
      completedAt: null,
    }]],
  ])('rejects an explicit %s weekly occurrence instead of auto-binding another slot', async (
    _case,
    occurrenceId,
    occurrences,
  ) => {
    const weeklyTask: Task = {
      ...ordinaryTask,
      id: 'task-weekly-explicit',
      recurrenceType: 'weekly_quota',
      weeklyQuota: 2,
    }
    const service = new TaskService(repository({ tasks: [weeklyTask], occurrences }))

    await expect(service.startEarly({ taskId: weeklyTask.id, occurrenceId }, '2026-07-18'))
      .rejects.toMatchObject({ code: 'NO_OCCURRENCE_TODAY' })
  })

  it('distinguishes a completed weekly quota from no occurrence available today', async () => {
    const weeklyTask: Task = {
      ...ordinaryTask,
      id: 'task-weekly-status',
      recurrenceType: 'weekly_quota',
      weeklyQuota: 1,
    }
    const weeklyOccurrence: TaskOccurrence = {
      id: 'weekly-status-slot',
      taskId: weeklyTask.id,
      periodKey: 'weekly:task-weekly-status:2026-W29:0',
      plannedDate: null,
      boundDate: '2026-07-17',
      state: 'completed',
      completedAt: '2026-07-17T01:00:00.000Z',
    }
    const completeService = new TaskService(repository({
      tasks: [weeklyTask],
      occurrences: [weeklyOccurrence],
    }))
    await expect(completeService.startEarly(weeklyTask.id, '2026-07-18'))
      .rejects.toMatchObject({ code: 'WEEKLY_QUOTA_COMPLETE' })

    const unavailableService = new TaskService(repository({
      tasks: [weeklyTask],
      occurrences: [{ ...weeklyOccurrence, state: 'pending', completedAt: null }],
    }))
    await expect(unavailableService.startEarly(weeklyTask.id, '2026-07-18'))
      .rejects.toMatchObject({ code: 'NO_OCCURRENCE_TODAY' })
  })
})

describe('TimerService', () => {
  it('lists focus sessions through the application service boundary', async () => {
    const session: FocusSession = {
      id: 'listed-session', taskId: ordinaryTask.id, occurrenceId: null,
      startedAt: '2026-07-18T00:00:00.000Z', endedAt: '2026-07-18T00:30:00.000Z', source: 'timer',
    }
    const service = new TimerService(repository({ focusSessions: [session] }))

    expect(await service.listSessions('2026-07-18T00:00:00.000Z', '2026-07-18T01:00:00.000Z')).toEqual([session])
  })

  it('owns active/session reads plus validated update and deletion', async () => {
    const session: FocusSession = {
      id: 'managed-session', taskId: ordinaryTask.id, occurrenceId: null,
      startedAt: '2026-07-18T00:00:00.000Z', endedAt: '2026-07-18T00:30:00.000Z', source: 'timer',
    }
    const repo = repository({ focusSessions: [session] })
    const service = new TimerService(repo)

    expect(await service.getActiveSession()).toBeNull()
    expect(await service.getSession(ordinaryTask.id, session.id)).toEqual(session)
    const updated = await service.updateSession({
      taskId: ordinaryTask.id,
      sessionId: session.id,
      startedAt: '2026-07-18T00:10:00.000Z',
      endedAt: '2026-07-18T00:40:00.000Z',
    }, now)
    expect(updated).toMatchObject({ startedAt: '2026-07-18T00:10:00.000Z', endedAt: '2026-07-18T00:40:00.000Z' })

    await service.deleteSession(session.id)
    expect(await service.getSession(ordinaryTask.id, session.id)).toBeNull()
  })

  it('rejects an updated session interval that overlaps another record', async () => {
    const edited: FocusSession = {
      id: 'edited-session', taskId: ordinaryTask.id, occurrenceId: null,
      startedAt: '2026-07-18T00:00:00.000Z', endedAt: '2026-07-18T00:30:00.000Z', source: 'timer',
    }
    const other: FocusSession = {
      id: 'other-session', taskId: ordinaryTask.id, occurrenceId: null,
      startedAt: '2026-07-18T01:00:00.000Z', endedAt: '2026-07-18T01:30:00.000Z', source: 'timer',
    }
    const service = new TimerService(repository({ focusSessions: [edited, other] }))

    await expect(service.updateSession({
      taskId: ordinaryTask.id,
      sessionId: edited.id,
      startedAt: '2026-07-18T00:45:00.000Z',
      endedAt: '2026-07-18T01:15:00.000Z',
    }, new Date('2026-07-18T12:00:00+08:00'))).rejects.toMatchObject({ code: 'FOCUS_OVERLAP' })
  })

  it('ends the old active session and starts the target in one transaction', async () => {
    const secondTask: Task = { ...ordinaryTask, id: 'task-second', name: '第二件事' }
    const repo = new TrackingPreviewRepository({
      themes: [theme],
      goals: [goal],
      tasks: [ordinaryTask, secondTask],
      occurrences: [],
      focusSessions: [{
        id: 'active-first',
        taskId: ordinaryTask.id,
        occurrenceId: null,
        startedAt: '2026-07-18T00:00:00.000Z',
        endedAt: null,
        source: 'timer',
      }],
    })
    const service = new TimerService(repo, () => 'active-second')

    const started = await service.start(secondTask.id, now)

    expect(repo.transactionCount).toBe(1)
    expect(started).toMatchObject({
      id: 'active-second',
      taskId: secondTask.id,
      endedAt: null,
    })
    expect(await repo.listFocusSessionsForTask(ordinaryTask.id)).toMatchObject([
      { id: 'active-first', endedAt: now.toISOString() },
    ])
    expect(await repo.getActiveFocusSession()).toEqual(started)
  })

  it('recovers an active segment by ending now, ending manually, or discarding it', async () => {
    const active: FocusSession = {
      id: 'recover-active',
      taskId: ordinaryTask.id,
      occurrenceId: null,
      startedAt: '2026-07-18T00:00:00.000Z',
      endedAt: null,
      source: 'timer',
    }

    const endNowRepo = repository({ focusSessions: [active] })
    await new TimerService(endNowRepo).recover('end_now', now)
    expect(await endNowRepo.getActiveFocusSession()).toBeNull()
    expect(await endNowRepo.listFocusSessionsForTask(ordinaryTask.id)).toMatchObject([
      { endedAt: now.toISOString() },
    ])

    const endAtRepo = repository({ focusSessions: [active] })
    await new TimerService(endAtRepo).recover({
      type: 'end_at',
      endedAt: '2026-07-18T00:30:00.000Z',
      now,
    })
    expect(await endAtRepo.listFocusSessionsForTask(ordinaryTask.id)).toMatchObject([
      { endedAt: '2026-07-18T00:30:00.000Z' },
    ])

    const discardRepo = repository({ focusSessions: [active] })
    await new TimerService(discardRepo).recover('discard', now)
    expect(await discardRepo.listFocusSessionsForTask(ordinaryTask.id)).toEqual([])
  })

  it('returns INVALID_DATE_RANGE for an invalid manual recovery time', async () => {
    const repo = repository({ focusSessions: [{
      id: 'recover-invalid',
      taskId: ordinaryTask.id,
      occurrenceId: null,
      startedAt: '2026-07-18T00:00:00.000Z',
      endedAt: null,
      source: 'timer',
    }] })

    await expect(new TimerService(repo).recover({
      type: 'end_at',
      endedAt: 'not-a-date',
      now,
    })).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE' })
  })

  it('rejects starting at a time inside a saved focus interval', async () => {
    const secondTask: Task = { ...ordinaryTask, id: 'task-second', name: '第二件事' }
    const saved: FocusSession = {
      id: 'saved-overlap',
      taskId: ordinaryTask.id,
      occurrenceId: null,
      startedAt: '2026-07-18T00:00:00.000Z',
      endedAt: '2026-07-18T01:00:00.000Z',
      source: 'timer',
    }
    const repo = repository({ tasks: [ordinaryTask, secondTask], focusSessions: [saved] })

    await expect(new TimerService(repo).start(
      secondTask.id,
      new Date('2026-07-18T00:30:00.000Z'),
    )).rejects.toMatchObject({ code: 'FOCUS_OVERLAP' })
    expect(await repo.getActiveFocusSession()).toBeNull()
    expect(await repo.listFocusSessionsForTask(ordinaryTask.id)).toEqual([saved])
  })

  it('rejects switching when closing the old active interval would overlap a saved interval', async () => {
    const secondTask: Task = { ...ordinaryTask, id: 'task-second', name: '第二件事' }
    const active: FocusSession = {
      id: 'switch-active',
      taskId: ordinaryTask.id,
      occurrenceId: null,
      startedAt: '2026-07-17T23:30:00.000Z',
      endedAt: null,
      source: 'timer',
    }
    const saved: FocusSession = {
      id: 'switch-overlap',
      taskId: secondTask.id,
      occurrenceId: null,
      startedAt: '2026-07-18T00:00:00.000Z',
      endedAt: '2026-07-18T00:30:00.000Z',
      source: 'timer',
    }
    const repo = repository({
      tasks: [ordinaryTask, secondTask],
      focusSessions: [active, saved],
    })

    await expect(new TimerService(repo).start(
      secondTask.id,
      new Date('2026-07-18T01:00:00.000Z'),
    )).rejects.toMatchObject({ code: 'FOCUS_OVERLAP' })
    expect(await repo.getActiveFocusSession()).toEqual(active)
  })

  it('rejects stopping when the active interval would overlap a saved interval', async () => {
    const active: FocusSession = {
      id: 'stop-active',
      taskId: ordinaryTask.id,
      occurrenceId: null,
      startedAt: '2026-07-17T23:30:00.000Z',
      endedAt: null,
      source: 'timer',
    }
    const saved: FocusSession = {
      id: 'stop-overlap',
      taskId: ordinaryTask.id,
      occurrenceId: null,
      startedAt: '2026-07-18T00:00:00.000Z',
      endedAt: '2026-07-18T00:30:00.000Z',
      source: 'timer',
    }
    const repo = repository({ focusSessions: [active, saved] })

    await expect(new TimerService(repo).stop(
      new Date('2026-07-18T01:00:00.000Z'),
    )).rejects.toMatchObject({ code: 'FOCUS_OVERLAP' })
    expect(await repo.getActiveFocusSession()).toEqual(active)
  })

  it('rejects a clock rollback without changing the active interval', async () => {
    const secondTask: Task = { ...ordinaryTask, id: 'task-second', name: '第二件事' }
    const active: FocusSession = {
      id: 'rollback-active',
      taskId: ordinaryTask.id,
      occurrenceId: null,
      startedAt: '2026-07-18T01:00:00.000Z',
      endedAt: null,
      source: 'timer',
    }
    const repo = repository({ tasks: [ordinaryTask, secondTask], focusSessions: [active] })
    const timer = new TimerService(repo)

    await expect(timer.start(
      secondTask.id,
      new Date('2026-07-18T00:59:00.000Z'),
    )).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE' })
    await expect(timer.stop(
      new Date('2026-07-18T00:59:00.000Z'),
    )).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE' })
    expect(await repo.getActiveFocusSession()).toEqual(active)
  })
})

describe('ScheduleService', () => {
  it('builds day pending/completed items and a weekly quota reminder', async () => {
    const dailyTask: Task = {
      ...ordinaryTask,
      id: 'task-daily',
      name: '每日回顾',
      recurrenceType: 'daily',
    }
    const weeklyTask: Task = {
      ...ordinaryTask,
      id: 'task-weekly',
      name: '每周训练',
      recurrenceType: 'weekly_quota',
      weeklyQuota: 2,
    }
    const completedDaily: TaskOccurrence = {
      id: 'daily-completed',
      taskId: dailyTask.id,
      periodKey: 'daily:task-daily:2026-07-18',
      plannedDate: '2026-07-18',
      boundDate: null,
      state: 'completed',
      completedAt: '2026-07-18T00:30:00.000Z',
    }
    const repo = repository({
      tasks: [ordinaryTask, dailyTask, weeklyTask],
      occurrences: [completedDaily],
    })

    const day = await new ScheduleService(repo).getDay('2026-07-18', now)

    expect(day.pending.map((item) => item.task.id)).toEqual([ordinaryTask.id])
    expect(day.completed.map((item) => item.task.id)).toEqual([dailyTask.id])
    expect(day.weeklyQuotaReminders).toMatchObject([{
      task: { id: weeklyTask.id },
      completed: 0,
      quota: 2,
      remaining: 2,
    }])
  })

  it('splits cross-midnight sessions into week segments and keeps month timed rows first', async () => {
    const crossMidnight: FocusSession = {
      id: 'cross-midnight',
      taskId: ordinaryTask.id,
      occurrenceId: null,
      startedAt: '2026-07-17T15:30:00.000Z',
      endedAt: '2026-07-17T16:30:00.000Z',
      source: 'timer',
    }
    const repo = repository({ focusSessions: [crossMidnight] })
    const service = new ScheduleService(repo)

    const week = await service.getWeek('2026-07-18', now)
    const month = await service.getMonth('2026-07-18', now)

    expect(week.days.flatMap((day) => [...day.allDay, ...day.completed]).filter((item) => item.task.id === ordinaryTask.id)).toHaveLength(1)
    expect(month.days.flatMap((day) => day.items).filter((item) => item.kind === 'task' && item.task.id === ordinaryTask.id)).toHaveLength(1)

    expect(week.timedSegments.map((segment) => segment.date)).toEqual([
      '2026-07-17',
      '2026-07-18',
    ])
    const july18 = month.days.find((day) => day.date === '2026-07-18')
    expect(july18?.items[0]).toMatchObject({ kind: 'session', sessionId: crossMidnight.id })
    expect(july18?.items.at(-1)).toMatchObject({ kind: 'task', task: { id: ordinaryTask.id } })
  })
})

describe('PreviewRepository and bootstrap wiring', () => {
  it('buffers transaction writes, rejects transaction reads, and rolls back failures', async () => {
    const repo = repository()
    await expect(repo.transaction(async (transaction) => {
      await transaction.saveTask({ ...ordinaryTask, name: '不会提交' })
      await transaction.getTask(ordinaryTask.id)
    })).rejects.toThrow('transactions are write-only')
    expect(await repo.getTask(ordinaryTask.id)).toEqual(ordinaryTask)
  })

  it('wires one repository into task, timer, and schedule services', async () => {
    const repo = repository()
    const desktopPort = new PreviewDesktopPort()

    const runtime = createApplicationRuntime(repo, desktopPort)

    expect(runtime.repository).toBe(repo)
    expect(runtime.desktopPort).toBe(desktopPort)
    expect(runtime.taskService).toBeInstanceOf(TaskService)
    expect(runtime.timerService).toBeInstanceOf(TimerService)
    expect(runtime.scheduleService).toBeInstanceOf(ScheduleService)
  })

  it('matches occurrence composite upserts and immediate foreign-key ordering', async () => {
    const repo = repository()
    const occurrence: TaskOccurrence = {
      id: 'original-occurrence-id',
      taskId: ordinaryTask.id,
      periodKey: 'daily:task-ordinary:2026-07-18',
      plannedDate: '2026-07-18',
      boundDate: null,
      state: 'pending',
      completedAt: null,
    }
    await repo.upsertOccurrences([occurrence])
    await repo.upsertOccurrences([{
      ...occurrence,
      id: 'conflicting-id',
      state: 'completed',
      completedAt: now.toISOString(),
    }])
    expect(await repo.listOccurrencesForTask(ordinaryTask.id)).toMatchObject([{
      id: occurrence.id,
      state: 'completed',
    }])

    const missingOccurrenceSession: FocusSession = {
      id: 'missing-occurrence-session',
      taskId: ordinaryTask.id,
      occurrenceId: 'missing-occurrence',
      startedAt: '2026-07-18T00:00:00.000Z',
      endedAt: '2026-07-18T00:30:00.000Z',
      source: 'completion_form',
    }
    await expect(repo.transaction(async (transaction) => {
      await transaction.saveFocusSession(missingOccurrenceSession)
      await transaction.upsertOccurrences([{
        ...occurrence,
        id: 'missing-occurrence',
        periodKey: 'daily:task-ordinary:2026-07-19',
        plannedDate: '2026-07-19',
      }])
    })).rejects.toThrow('occurrence')
  })

  it('enforces key task, occurrence, and focus-session foreign keys', async () => {
    const repo = repository()
    await expect(repo.saveTask({ ...ordinaryTask, id: 'orphan-task', goalId: 'missing-goal' }))
      .rejects.toThrow('goal')
    await expect(repo.upsertOccurrences([{
      id: 'orphan-occurrence',
      taskId: 'missing-task',
      periodKey: 'daily:missing-task:2026-07-18',
      plannedDate: '2026-07-18',
      boundDate: null,
      state: 'pending',
      completedAt: null,
    }])).rejects.toThrow('task')
    await expect(repo.saveFocusSession({
      id: 'orphan-session',
      taskId: 'missing-task',
      occurrenceId: null,
      startedAt: '2026-07-18T00:00:00.000Z',
      endedAt: '2026-07-18T00:30:00.000Z',
      source: 'timer',
    })).rejects.toThrow('task')
  })
})

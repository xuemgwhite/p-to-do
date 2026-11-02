import { describe, expect, it } from 'vitest'
import type { Task, TaskOccurrence } from '../../src/domain/models'
import {
  bindWeeklyOccurrence,
  occurrencesForRange,
  weeklyQuotaProgress,
} from '../../src/domain/recurrence'

const dailyTask: Task = {
  id: 'daily-task',
  goalId: 'goal-1',
  name: 'Daily task',
  description: '',
  startDate: '2026-07-18',
  endDate: '2026-07-20',
  recurrenceType: 'daily',
  weeklyQuota: null,
  completedAt: null,
  sortOrder: 0,
}

function weeklyTask(weeklyQuota: number): Task {
  return {
    ...dailyTask,
    id: 'weekly-task',
    startDate: '2026-07-13',
    endDate: '2026-07-26',
    recurrenceType: 'weekly_quota',
    weeklyQuota,
  }
}

describe('recurrence', () => {
  it('generates one idempotent daily occurrence per date', () => {
    const first = occurrencesForRange(dailyTask, [], '2026-07-18', '2026-07-20', '2026-07-18')
    const second = occurrencesForRange(dailyTask, first, '2026-07-18', '2026-07-20', '2026-07-18')

    expect(first).toHaveLength(3)
    expect(second).toHaveLength(3)
    expect(first.map((item) => item.periodKey)).toEqual([
      'daily:daily-task:2026-07-18',
      'daily:daily-task:2026-07-19',
      'daily:daily-task:2026-07-20',
    ])
    expect(first.map((item) => item.plannedDate)).toEqual([
      '2026-07-18',
      '2026-07-19',
      '2026-07-20',
    ])
  })

  it('does not generate daily occurrences on excluded weekdays', () => {
    const task: Task = {
      ...dailyTask,
      startDate: '2026-07-20',
      endDate: '2026-07-26',
      excludedWeekdays: [0, 6],
    }

    const items = occurrencesForRange(task, [], '2026-07-20', '2026-07-26', '2026-07-20')

    expect(items.map((item) => item.plannedDate)).toEqual([
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
      '2026-07-23',
      '2026-07-24',
    ])
  })

  it('keeps a completed occurrence when its weekday is later excluded', () => {
    const original = occurrencesForRange(
      { ...dailyTask, startDate: '2026-07-20', endDate: '2026-07-26' },
      [],
      '2026-07-20',
      '2026-07-26',
      '2026-07-20',
    )
    const saturday = original.find((item) => item.plannedDate === '2026-07-25')!
    const completedSaturday: TaskOccurrence = {
      ...saturday,
      state: 'completed',
      completedAt: '2026-07-25T10:00:00+08:00',
    }

    const items = occurrencesForRange(
      { ...dailyTask, startDate: '2026-07-20', endDate: '2026-07-26', excludedWeekdays: [6] },
      [...original.filter((item) => item !== saturday), completedSaturday],
      '2026-07-20',
      '2026-07-26',
      '2026-07-20',
    )

    expect(items.find((item) => item.plannedDate === '2026-07-25')).toEqual(completedSaturday)
  })

  it('generates three undated occurrences for a weekly quota of three', () => {
    const items = occurrencesForRange(weeklyTask(3), [], '2026-07-13', '2026-07-19', '2026-07-13')

    expect(items).toHaveLength(3)
    expect(items.every((item) => item.boundDate === null)).toBe(true)
    expect(items.map((item) => item.periodKey)).toEqual([
      'weekly:weekly-task:2026-W29:0',
      'weekly:weekly-task:2026-W29:1',
      'weekly:weekly-task:2026-W29:2',
    ])
  })

  it('binds one available weekly occurrence to today', () => {
    const items = occurrencesForRange(weeklyTask(3), [], '2026-07-13', '2026-07-19', '2026-07-13')

    const bound = bindWeeklyOccurrence(items, '2026-07-18')

    expect(bound.boundDate).toBe('2026-07-18')
  })

  it('binds an available occurrence from the ISO week containing the requested date', () => {
    const currentWeek = occurrencesForRange(weeklyTask(1), [], '2026-07-13', '2026-07-19', '2026-07-13')
    const followingWeek = occurrencesForRange(weeklyTask(1), [], '2026-07-20', '2026-07-26', '2026-07-20')

    const bound = bindWeeklyOccurrence([...followingWeek, ...currentWeek], '2026-07-18')

    expect(bound.periodKey).toBe('weekly:weekly-task:2026-W29:0')
    expect(bound.boundDate).toBe('2026-07-18')
  })

  it('removes only unbound pending surplus weekly slots when the quota decreases', () => {
    const items = occurrencesForRange(weeklyTask(3), [], '2026-07-13', '2026-07-19', '2026-07-13')
    const completed: TaskOccurrence = {
      ...items[2],
      state: 'completed',
      completedAt: '2026-07-18T10:00:00+08:00',
    }
    const boundPending: TaskOccurrence = {
      ...items[0],
      boundDate: '2026-07-18',
    }

    const adjusted = occurrencesForRange(weeklyTask(1), [boundPending, items[1], completed], '2026-07-13', '2026-07-19', '2026-07-13')

    expect(adjusted).toEqual([boundPending, completed])
  })

  it('preserves historical weekly slots after a quota decrease', () => {
    const historicalItems = occurrencesForRange(weeklyTask(3), [], '2026-07-13', '2026-07-19', '2026-07-13')

    const afterEdit = occurrencesForRange(
      weeklyTask(1),
      historicalItems,
      '2026-07-13',
      '2026-07-19',
      '2026-07-20',
    )

    expect(afterEdit).toEqual(historicalItems)
  })

  it('keeps historical daily occurrences visible after the date range and completion time change', () => {
    const originalTask: Task = {
      ...dailyTask,
      startDate: '2026-07-13',
      endDate: '2026-07-19',
    }
    const historicalItems = occurrencesForRange(originalTask, [], '2026-07-13', '2026-07-16', '2026-07-13')
    const shortenedTask: Task = {
      ...originalTask,
      startDate: '2026-07-17',
      endDate: '2026-07-18',
      completedAt: '2026-07-18T10:00:00+08:00',
    }

    const afterEdit = occurrencesForRange(
      shortenedTask,
      historicalItems,
      '2026-07-13',
      '2026-07-16',
      '2026-07-17',
    )

    expect(afterEdit).toEqual(historicalItems)
  })

  it('uses the local completion date for an offset timestamp that crosses midnight', () => {
    const completedTask: Task = {
      ...dailyTask,
      completedAt: '2026-07-18T16:30:00.000Z',
    }

    const items = occurrencesForRange(completedTask, [], '2026-07-18', '2026-07-20', '2026-07-18')

    expect(items.map((item) => item.plannedDate)).toEqual(['2026-07-18', '2026-07-19'])
  })

  it('reconciles the effective week to an increased quota idempotently', () => {
    const oneSlot = occurrencesForRange(weeklyTask(1), [], '2026-07-13', '2026-07-19', '2026-07-13')

    const increased = occurrencesForRange(
      weeklyTask(3),
      oneSlot,
      '2026-07-13',
      '2026-07-19',
      '2026-07-18',
    )
    const repeated = occurrencesForRange(
      weeklyTask(3),
      increased,
      '2026-07-13',
      '2026-07-19',
      '2026-07-18',
    )

    expect(increased.map((item) => item.periodKey)).toEqual([
      'weekly:weekly-task:2026-W29:0',
      'weekly:weekly-task:2026-W29:1',
      'weekly:weekly-task:2026-W29:2',
    ])
    expect(repeated).toEqual(increased)
  })

  it('reports quota progress including overage', () => {
    const items = occurrencesForRange(weeklyTask(3), [], '2026-07-13', '2026-07-19', '2026-07-13').map((item) => ({
      ...item,
      state: 'completed' as const,
      completedAt: '2026-07-18T10:00:00+08:00',
    }))

    expect(weeklyQuotaProgress(items, 2)).toEqual({
      completed: 3,
      quota: 2,
      remaining: 0,
      overage: 1,
    })
  })
})

import { describe, expect, it } from 'vitest'
import { deriveTaskStatus, summarizeDay, validateFocusInterval } from '../../src/domain/focus'
import type { FocusSession, Task } from '../../src/domain/models'

const start = new Date('2026-07-18T10:00:00+08:00')
const end = new Date('2026-07-18T10:30:00+08:00')
const now = new Date('2026-07-18T12:00:00+08:00')

function session(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'session-1',
    taskId: 'task-1',
    occurrenceId: null,
    startedAt: '2026-07-18T09:45:00+08:00',
    endedAt: '2026-07-18T10:15:00+08:00',
    source: 'timer',
    ...overrides,
  }
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    goalId: 'goal-1',
    name: 'Write focus tests',
    description: '',
    startDate: '2026-07-18',
    endDate: '2026-07-18',
    recurrenceType: 'none',
    weeklyQuota: null,
    completedAt: null,
    sortOrder: 0,
    ...overrides,
  }
}

describe('focus', () => {
  it('rejects zero length, future, and overlapping sessions while allowing adjacent half-open intervals', () => {
    const overlapping = session()

    expect(() => validateFocusInterval(start, start, [], { now })).toThrow('结束时间必须晚于开始时间')
    expect(() => validateFocusInterval(start, new Date('2026-07-18T12:01:00+08:00'), [], { now })).toThrow('结束时间不能晚于当前时间')
    expect(() => validateFocusInterval(start, end, [overlapping], { now })).toThrow('专注记录不能重叠')
    expect(() => validateFocusInterval(new Date('2026-07-18T10:15:00+08:00'), end, [overlapping], { now })).not.toThrow()
  })

  it('excludes the edited session from overlap validation', () => {
    const saved = session({ id: 'edited-session' })

    expect(() => validateFocusInterval(start, end, [saved], { now, excludeSessionId: saved.id })).not.toThrow()
  })

  it('derives focusing from an active session before completed and saved-session states', () => {
    expect(deriveTaskStatus(task({ completedAt: '2026-07-18T10:00:00+08:00' }), [session({ endedAt: null })])).toBe('focusing')
    expect(deriveTaskStatus(task({ completedAt: '2026-07-18T10:00:00+08:00' }), [session()])).toBe('completed')
    expect(deriveTaskStatus(task(), [session()])).toBe('in_progress')
    expect(deriveTaskStatus(task(), [])).toBe('pending')
  })

  it('counts a cross-midnight session once on its start day while splitting duration by day', () => {
    const crossMidnight = session({
      startedAt: '2026-07-18T23:30:00+08:00',
      endedAt: '2026-07-19T00:30:00+08:00',
    })

    expect(summarizeDay('2026-07-18', [crossMidnight])).toEqual({ count: 1, durationMs: 1_800_000 })
    expect(summarizeDay('2026-07-19', [crossMidnight])).toEqual({ count: 0, durationMs: 1_800_000 })
  })

  it('includes active-session time up to the supplied current time', () => {
    const active = session({
      startedAt: '2026-07-18T11:30:00+08:00',
      endedAt: null,
    })

    expect(summarizeDay('2026-07-18', [active], now)).toEqual({ count: 1, durationMs: 1_800_000 })
  })
})

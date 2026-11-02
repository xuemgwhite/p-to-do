import { describe, expect, it } from 'vitest'
import { assertDateRange, splitIntervalByLocalDay } from '../../src/domain/dates'

describe('dates', () => {
  it('rejects a start date after the end date', () => {
    expect(() => assertDateRange('2026-07-19', '2026-07-18')).toThrow('开始日期不能晚于结束日期')
  })

  it('splits a cross-midnight interval without duplicating the session', () => {
    const parts = splitIntervalByLocalDay(
      new Date('2026-07-18T23:30:00+08:00'),
      new Date('2026-07-19T00:30:00+08:00'),
    )

    expect(parts.map((part) => part.durationMs)).toEqual([1_800_000, 1_800_000])
  })
})

import { describe, expect, it } from 'vitest'
import { StatisticsService } from '../../src/application/StatisticsService'
import type { PreviewRepositorySeed } from '../../src/infrastructure/preview/PreviewRepository'
import { PreviewRepository } from '../../src/infrastructure/preview/PreviewRepository'

const seed: PreviewRepositorySeed = {
  themes: [
    { id: 'theme-work', name: '工作', color: '#4A78F5', sortOrder: 0 },
    { id: 'theme-life', name: '生活', color: '#F39B36', sortOrder: 1 },
  ],
  goals: [
    { id: 'goal-work', themeId: 'theme-work', name: '交付', sortOrder: 0 },
    { id: 'goal-life', themeId: 'theme-life', name: '健康', sortOrder: 0 },
  ],
  tasks: [
    {
      id: 'task-current', goalId: 'goal-work', name: '当前完成', description: '',
      startDate: '2026-07-20', endDate: '2026-07-20', recurrenceType: 'none',
      weeklyQuota: null, completedAt: '2026-07-20T03:00:00.000Z', sortOrder: 0,
    },
    {
      id: 'task-previous', goalId: 'goal-work', name: '上周完成', description: '',
      startDate: '2026-07-13', endDate: '2026-07-13', recurrenceType: 'none',
      weeklyQuota: null, completedAt: '2026-07-13T03:00:00.000Z', sortOrder: 1,
    },
    {
      id: 'task-repeat', goalId: 'goal-life', name: '锻炼', description: '',
      startDate: '2026-07-01', endDate: '2026-07-31', recurrenceType: 'daily',
      weeklyQuota: null, completedAt: null, sortOrder: 0,
    },
  ],
  occurrences: [
    {
      id: 'occurrence-current', taskId: 'task-repeat', periodKey: '2026-07-21',
      plannedDate: '2026-07-21', boundDate: null, state: 'completed',
      completedAt: '2026-07-21T04:00:00.000Z',
    },
    {
      id: 'occurrence-previous', taskId: 'task-repeat', periodKey: '2026-07-14',
      plannedDate: '2026-07-14', boundDate: null, state: 'completed',
      completedAt: '2026-07-14T04:00:00.000Z',
    },
  ],
  focusSessions: [
    {
      id: 'session-current-work', taskId: 'task-current', occurrenceId: null,
      startedAt: '2026-07-20T01:00:00.000Z', endedAt: '2026-07-20T02:00:00.000Z', source: 'timer',
    },
    {
      id: 'session-current-life', taskId: 'task-repeat', occurrenceId: 'occurrence-current',
      startedAt: '2026-07-21T01:00:00.000Z', endedAt: '2026-07-21T01:30:00.000Z', source: 'timer',
    },
    {
      id: 'session-previous', taskId: 'task-previous', occurrenceId: null,
      startedAt: '2026-07-13T01:00:00.000Z', endedAt: '2026-07-13T03:00:00.000Z', source: 'timer',
    },
  ],
}

describe('StatisticsService', () => {
  it('aggregates a single day against the previous day with hourly trend points', async () => {
    const snapshot = await new StatisticsService(new PreviewRepository(seed))
      .getSnapshot('day', new Date('2026-07-21T12:00:00+08:00'))

    expect(snapshot).toMatchObject({
      period: 'day',
      comparisonLabel: '较前一日',
      from: '2026-07-21',
      to: '2026-07-21',
      totalFocusMs: 30 * 60_000,
      previousFocusMs: 60 * 60_000,
      completedTasks: 1,
      previousCompletedTasks: 1,
      averageFocusMs: 30 * 60_000 / 24,
    })
    expect(snapshot.trend).toHaveLength(24)
    expect(snapshot.trend[9]).toMatchObject({ label: '9时', durationMs: 30 * 60_000 })
  })

  it('aggregates current and previous week focus, completions, heatmap, themes, and daily trend', async () => {
    const snapshot = await new StatisticsService(new PreviewRepository(seed))
      .getSnapshot('week', new Date('2026-07-23T12:00:00+08:00'))

    expect(snapshot).toMatchObject({
      period: 'week',
      comparisonLabel: '较上周',
      from: '2026-07-20',
      to: '2026-07-26',
      totalFocusMs: 90 * 60_000,
      previousFocusMs: 120 * 60_000,
      completedTasks: 2,
      previousCompletedTasks: 2,
      averageFocusMs: 90 * 60_000 / 7,
    })
    expect(snapshot.heatmap).toHaveLength(9)
    expect(snapshot.heatmap[0]?.date).toBe('2026-07-15')
    expect(snapshot.heatmap.find((day) => day.date === '2026-07-20')).toMatchObject({
      durationMs: 60 * 60_000,
      intensity: 5,
    })
    expect(snapshot.themes).toEqual([
      { themeId: 'theme-work', name: '工作', color: '#4A78F5', durationMs: 60 * 60_000 },
      { themeId: 'theme-life', name: '生活', color: '#F39B36', durationMs: 30 * 60_000 },
    ])
    expect(snapshot.trend).toHaveLength(7)
    expect(snapshot.trend.map((point) => point.label)).toEqual(['周一', '周二', '周三', '周四', '周五', '周六', '周日'])
    expect(snapshot.trend.find((point) => point.key === '2026-07-21')?.durationMs).toBe(30 * 60_000)
  })

  it('uses weekly buckets for a month and monthly buckets for a year', async () => {
    const service = new StatisticsService(new PreviewRepository(seed))
    const month = await service.getSnapshot('month', new Date('2026-07-23T12:00:00+08:00'))
    const year = await service.getSnapshot('year', new Date('2026-07-23T12:00:00+08:00'))

    expect(month.trend.map((point) => point.label)).toEqual(['第 1 周', '第 2 周', '第 3 周', '第 4 周', '第 5 周'])
    expect(month.heatmap).toHaveLength(9)
    expect(year.trend).toHaveLength(12)
    expect(year.trend[6]).toMatchObject({ label: '7月', durationMs: 210 * 60_000 })
    expect(year.heatmap).toHaveLength(9)
  })
})

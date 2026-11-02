import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScheduleService, type WeekSchedule } from '../../src/application/ScheduleService'
import { TaskService } from '../../src/application/TaskService'
import { TimerService } from '../../src/application/TimerService'
import type { PreviewRepositorySeed } from '../../src/infrastructure/preview/PreviewRepository'
import { PreviewRepository } from '../../src/infrastructure/preview/PreviewRepository'
import { SchedulePage } from '../../src/ui/schedule/SchedulePage'
import { WeekView } from '../../src/ui/schedule/WeekView'

const now = new Date('2026-07-18T12:00:00+08:00')

const seed: PreviewRepositorySeed = {
  themes: [
    { id: 'theme-product', name: '产品设计', color: '#A73E72', sortOrder: 0 },
    { id: 'theme-growth', name: '个人成长', color: '#D68647', sortOrder: 1 },
  ],
  goals: [
    { id: 'goal-release', themeId: 'theme-product', name: '发布版本', sortOrder: 0 },
    { id: 'goal-reading', themeId: 'theme-growth', name: '持续阅读', sortOrder: 0 },
  ],
  tasks: [
    {
      id: 'task-overdue', goalId: 'goal-release', name: '逾期但未完成', description: '结束日期之后仍应显示',
      startDate: '2026-07-01', endDate: '2026-07-10', recurrenceType: 'none', weeklyQuota: null,
      completedAt: null, sortOrder: 0,
    },
    {
      id: 'task-completed', goalId: 'goal-release', name: '当天已完成', description: '',
      startDate: '2026-07-01', endDate: '2026-07-31', recurrenceType: 'none', weeklyQuota: null,
      completedAt: '2026-07-17T02:00:00.000Z', sortOrder: 1,
    },
    {
      id: 'task-weekly', goalId: 'goal-reading', name: '每周阅读', description: '',
      startDate: '2026-07-01', endDate: '2026-07-31', recurrenceType: 'weekly_quota', weeklyQuota: 2,
      completedAt: null, sortOrder: 0,
    },
  ],
  occurrences: [],
  focusSessions: [
    {
      id: 'session-cross', taskId: 'task-overdue', occurrenceId: null,
      startedAt: '2026-07-17T15:30:00.000Z', endedAt: '2026-07-17T16:30:00.000Z', source: 'timer',
    },
    {
      id: 'session-morning', taskId: 'task-overdue', occurrenceId: null,
      startedAt: '2026-07-18T00:15:00.000Z', endedAt: '2026-07-18T00:45:00.000Z', source: 'timer',
    },
  ],
}

function setup(search = '?view=day&date=2026-07-17', customSeed: PreviewRepositorySeed = seed) {
  window.history.replaceState({}, '', `/${search}`)
  const repository = new PreviewRepository(customSeed)
  const scheduleService = new ScheduleService(repository)
  const taskService = new TaskService(repository, () => 'manual-session')
  const timerService = new TimerService(repository, () => 'timer-session')
  render(
    <SchedulePage
      repository={repository}
      scheduleService={scheduleService}
      taskService={taskService}
      timerService={timerService}
      now={() => now}
    />,
  )
  return { repository, scheduleService, taskService, timerService }
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

describe('SchedulePage day view', () => {
  it('collects a manual interval before completing a task without focus sessions', async () => {
    const { repository } = setup('?view=day&date=2026-07-18', { ...seed, focusSessions: [] })

    fireEvent.click(await screen.findByRole('checkbox', { name: '完成 逾期但未完成' }))
    const dialog = await screen.findByRole('dialog', { name: '完成任务' })
    fireEvent.change(within(dialog).getByLabelText('开始时刻'), { target: { value: '08:00' } })
    fireEvent.change(within(dialog).getByLabelText('完成时刻'), { target: { value: '08:30' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '确认完成' }))

    await waitFor(async () => expect((await repository.getTask('task-overdue'))?.completedAt).toBe(new Date('2026-07-18T08:30:00').toISOString()))
    expect(await repository.listFocusSessionsForTask('task-overdue')).toMatchObject([{ source: 'completion_form' }])
  })

  it('directly completes a weekly reminder by binding a slot today and collecting its interval', async () => {
    const { repository } = setup('?view=day&date=2026-07-18', { ...seed, focusSessions: [] })

    fireEvent.click(await screen.findByRole('checkbox', { name: '完成 每周阅读' }))
    const dialog = await screen.findByRole('dialog', { name: '完成任务' })
    fireEvent.change(within(dialog).getByLabelText('开始时刻'), { target: { value: '10:00' } })
    fireEvent.change(within(dialog).getByLabelText('完成时刻'), { target: { value: '10:30' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '确认完成' }))

    await waitFor(async () => expect(await repository.listOccurrencesForTask('task-weekly')).toMatchObject([
      { boundDate: '2026-07-18', state: 'completed' },
    ]))
    const occurrence = (await repository.listOccurrencesForTask('task-weekly')).find((item) => item.state === 'completed')
    expect(await repository.listFocusSessionsForTask('task-weekly')).toMatchObject([{ occurrenceId: occurrence?.id, source: 'completion_form' }])
  })

  it('keeps the selected date in search state, separates completion, and puts the weekly reminder last', async () => {
    setup()

    const pending = await screen.findByRole('region', { name: '待办' })
    expect(pending).not.toHaveTextContent('逾期但未完成')
    expect(screen.getByRole('region', { name: '已完成' })).toHaveTextContent('当天已完成')
    const rows = within(pending).getAllByTestId(/^(schedule-task|weekly-reminder)-/)
    expect(rows.at(-1)).toHaveAttribute('data-testid', 'weekly-reminder-task-weekly')

    fireEvent.click(screen.getByRole('button', { name: '后一天' }))
    expect(await screen.findByRole('heading', { name: /7月18日/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '待办' })).toHaveTextContent('逾期但未完成')
    expect(screen.queryByText('今天', { selector: '.schedule-heading-kicker' })).not.toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('date')).toBe('2026-07-18')
  })

  it('allows starting only on the system-local current day', async () => {
    const { repository } = setup('?view=day&date=2026-07-18')

    fireEvent.click(await screen.findByRole('button', { name: '开始 逾期但未完成' }))

    await waitFor(async () => expect((await repository.getActiveFocusSession())?.taskId).toBe('task-overdue'))
  })

  it('restores completed work through TaskService', async () => {
    const { taskService } = setup()
    const restore = vi.spyOn(taskService, 'restoreTask')

    fireEvent.click(await screen.findByRole('checkbox', { name: '恢复 当天已完成' }))

    await waitFor(() => expect(restore).toHaveBeenCalledWith({ taskId: 'task-completed', occurrenceId: null }))
  })
})

describe('SchedulePage week view', () => {
  it('keeps planned work above the 24-hour time grid and splits a cross-midnight record', async () => {
    setup('?view=week&date=2026-07-18')

    const planned = await screen.findByRole('region', { name: '周计划' })
    const timeline = screen.getByRole('region', { name: '24 小时时间轴' })
    expect(planned).toHaveTextContent('逾期但未完成')
    expect(within(planned).queryByTestId(/session-segment-/)).not.toBeInTheDocument()
    expect(within(timeline).getAllByTestId(/session-segment-session-cross-/)).toHaveLength(2)
    expect(within(timeline).getByText('00:00')).toBeInTheDocument()
    expect(within(timeline).getByText('23:00')).toBeInTheDocument()
  })

  it('lays overlapping visual segments side by side defensively', () => {
    const shared = {
      kind: 'session' as const,
      taskId: 'task-overdue', occurrenceId: null, task: seed.tasks[0]!, goal: seed.goals[0]!, theme: seed.themes[0]!,
      date: '2026-07-18' as const, sourceStartedAt: '2026-07-18T01:00:00.000Z', sourceEndedAt: '2026-07-18T02:00:00.000Z',
    }
    const schedule: WeekSchedule = {
      from: '2026-07-13', to: '2026-07-19', unboundWeeklyQuota: [],
      days: Array.from({ length: 7 }, (_, index) => ({ date: `2026-07-${13 + index}` as const, allDay: [], completed: [] })),
      timedSegments: [
        { ...shared, id: 'a', sessionId: 'a', startedAt: '2026-07-18T01:00:00.000Z', endedAt: '2026-07-18T02:00:00.000Z' },
        { ...shared, id: 'b', sessionId: 'b', startedAt: '2026-07-18T01:30:00.000Z', endedAt: '2026-07-18T02:30:00.000Z' },
      ],
    }

    render(<WeekView schedule={schedule} today="2026-07-18" onOpenSession={() => undefined} />)

    expect(screen.getByTestId('session-segment-a')).toHaveStyle({ width: '50%' })
    expect(screen.getByTestId('session-segment-b')).toHaveStyle({ width: '50%', left: '50%' })
  })

  it('hides a session time when the timeline block is too short to show it fully', () => {
    const segment = {
      kind: 'session' as const,
      id: 'short', sessionId: 'short', taskId: 'task-overdue', occurrenceId: null,
      task: seed.tasks[0]!, goal: seed.goals[0]!, theme: seed.themes[0]!, date: '2026-07-18' as const,
      startedAt: '2026-07-18T01:00:00.000Z', endedAt: '2026-07-18T01:15:00.000Z',
      sourceStartedAt: '2026-07-18T01:00:00.000Z', sourceEndedAt: '2026-07-18T01:15:00.000Z',
    }
    const schedule: WeekSchedule = {
      from: '2026-07-13', to: '2026-07-19', unboundWeeklyQuota: [], timedSegments: [segment],
      days: Array.from({ length: 7 }, (_, index) => ({ date: `2026-07-${13 + index}` as const, allDay: [], completed: [] })),
    }

    render(<WeekView schedule={schedule} today="2026-07-18" onOpenSession={() => undefined} />)

    const block = screen.getByTestId('session-segment-short')
    expect(block).toHaveTextContent('逾期但未完成')
    expect(within(block).queryByText('09:00–09:15')).not.toBeInTheDocument()
  })
})

describe('SchedulePage month view and record dialog', () => {
  it('shows only the earliest focus time for each task and keeps unfinished untimed work last', async () => {
    setup('?view=month&date=2026-07-18')

    const cell = await screen.findByTestId('month-cell-2026-07-18')
    const items = within(cell).getAllByTestId(/^month-item-/)
    expect(items[0]).toHaveTextContent('00:00')
    expect(within(cell).queryByText('08:15')).not.toBeInTheDocument()
    expect(within(cell).getAllByTestId(/^month-item-session-/)).toHaveLength(1)
    expect(items.at(-1)).toHaveTextContent('逾期但未完成')
    expect(cell).toHaveClass('today')
  })

  it('validates, saves, and deletes a focus record, refreshing the visible summary after each change', async () => {
    const { repository, scheduleService, timerService } = setup('?view=month&date=2026-07-18', {
      ...seed,
      focusSessions: seed.focusSessions.filter((session) => session.id === 'session-morning'),
    })
    const getMonth = vi.spyOn(scheduleService, 'getMonth')
    const updateSession = vi.spyOn(timerService, 'updateSession')
    const deleteSession = vi.spyOn(timerService, 'deleteSession')

    fireEvent.click(await screen.findByRole('button', { name: /专注记录 逾期但未完成 08:15/ }))
    const dialog = screen.getByRole('dialog', { name: '编辑专注记录' })
    fireEvent.change(within(dialog).getByLabelText('开始时间'), { target: { value: '2026-07-18T08:20' } })
    fireEvent.change(within(dialog).getByLabelText('结束时间'), { target: { value: '2026-07-18T08:50' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存记录' }))

    await waitFor(async () => {
      expect((await repository.listFocusSessionsForTask('task-overdue')).find((item) => item.id === 'session-morning')?.startedAt)
        .toBe(new Date('2026-07-18T08:20:00').toISOString())
    })
    expect(updateSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-morning', taskId: 'task-overdue' }), now)
    expect(getMonth.mock.calls.length).toBeGreaterThanOrEqual(1)

    fireEvent.click(await screen.findByRole('button', { name: /专注记录 逾期但未完成 08:20/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '编辑专注记录' })).getByRole('button', { name: '删除记录' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除记录' }))

    await waitFor(async () => expect((await repository.listFocusSessionsForTask('task-overdue')).some((item) => item.id === 'session-morning')).toBe(false))
    expect(deleteSession).toHaveBeenCalledWith('session-morning')
    expect(getMonth.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

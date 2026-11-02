import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScheduleService } from '../../src/application/ScheduleService'
import { TimerService } from '../../src/application/TimerService'
import type { PreviewRepositorySeed } from '../../src/infrastructure/preview/PreviewRepository'
import { PreviewRepository } from '../../src/infrastructure/preview/PreviewRepository'
import { RecoveryDialog } from '../../src/ui/timer/RecoveryDialog'
import { TimerPage } from '../../src/ui/timer/TimerPage'

const now = new Date('2026-07-18T12:00:00+08:00')

const seed: PreviewRepositorySeed = {
  themes: [{ id: 'theme', name: '专注', color: '#A73E72', sortOrder: 0 }],
  goals: [{ id: 'goal', themeId: 'theme', name: '今天', sortOrder: 0 }],
  tasks: [
    {
      id: 'task-today', goalId: 'goal', name: '今天的任务', description: '',
      startDate: '2026-07-18', endDate: '2026-07-18', recurrenceType: 'none', weeklyQuota: null,
      completedAt: null, sortOrder: 0,
    },
    {
      id: 'task-switch', goalId: 'goal', name: '切换后的任务', description: '',
      startDate: '2026-07-18', endDate: '2026-07-18', recurrenceType: 'none', weeklyQuota: null,
      completedAt: null, sortOrder: 1,
    },
    {
      id: 'task-future', goalId: 'goal', name: '明天的任务', description: '',
      startDate: '2026-07-19', endDate: '2026-07-19', recurrenceType: 'none', weeklyQuota: null,
      completedAt: null, sortOrder: 2,
    },
  ],
  occurrences: [],
  focusSessions: [{
    id: 'completed', taskId: 'task-today', occurrenceId: null,
    startedAt: '2026-07-18T01:00:00.000Z', endedAt: '2026-07-18T01:30:00.000Z', source: 'timer',
  }],
}

function setup(customSeed: PreviewRepositorySeed = seed) {
  const repository = new PreviewRepository(customSeed)
  let sessionNumber = 0
  const timerService = new TimerService(repository, () => `active-session-${++sessionNumber}`)
  const scheduleService = new ScheduleService(repository)
  render(<TimerPage timerService={timerService} scheduleService={scheduleService} now={() => new Date()} />)
  return { repository, timerService }
}

async function settle() {
  await act(async () => {})
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TimerPage', () => {
  it('derives elapsed display from Date.now and uses one start/end button', async () => {
    setup()

    await settle()
    expect(screen.getByRole('region', { name: '计时控制' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '今日专注记录' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '选择计时任务' })).toHaveDisplayValue('今天的任务')
    expect(screen.queryByText('今天的专注')).not.toBeInTheDocument()
    expect(screen.queryByText('明天的任务')).not.toBeInTheDocument()
    expect(screen.getAllByText('30 分钟')).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: '开始计时' })).toHaveClass('timer-primary-control')
    expect(screen.getByTestId('elapsed-time')).toHaveClass('timer-digits')
    expect(screen.getByText('已结束')).toBeInTheDocument()
    expect(screen.getByText('09:00')).toBeInTheDocument()
    expect(screen.getByText('09:30')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '开始计时' }))
    await settle()
    screen.getByRole('button', { name: '结束计时' })
    expect(screen.getByText('专注中')).toBeInTheDocument()
    expect(screen.getByTestId('elapsed-time')).toHaveTextContent('00:00')

    await act(async () => {
      vi.setSystemTime(new Date('2026-07-18T12:01:04+08:00'))
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(screen.getByTestId('elapsed-time')).toHaveTextContent('01:05')
    expect(screen.getAllByRole('button', { name: /计时$/ })).toHaveLength(1)
  })

  it('automatically stops the current task when starting another today candidate', async () => {
    const { repository } = setup()

    await settle()
    expect(screen.getByRole('combobox', { name: '选择计时任务' })).toHaveDisplayValue('今天的任务')
    fireEvent.click(screen.getByRole('button', { name: '开始计时' }))
    await settle()
    screen.getByRole('button', { name: '结束计时' })
    vi.setSystemTime(new Date('2026-07-18T12:00:01+08:00'))
    fireEvent.change(screen.getByRole('combobox', { name: '选择计时任务' }), { target: { value: 'task:task-switch:2026-07-18' } })
    fireEvent.click(screen.getByRole('button', { name: '开始计时' }))

    await settle()
    expect((await repository.getActiveFocusSession())?.taskId).toBe('task-switch')
    expect((await repository.listFocusSessionsForTask('task-today')).find((session) => session.id === 'active-session-1')?.endedAt).toBe(new Date('2026-07-18T12:00:01+08:00').toISOString())
  })

  it('refreshes today count, total duration, and record cards immediately after ending', async () => {
    setup()

    await settle()
    expect(screen.getByRole('combobox', { name: '选择计时任务' })).toHaveDisplayValue('今天的任务')
    fireEvent.click(screen.getByRole('button', { name: '开始计时' }))
    await settle()
    screen.getByRole('button', { name: '结束计时' })
    vi.setSystemTime(new Date('2026-07-18T12:30:00+08:00'))
    fireEvent.click(screen.getByRole('button', { name: '结束计时' }))

    await settle()
    expect(within(screen.getByRole('region', { name: '今日概览' })).getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1 小时')).toBeInTheDocument()
    expect(screen.getAllByTestId('focus-record')).toHaveLength(2)
    expect(screen.getAllByTestId('focus-record')[0]).toHaveTextContent('12:00')
  })

  it('keeps the original task name in records after the task is completed', async () => {
    setup({
      ...seed,
      tasks: seed.tasks.map((task) => task.id === 'task-today' ? { ...task, completedAt: now.toISOString() } : task),
    })

    await settle()
    expect(screen.getByTestId('focus-record')).toHaveTextContent('今天的任务')
    expect(screen.queryByText('专注任务')).not.toBeInTheDocument()
  })
})

describe('RecoveryDialog', () => {
  function renderRecovery() {
    const repository = new PreviewRepository({
      ...seed,
      focusSessions: [{
        id: 'crashed', taskId: 'task-today', occurrenceId: null,
        startedAt: '2026-07-18T01:00:00.000Z', endedAt: null, source: 'timer',
      }],
    })
    const onRecovered = vi.fn(async () => undefined)
    render(<RecoveryDialog activeSession={{
      id: 'crashed', taskId: 'task-today', occurrenceId: null,
      startedAt: '2026-07-18T01:00:00.000Z', endedAt: null, source: 'timer',
    }} timerService={new TimerService(repository)} now={() => new Date()} onRecovered={onRecovered} />)
    return { repository, onRecovered }
  }

  it('cannot be dismissed with Escape or its backdrop', () => {
    renderRecovery()
    const dialog = screen.getByRole('dialog', { name: '恢复未结束的计时' })

    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(dialog.parentElement!)

    expect(screen.getByRole('dialog', { name: '恢复未结束的计时' })).toBeInTheDocument()
  })

  it('recovers by ending now, ending at a valid manual time, or discarding', async () => {
    const nowResult = renderRecovery()
    fireEvent.click(screen.getByRole('button', { name: '现在结束' }))
    await settle()
    expect(await nowResult.repository.getActiveFocusSession()).toBeNull()
    expect((await nowResult.repository.listFocusSessionsForTask('task-today'))[0]?.endedAt).toBe(now.toISOString())

    const manualResult = renderRecovery()
    const manualDialog = screen.getByRole('dialog', { name: '恢复未结束的计时' })
    fireEvent.click(within(manualDialog).getByRole('button', { name: '手动设置结束时间' }))
    fireEvent.change(within(manualDialog).getByLabelText('结束时间'), { target: { value: '2026-07-18T11:30' } })
    fireEvent.click(within(manualDialog).getByRole('button', { name: '确认结束' }))
    await settle()
    expect(await manualResult.repository.getActiveFocusSession()).toBeNull()

    const discardResult = renderRecovery()
    fireEvent.click(screen.getByRole('button', { name: '放弃本次记录' }))
    await settle()
    expect(await discardResult.repository.listFocusSessionsForTask('task-today')).toEqual([])
  })

  it('rejects an invalid manual end time before recovering', async () => {
    const { repository } = renderRecovery()
    const dialog = screen.getByRole('dialog', { name: '恢复未结束的计时' })
    fireEvent.click(within(dialog).getByRole('button', { name: '手动设置结束时间' }))
    fireEvent.change(within(dialog).getByLabelText('结束时间'), { target: { value: '2026-07-18T08:30' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '确认结束' }))

    await settle()
    expect(screen.getByRole('alert')).toHaveTextContent('专注时间范围无效')
    expect((await repository.getActiveFocusSession())?.id).toBe('crashed')
  })
})

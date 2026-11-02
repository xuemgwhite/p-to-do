import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScheduleService } from '../../src/application/ScheduleService'
import { TaskService } from '../../src/application/TaskService'
import { TimerService } from '../../src/application/TimerService'
import type { PreviewRepositorySeed } from '../../src/infrastructure/preview/PreviewRepository'
import { PreviewRepository } from '../../src/infrastructure/preview/PreviewRepository'
import { QuickTasksWindow } from '../../src/ui/quick-tasks/QuickTasksWindow'

const now = new Date('2026-07-18T12:00:00+08:00')

const seed: PreviewRepositorySeed = {
  themes: [
    { id: 'work', name: '工作', color: '#A73E72', sortOrder: 0 },
    { id: 'life', name: '生活', color: '#D68647', sortOrder: 1 },
  ],
  goals: [
    { id: 'work-goal', themeId: 'work', name: '交付', sortOrder: 0 },
    { id: 'life-goal', themeId: 'life', name: '日常', sortOrder: 0 },
  ],
  tasks: [
    { id: 'report', goalId: 'work-goal', name: '整理周报', description: '', startDate: '2026-07-18', endDate: '2026-07-18', recurrenceType: 'none', weeklyQuota: null, completedAt: null, sortOrder: 0 },
    { id: 'shopping', goalId: 'life-goal', name: '采购食材', description: '', startDate: '2026-07-18', endDate: '2026-07-18', recurrenceType: 'none', weeklyQuota: null, completedAt: null, sortOrder: 0 },
    { id: 'done', goalId: 'work-goal', name: '回复邮件', description: '', startDate: '2026-07-18', endDate: '2026-07-18', recurrenceType: 'none', weeklyQuota: null, completedAt: '2026-07-18T02:00:00.000Z', sortOrder: 1 },
    { id: 'unscheduled', goalId: 'life-goal', name: '以后再做', description: '', startDate: '' as const, endDate: '' as const, recurrenceType: 'none', weeklyQuota: null, completedAt: null, sortOrder: 1 },
  ],
  occurrences: [],
  focusSessions: [{
    id: 'morning-focus', taskId: 'report', occurrenceId: null,
    startedAt: '2026-07-18T01:00:00.000Z', endedAt: '2026-07-18T01:30:00.000Z', source: 'timer',
  }],
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
})

afterEach(() => {
  vi.useRealTimers()
  document.documentElement.classList.remove('quick-tasks-document')
})

async function settle() {
  await act(async () => {})
}

describe('QuickTasksWindow', () => {
  it('shows today counts and groups pending tasks by theme', async () => {
    const repository = new PreviewRepository(seed)
    render(<QuickTasksWindow scheduleService={new ScheduleService(repository)} timerService={new TimerService(repository)} runtimeMode="preview" now={() => now} onExpandedChange={() => undefined} />)
    await settle()

    expect(screen.getByRole('button', { name: /还有 2 项未完成/ })).toHaveTextContent('2')
    fireEvent.click(screen.getByRole('button', { name: /打开今日任务/ }))
    await settle()

    expect(screen.getByRole('heading', { name: /2026年7月18日/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /工作/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /生活/ })).toBeInTheDocument()
    expect(screen.getByText('整理周报')).toBeInTheDocument()
    expect(screen.getByText('30分钟')).toBeInTheDocument()
    expect(screen.getByText('采购食材')).toBeInTheDocument()
    expect(screen.queryByText('以后再做')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /工作/ }))
    expect(screen.queryByText('整理周报')).not.toBeInTheDocument()
  })

  it('opens the selected task from its start button and exposes completed tasks', async () => {
    const onStartTask = vi.fn(async () => undefined)
    render(<QuickTasksWindow scheduleService={new ScheduleService(new PreviewRepository(seed))} runtimeMode="preview" now={() => now} onExpandedChange={() => undefined} onStartTask={onStartTask} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /打开今日任务/ }))
    await settle()

    const lifeGroup = screen.getByRole('button', { name: /生活/ }).closest('section')!
    fireEvent.click(within(lifeGroup).getByRole('button', { name: '开始 采购食材' }))
    await settle()
    expect(onStartTask).toHaveBeenCalledWith('shopping')

    fireEvent.click(screen.getByRole('button', { name: /已完成/ }))
    expect(screen.getByText('回复邮件')).toBeInTheDocument()
  })

  it('starts and stops a synchronized timer inside the floating window', async () => {
    const repository = new PreviewRepository(seed)
    const timerService = new TimerService(repository, () => 'quick-session')
    render(<QuickTasksWindow scheduleService={new ScheduleService(repository)} timerService={timerService} runtimeMode="preview" now={() => new Date()} onExpandedChange={() => undefined} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /打开今日任务/ }))
    await settle()

    fireEvent.click(screen.getByRole('button', { name: '开始 整理周报' }))
    await settle()
    expect((await repository.getActiveFocusSession())?.taskId).toBe('report')
    expect(screen.getByRole('region', { name: '当前计时' })).toHaveTextContent('整理周报')
    expect(screen.getByRole('region', { name: '当前计时' })).toHaveTextContent('00:00')
    expect(screen.getByRole('button', { name: '停止 整理周报' })).toBeInTheDocument()

    vi.setSystemTime(new Date('2026-07-18T12:01:00+08:00'))
    fireEvent.click(screen.getByRole('button', { name: '停止计时' }))
    await settle()
    expect(await repository.getActiveFocusSession()).toBeNull()
  })

  it('completes a task from its checkbox and adds a non-overlapping automatic session', async () => {
    const repository = new PreviewRepository(seed)
    render(<QuickTasksWindow scheduleService={new ScheduleService(repository)} taskService={new TaskService(repository, () => 'quick-completion')} timerService={new TimerService(repository)} runtimeMode="preview" now={() => now} onExpandedChange={() => undefined} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /打开今日任务/ }))
    await settle()

    fireEvent.click(screen.getByRole('button', { name: '完成 采购食材' }))
    await settle()

    expect((await repository.getTask('shopping'))?.completedAt).not.toBeNull()
    expect(await repository.listFocusSessionsForTask('shopping')).toMatchObject([{
      id: 'quick-completion',
      startedAt: new Date('2026-07-18T00:00:00').toISOString(),
      endedAt: new Date('2026-07-18T00:15:00').toISOString(),
    }])
  })
})

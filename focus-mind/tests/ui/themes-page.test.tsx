import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskService } from '../../src/application/TaskService'
import { TimerService } from '../../src/application/TimerService'
import type { PreviewRepositorySeed } from '../../src/infrastructure/preview/PreviewRepository'
import { PreviewRepository } from '../../src/infrastructure/preview/PreviewRepository'
import type { FocusSession } from '../../src/domain/models'
import { resetAppStore } from '../../src/state/useAppStore'
import { ThemesPage } from '../../src/ui/themes/ThemesPage'
import { isValidLocalDate } from '../../src/ui/shared/entityValidation'

const now = new Date('2026-07-18T09:00:00+08:00')
const seed: PreviewRepositorySeed = {
  themes: [
    { id: 'theme-1', name: '产品设计', color: '#A73E72', sortOrder: 0 },
    { id: 'theme-2', name: '个人成长', color: '#D68647', sortOrder: 1 },
  ],
  goals: [
    { id: 'goal-1', themeId: 'theme-1', name: '发布 macOS 版本', sortOrder: 0 },
    { id: 'goal-2', themeId: 'theme-1', name: '完善设计系统', sortOrder: 1 },
    { id: 'goal-3', themeId: 'theme-2', name: '阅读', sortOrder: 0 },
  ],
  tasks: [
    {
      id: 'task-1', goalId: 'goal-1', name: '完成产品原型', description: '完成核心功能原型设计',
      startDate: '2026-07-20', endDate: '2026-07-25', recurrenceType: 'none', weeklyQuota: null,
      completedAt: null, sortOrder: 0,
    },
    {
      id: 'task-2', goalId: 'goal-1', name: '菜单栏计时测试', description: '测试菜单栏显示效果',
      startDate: '2026-07-01', endDate: '2026-07-31', recurrenceType: 'none', weeklyQuota: null,
      completedAt: '2026-07-17T01:00:00.000Z', sortOrder: 1,
    },
    {
      id: 'task-3', goalId: 'goal-2', name: '整理交互规范', description: '',
      startDate: '2026-07-01', endDate: '2026-07-31', recurrenceType: 'weekly_quota', weeklyQuota: 2,
      completedAt: null, sortOrder: 0,
    },
    {
      id: 'task-4', goalId: 'goal-1', name: '编写发布说明', description: '',
      startDate: '2026-07-01', endDate: '2026-07-30', recurrenceType: 'none', weeklyQuota: null,
      completedAt: null, sortOrder: 1,
    },
    {
      id: 'task-5', goalId: 'goal-1', name: '完成技术选型', description: '',
      startDate: '2026-07-01', endDate: '2026-07-29', recurrenceType: 'none', weeklyQuota: null,
      completedAt: '2026-07-16T01:00:00.000Z', sortOrder: 3,
    },
  ],
  occurrences: [{
    id: 'occurrence-1', taskId: 'task-1', periodKey: 'legacy', plannedDate: '2026-07-18',
    boundDate: null, state: 'pending', completedAt: null,
  }],
  focusSessions: [],
}

class FailingStopRepository extends PreviewRepository {
  override async saveFocusSession(session: FocusSession): Promise<void> {
    if (session.id === 'active-session' && session.endedAt !== null) throw new Error('stop failed')
    await super.saveFocusSession(session)
  }
}

function setup(options: { repository?: PreviewRepository; confirmDiscard?: () => boolean } = {}) {
  const repository = options.repository ?? new PreviewRepository(seed)
  render(
    <ThemesPage
      repository={repository}
      taskService={new TaskService(repository, () => 'completion-session')}
      timerService={new TimerService(repository, () => 'timer-session')}
      now={() => now}
      createId={() => 'new-id'}
      confirmDiscard={options.confirmDiscard}
    />,
  )
  return repository
}

beforeEach(() => resetAppStore())

describe('ThemesPage', () => {
  it('uses the reference create-theme dialog and default color palette', async () => {
    setup()

    fireEvent.click(await screen.findByRole('button', { name: '新增主题' }))
    const dialog = screen.getByRole('dialog', { name: '新增主题' })

    expect(within(dialog).getByRole('heading', { name: '创建主题' })).toBeInTheDocument()
    expect(within(dialog).getByPlaceholderText('输入主题名称...')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('button', { name: /选择颜色/ })).toHaveLength(12)
    expect(within(dialog).getByRole('button', { name: '选择颜色 #FF3B30' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('propagates theme and goal selection across the three columns', async () => {
    setup()

    expect(await screen.findByRole('button', { name: '选择主题 产品设计' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '选择目标 发布 macOS 版本' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('完成产品原型')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '选择目标 完善设计系统' }))
    expect(await screen.findByText('整理交互规范')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '选择主题 个人成长' }))
    expect(await screen.findByRole('button', { name: '选择目标 阅读' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('creates entities with current-parent defaults and validates trimmed names', async () => {
    const repository = setup()

    fireEvent.click(await screen.findByRole('button', { name: '新增目标' }))
    expect(screen.getByLabelText('所属主题')).toHaveValue('theme-1')
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByText('名称不能为空')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '  规划发布  ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(async () => expect((await repository.listGoals('theme-1')).map((goal) => goal.name)).toContain('规划发布'))

    fireEvent.click(screen.getByRole('button', { name: '新增任务' }))
    expect(screen.getByLabelText('所属目标')).toHaveValue('goal-1')
    expect(screen.getByLabelText('重复类型')).toHaveValue('none')
  })

  it('sets excluded weekdays when creating a daily task', async () => {
    const repository = setup()
    fireEvent.click(await screen.findByRole('button', { name: '新增任务' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '工作日复盘' } })
    fireEvent.change(screen.getByLabelText('开始日期（可选）'), { target: { value: '2026-07-20' } })
    fireEvent.change(screen.getByLabelText('结束日期（可选）'), { target: { value: '2026-07-31' } })
    fireEvent.change(screen.getByLabelText('重复类型'), { target: { value: 'daily' } })

    expect(screen.getByLabelText('排除周一')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('排除周六'))
    fireEvent.click(screen.getByLabelText('排除周日'))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(async () => expect((await repository.getTask('new-id'))?.excludedWeekdays).toEqual([0, 6]))
  })

  it('opens edit and delete only through the task context menu and confirms exact impact', async () => {
    const repository = setup()
    await screen.findByText('完成产品原型')

    expect(screen.queryByRole('button', { name: '编辑任务' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除任务' })).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByTestId('task-card-task-1'))
    expect(screen.getByRole('button', { name: '编辑任务' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除任务' }))

    const dialog = screen.getByRole('dialog', { name: '确认删除任务' })
    expect(await within(dialog).findByText('任务 1')).toBeInTheDocument()
    expect(within(dialog).getByText('实例 1')).toBeInTheDocument()
    expect(within(dialog).getByText('专注记录 0')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '永久删除' }))
    await waitFor(async () => expect(await repository.getTask('task-1')).toBeNull())
  })

  it('prompts before closing a dirty entity dialog', async () => {
    const confirmDiscard = vi.fn(() => false)
    setup({ confirmDiscard })
    fireEvent.click(await screen.findByRole('button', { name: '新增主题' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '新主题' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(confirmDiscard).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: '新增主题' })).toBeInTheDocument()
  })

  it('starts a task through TimerService and moves an early start date to today', async () => {
    const repository = setup()
    fireEvent.click(await screen.findByRole('button', { name: '开始 完成产品原型' }))

    await waitFor(async () => {
      expect((await repository.getActiveFocusSession())?.taskId).toBe('task-1')
      expect((await repository.getTask('task-1'))?.startDate).toBe('2026-07-18')
    })
  })

  it('stops the matching active session before completing its task', async () => {
    const repository = new PreviewRepository({
      ...seed,
      focusSessions: [{ id: 'active-session', taskId: 'task-1', occurrenceId: null, startedAt: '2026-07-18T00:00:00.000Z', endedAt: null, source: 'timer' }],
    })
    setup({ repository })

    fireEvent.click(await screen.findByRole('checkbox', { name: '完成 完成产品原型' }))

    await waitFor(async () => expect(await repository.getActiveFocusSession()).toBeNull())
    expect((await repository.listFocusSessionsForTask('task-1'))[0]?.endedAt).toBe(now.toISOString())
    expect((await repository.getTask('task-1'))?.completedAt).toBe(now.toISOString())
  })

  it('does not complete when stopping the matching active session fails', async () => {
    const repository = new FailingStopRepository({
      ...seed,
      focusSessions: [{ id: 'active-session', taskId: 'task-1', occurrenceId: null, startedAt: '2026-07-18T00:00:00.000Z', endedAt: null, source: 'timer' }],
    })
    setup({ repository })

    fireEvent.click(await screen.findByRole('checkbox', { name: '完成 完成产品原型' }))

    await screen.findByText('stop failed')
    expect((await repository.getTask('task-1'))?.completedAt).toBeNull()
    expect((await repository.getActiveFocusSession())?.id).toBe('active-session')
  })

  it('automatically records 15 minutes before completing and renders completed tasks separately', async () => {
    const repository = setup()
    fireEvent.click(await screen.findByRole('checkbox', { name: '完成 完成产品原型' }))

    await waitFor(() => expect(screen.getByRole('region', { name: '已完成任务' })).toHaveTextContent('完成产品原型'))
    expect((await repository.getTask('task-1'))?.completedAt).not.toBeNull()
    expect(await repository.listFocusSessionsForTask('task-1')).toMatchObject([{
      startedAt: new Date('2026-07-18T00:00:00').toISOString(),
      endedAt: new Date('2026-07-18T00:15:00').toISOString(),
    }])

    fireEvent.click(screen.getByRole('checkbox', { name: '恢复 完成产品原型' }))
    await waitFor(async () => expect((await repository.getTask('task-1'))?.completedAt).toBeNull())
  })

  it('terminates a recurring task body from the theme workspace', async () => {
    const repository = setup()
    fireEvent.click(await screen.findByRole('button', { name: '选择目标 完善设计系统' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: '完成 整理交互规范' }))

    await waitFor(async () => expect((await repository.getTask('task-3'))?.completedAt).toBe(now.toISOString()))
    expect(screen.queryByRole('dialog', { name: '完成任务' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '已完成任务' })).toHaveTextContent('整理交互规范')
  })

  it('allows an unscheduled task and requires optional dates to be filled together', async () => {
    expect(isValidLocalDate('2026-02-30')).toBe(false)
    expect(isValidLocalDate('not-a-date')).toBe(false)
    expect(isValidLocalDate('2026-02-28')).toBe(true)
    const repository = setup()
    fireEvent.click(await screen.findByRole('button', { name: '新增任务' }))
    expect(screen.getByLabelText('开始日期（可选）')).toHaveValue('')
    expect(screen.getByLabelText('结束日期（可选）')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '暂未安排' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(async () => expect((await repository.listTasks('goal-1')).find((task) => task.name === '暂未安排')).toMatchObject({ startDate: '', endDate: '' }))

    fireEvent.click(screen.getByRole('button', { name: '新增任务' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '日期校验' } })
    fireEvent.change(screen.getByLabelText('开始日期（可选）'), { target: { value: '2026-07-18' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByText('开始日期和结束日期需要同时填写或同时留空')).toBeInTheDocument()
  })

  it('disables goal creation and guides the user when no theme exists', async () => {
    setup({ repository: new PreviewRepository({ themes: [], goals: [], tasks: [], occurrences: [], focusSessions: [] }) })

    expect(await screen.findByRole('button', { name: '新增目标' })).toBeDisabled()
    expect(screen.getByText('请先创建主题')).toBeInTheDocument()
  })

  it('labels task metadata as an end date', async () => {
    setup()
    expect(await screen.findByText('7月25日 结束')).toBeInTheDocument()
    expect(screen.queryByText('7月25日 截止')).not.toBeInTheDocument()
  })

  it('focuses and closes the context menu with Escape, restoring the trigger focus', async () => {
    setup()
    const card = await screen.findByTestId('task-card-task-1')
    card.focus()
    fireEvent.contextMenu(card)
    const edit = screen.getByRole('button', { name: '编辑任务' })
    await waitFor(() => expect(edit).toHaveFocus())

    fireEvent.keyDown(edit, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: '编辑任务' })).not.toBeInTheDocument()
    await waitFor(() => expect(card).toHaveFocus())
  })

  it('closes an entity dialog with Escape and restores focus to its opener', async () => {
    setup()
    const add = await screen.findByRole('button', { name: '新增任务' })
    add.focus()
    fireEvent.click(add)
    expect(screen.getByLabelText('名称')).toHaveFocus()

    fireEvent.keyDown(screen.getByRole('dialog', { name: '新增任务' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '新增任务' })).not.toBeInTheDocument()
    await waitFor(() => expect(add).toHaveFocus())
  })

  it('persists theme and goal sibling sorting handlers', async () => {
    const repository = setup()
    const themeHandle = await screen.findByRole('button', { name: '拖动主题 产品设计' })
    fireEvent.keyDown(themeHandle, { key: 'ArrowDown', altKey: true })
    await waitFor(async () => expect((await repository.listThemes()).map((theme) => theme.id)).toEqual(['theme-2', 'theme-1']))
    fireEvent.click(screen.getByRole('button', { name: '选择主题 产品设计' }))
    const firstHandle = await screen.findByRole('button', { name: '拖动目标 发布 macOS 版本' })
    expect(firstHandle).toHaveAttribute('aria-roledescription', 'sortable')
    firstHandle.focus()
    fireEvent.keyDown(firstHandle, { key: 'ArrowDown', altKey: true })

    await waitFor(async () => {
      expect((await repository.listGoals('theme-1')).map((goal) => goal.id)).toEqual(['goal-2', 'goal-1'])
    })
  })

  it('sorts pending and completed task sections independently and keeps restore order stable', async () => {
    const repository = setup()
    fireEvent.keyDown(await screen.findByRole('button', { name: '拖动任务 完成产品原型' }), { key: 'ArrowDown', altKey: true })
    await waitFor(async () => expect((await repository.listTasks('goal-1')).filter((task) => task.completedAt === null).map((task) => task.id)).toEqual(['task-4', 'task-1']))
    expect((await repository.listTasks('goal-1')).filter((task) => task.completedAt !== null).map((task) => task.id)).toEqual(['task-2', 'task-5'])

    fireEvent.keyDown(screen.getByRole('button', { name: '拖动任务 菜单栏计时测试' }), { key: 'ArrowDown', altKey: true })
    await waitFor(async () => expect((await repository.listTasks('goal-1')).filter((task) => task.completedAt !== null).map((task) => task.id)).toEqual(['task-5', 'task-2']))
    fireEvent.click(screen.getByRole('checkbox', { name: '恢复 完成技术选型' }))
    await waitFor(async () => expect((await repository.listTasks('goal-1')).filter((task) => task.completedAt === null).map((task) => task.id)).toEqual(['task-4', 'task-1', 'task-5']))
  })
})

import type {
  FocusSession,
  Goal,
  Id,
  LocalDate,
  Task,
  TaskOccurrence,
  Theme,
} from '../../domain/models'
import type {
  DeletionImpact,
  FocusMindRepository,
} from '../../ports/FocusMindRepository'

export interface PreviewRepositorySeed {
  themes: Theme[]
  goals: Goal[]
  tasks: Task[]
  occurrences: TaskOccurrence[]
  focusSessions: FocusSession[]
}

type Mutation = (state: PreviewRepositorySeed) => void

const TRANSACTION_READ_ERROR =
  'Preview repository transactions are write-only; reads must happen before or after the transaction'

export class PreviewRepository implements FocusMindRepository {
  private state: PreviewRepositorySeed
  private readonly root: PreviewRepository
  private readonly transactionBuffer: Mutation[] | null

  constructor(
    seed: PreviewRepositorySeed = createPreviewSeed(),
    root?: PreviewRepository,
    transactionBuffer: Mutation[] | null = null,
  ) {
    this.state = cloneSeed(seed)
    this.root = root ?? this
    this.transactionBuffer = transactionBuffer
  }

  async transaction<T>(work: (repo: FocusMindRepository) => Promise<T>): Promise<T> {
    if (this.transactionBuffer !== null) {
      const checkpoint = this.transactionBuffer.length
      try {
        return await work(this)
      } catch (error) {
        this.transactionBuffer.splice(checkpoint)
        throw error
      }
    }

    const mutations: Mutation[] = []
    const transactionRepository = new PreviewRepository(
      this.root.state,
      this.root,
      mutations,
    )
    const result = await work(transactionRepository)
    const next = cloneSeed(this.root.state)
    for (const mutation of mutations) {
      mutation(next)
      assertRepositoryConstraints(next)
    }
    this.root.state = next
    return result
  }

  async listThemes(): Promise<Theme[]> {
    this.assertReadable()
    return clone(this.root.state.themes).sort(compareSortOrder)
  }

  async listGoals(themeId: Id): Promise<Goal[]> {
    this.assertReadable()
    return clone(this.root.state.goals)
      .filter((goal) => goal.themeId === themeId)
      .sort(compareSortOrder)
  }

  async listTasks(goalId: Id): Promise<Task[]> {
    this.assertReadable()
    return clone(this.root.state.tasks)
      .filter((task) => task.goalId === goalId)
      .sort(compareSortOrder)
  }

  async getTask(id: Id): Promise<Task | null> {
    this.assertReadable()
    const task = this.root.state.tasks.find((item) => item.id === id)
    return task ? { ...task } : null
  }

  async saveTheme(theme: Theme): Promise<void> {
    this.write((state) => upsert(state.themes, theme))
  }

  async saveGoal(goal: Goal): Promise<void> {
    this.write((state) => upsert(state.goals, goal))
  }

  async saveTask(task: Task): Promise<void> {
    this.write((state) => upsert(state.tasks, task))
  }

  async upsertOccurrences(items: TaskOccurrence[]): Promise<void> {
    this.write((state) => {
      for (const item of items) upsertOccurrence(state.occurrences, item)
    })
  }

  async listOccurrences(from: LocalDate, to: LocalDate): Promise<TaskOccurrence[]> {
    this.assertReadable()
    return clone(this.root.state.occurrences)
      .filter((item) => {
        const date = item.boundDate ?? item.plannedDate
        return date !== null && date >= from && date <= to
      })
      .sort((left, right) => {
        const leftDate = left.boundDate ?? left.plannedDate ?? ''
        const rightDate = right.boundDate ?? right.plannedDate ?? ''
        return leftDate.localeCompare(rightDate) || left.periodKey.localeCompare(right.periodKey)
      })
  }

  async listOccurrencesForTask(taskId: Id): Promise<TaskOccurrence[]> {
    this.assertReadable()
    return clone(this.root.state.occurrences)
      .filter((item) => item.taskId === taskId)
      .sort((left, right) => left.periodKey.localeCompare(right.periodKey) || left.id.localeCompare(right.id))
  }

  async saveFocusSession(session: FocusSession): Promise<void> {
    this.write((state) => upsert(state.focusSessions, session))
  }

  async deleteFocusSession(id: Id): Promise<void> {
    this.write((state) => removeById(state.focusSessions, id))
  }

  async listFocusSessions(from: string, to: string): Promise<FocusSession[]> {
    this.assertReadable()
    return clone(this.root.state.focusSessions)
      .filter((session) => session.startedAt < to && (session.endedAt === null || session.endedAt > from))
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id))
  }

  async listFocusSessionsForTask(taskId: Id): Promise<FocusSession[]> {
    this.assertReadable()
    return clone(this.root.state.focusSessions)
      .filter((session) => session.taskId === taskId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id))
  }

  async getActiveFocusSession(): Promise<FocusSession | null> {
    this.assertReadable()
    const active = this.root.state.focusSessions.find((session) => session.endedAt === null)
    return active ? { ...active } : null
  }

  async countDeletionImpact(
    kind: 'theme' | 'goal' | 'task',
    id: Id,
  ): Promise<DeletionImpact> {
    this.assertReadable()
    const selectedThemeIds = new Set(
      kind === 'theme' && this.root.state.themes.some((item) => item.id === id) ? [id] : [],
    )
    const selectedGoalIds = new Set(this.root.state.goals
      .filter((item) => kind === 'goal' ? item.id === id : selectedThemeIds.has(item.themeId))
      .map((item) => item.id))
    const selectedTaskIds = new Set(this.root.state.tasks
      .filter((item) => kind === 'task' ? item.id === id : selectedGoalIds.has(item.goalId))
      .map((item) => item.id))

    return {
      themes: selectedThemeIds.size,
      goals: selectedGoalIds.size,
      tasks: selectedTaskIds.size,
      occurrences: this.root.state.occurrences.filter((item) => selectedTaskIds.has(item.taskId)).length,
      focusSessions: this.root.state.focusSessions.filter((item) => selectedTaskIds.has(item.taskId)).length,
    }
  }

  async deleteCascade(kind: 'theme' | 'goal' | 'task', id: Id): Promise<void> {
    this.write((state) => {
      const themeIds = new Set(kind === 'theme' ? [id] : [])
      const goalIds = new Set(state.goals
        .filter((item) => kind === 'goal' ? item.id === id : themeIds.has(item.themeId))
        .map((item) => item.id))
      const taskIds = new Set(state.tasks
        .filter((item) => kind === 'task' ? item.id === id : goalIds.has(item.goalId))
        .map((item) => item.id))
      state.themes = state.themes.filter((item) => !themeIds.has(item.id))
      state.goals = state.goals.filter((item) => !goalIds.has(item.id))
      state.tasks = state.tasks.filter((item) => !taskIds.has(item.id))
      state.occurrences = state.occurrences.filter((item) => !taskIds.has(item.taskId))
      state.focusSessions = state.focusSessions.filter((item) => !taskIds.has(item.taskId))
    })
  }

  private assertReadable(): void {
    if (this.transactionBuffer !== null) throw new Error(TRANSACTION_READ_ERROR)
  }

  private write(mutation: Mutation): void {
    if (this.transactionBuffer !== null) {
      this.transactionBuffer.push(mutation)
      return
    }

    const next = cloneSeed(this.root.state)
    mutation(next)
    assertRepositoryConstraints(next)
    this.root.state = next
  }
}

export function createPreviewSeed(): PreviewRepositorySeed {
  return {
    themes: [
      { id: 'preview-theme-product', name: '产品设计', color: '#A73E72', sortOrder: 0 },
      { id: 'preview-theme-growth', name: '个人成长', color: '#D68647', sortOrder: 1 },
      { id: 'preview-theme-health', name: '健康管理', color: '#C62828', sortOrder: 2 },
    ],
    goals: [
      { id: 'preview-goal-release', themeId: 'preview-theme-product', name: '发布 macOS 版本', sortOrder: 0 },
      { id: 'preview-goal-system', themeId: 'preview-theme-product', name: '完善设计系统', sortOrder: 1 },
      { id: 'preview-goal-research', themeId: 'preview-theme-product', name: '完成用户研究', sortOrder: 2 },
      { id: 'preview-goal-reading', themeId: 'preview-theme-growth', name: '持续阅读', sortOrder: 0 },
      { id: 'preview-goal-health', themeId: 'preview-theme-health', name: '保持活力', sortOrder: 0 },
    ],
    tasks: [
      {
        id: 'preview-task-prototype', goalId: 'preview-goal-release', name: '完成产品原型',
        description: '完成核心功能原型设计，包括主要交互流程和关键页面布局。',
        startDate: '2026-07-01', endDate: '2026-07-22', recurrenceType: 'none',
        weeklyQuota: null,
        completedAt: null, sortOrder: 0,
      },
      {
        id: 'preview-task-guidelines', goalId: 'preview-goal-release', name: '整理交互规范',
        description: '整理并归档当前项目的所有交互组件规范与状态说明。',
        startDate: '2026-07-01', endDate: '2026-07-25', recurrenceType: 'weekly_quota',
        weeklyQuota: 2, completedAt: null, sortOrder: 1,
      },
      {
        id: 'preview-task-menubar', goalId: 'preview-goal-release', name: '菜单栏计时测试',
        description: '在不同分辨率下测试 macOS 菜单栏计时器的显示效果。',
        startDate: '2026-07-01', endDate: '2026-07-21', recurrenceType: 'none',
        weeklyQuota: null, completedAt: null, sortOrder: 2,
      },
      {
        id: 'preview-task-stack', goalId: 'preview-goal-release', name: '确认技术栈选型',
        description: '已完成前端框架与状态管理方案的最终评估。',
        startDate: '2026-07-01', endDate: '2026-07-17', recurrenceType: 'none',
        weeklyQuota: null, completedAt: '2026-07-17T09:30:00.000Z', sortOrder: 3,
      },
      {
        id: 'preview-task-review', goalId: 'preview-goal-release', name: '设计评审第一阶段',
        description: '完成初步视觉风格评审，收集并整理反馈。',
        startDate: '2026-07-01', endDate: '2026-07-16', recurrenceType: 'none',
        weeklyQuota: null, completedAt: '2026-07-16T08:00:00.000Z', sortOrder: 4,
      },
    ],
    occurrences: [],
    focusSessions: [],
  }
}

function upsert<T extends { id: Id }>(items: T[], item: T): void {
  const index = items.findIndex((candidate) => candidate.id === item.id)
  if (index === -1) items.push({ ...item })
  else items[index] = { ...item }
}

function upsertOccurrence(items: TaskOccurrence[], item: TaskOccurrence): void {
  const periodIndex = items.findIndex((candidate) => (
    candidate.taskId === item.taskId && candidate.periodKey === item.periodKey
  ))
  if (periodIndex !== -1) {
    const existing = items[periodIndex] as TaskOccurrence
    items[periodIndex] = { ...item, id: existing.id }
    return
  }

  if (items.some((candidate) => candidate.id === item.id)) {
    throw new Error(`Duplicate occurrence id: ${item.id}`)
  }
  items.push({ ...item })
}

function removeById<T extends { id: Id }>(items: T[], id: Id): void {
  const index = items.findIndex((item) => item.id === id)
  if (index !== -1) items.splice(index, 1)
}

function clone<T>(items: readonly T[]): T[] {
  return items.map((item) => ({ ...item }))
}

function cloneSeed(seed: PreviewRepositorySeed): PreviewRepositorySeed {
  return {
    themes: clone(seed.themes),
    goals: clone(seed.goals),
    tasks: clone(seed.tasks),
    occurrences: clone(seed.occurrences),
    focusSessions: clone(seed.focusSessions),
  }
}

function compareSortOrder(left: { id: Id; sortOrder: number }, right: { id: Id; sortOrder: number }) {
  return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
}

function assertRepositoryConstraints(state: PreviewRepositorySeed): void {
  for (const goal of state.goals) {
    if (!state.themes.some((theme) => theme.id === goal.themeId)) {
      throw new Error(`Preview foreign key violation: goal ${goal.id} theme ${goal.themeId}`)
    }
  }
  for (const task of state.tasks) {
    if (!state.goals.some((goal) => goal.id === task.goalId)) {
      throw new Error(`Preview foreign key violation: task ${task.id} goal ${task.goalId}`)
    }
  }
  for (const occurrence of state.occurrences) {
    if (!state.tasks.some((task) => task.id === occurrence.taskId)) {
      throw new Error(
        `Preview foreign key violation: occurrence ${occurrence.id} task ${occurrence.taskId}`,
      )
    }
  }
  for (const session of state.focusSessions) {
    if (!state.tasks.some((task) => task.id === session.taskId)) {
      throw new Error(`Preview foreign key violation: focus session ${session.id} task ${session.taskId}`)
    }
    if (
      session.occurrenceId !== null
      && !state.occurrences.some((occurrence) => occurrence.id === session.occurrenceId)
    ) {
      throw new Error(
        `Preview foreign key violation: focus session ${session.id} occurrence ${session.occurrenceId}`,
      )
    }
  }
  if (state.focusSessions.filter((session) => session.endedAt === null).length > 1) {
    throw new Error('土豆栗丝特只允许同时进行一条专注记录')
  }
}

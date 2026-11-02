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
import {
  focusSessionFromRow,
  goalFromRow,
  occurrenceFromRow,
  taskFromRow,
  themeFromRow,
  type FocusSessionRow,
  type GoalRow,
  type TaskOccurrenceRow,
  type TaskRow,
  type ThemeRow,
} from './schema'

export interface SqliteExecuteResult {
  rowsAffected: number
}

export interface SqliteStatement {
  sql: string
  bindValues: unknown[]
}

export interface SqliteDriver {
  execute(sql: string, bindValues?: unknown[]): Promise<SqliteExecuteResult>
  /** Commits every statement on one connection or rolls the entire batch back. */
  executeBatch(statements: readonly SqliteStatement[]): Promise<SqliteExecuteResult[]>
  select<T>(sql: string, bindValues?: unknown[]): Promise<T[]>
}

interface ConnectionState {
  tail: Promise<void>
}

interface TransactionBuffer {
  statements: SqliteStatement[]
}

interface ImpactRow {
  themes: number
  goals: number
  tasks: number
  occurrences: number
  focus_sessions: number
}

export class SqliteRepository implements FocusMindRepository {
  private readonly driver: SqliteDriver
  private readonly state: ConnectionState
  private readonly transactionBuffer: TransactionBuffer | null

  constructor(
    driver: SqliteDriver,
    state: ConnectionState = { tail: Promise.resolve() },
    transactionBuffer: TransactionBuffer | null = null,
  ) {
    this.driver = driver
    this.state = state
    this.transactionBuffer = transactionBuffer
  }

  async initialize(): Promise<void> {
    await this.withConnection(async () => {
      await this.driver.execute('PRAGMA foreign_keys = ON')
      await this.driver.select('PRAGMA journal_mode = WAL')
    })
  }

  async transaction<T>(work: (repo: FocusMindRepository) => Promise<T>): Promise<T> {
    if (this.transactionBuffer !== null) {
      const checkpoint = this.transactionBuffer.statements.length
      try {
        return await work(this)
      } catch (error) {
        this.transactionBuffer.statements.splice(checkpoint)
        throw error
      }
    }

    return this.withConnection(async () => {
      const transactionBuffer: TransactionBuffer = { statements: [] }
      const transactionRepository = new SqliteRepository(
        this.driver,
        this.state,
        transactionBuffer,
      )
      const result = await work(transactionRepository)
      if (transactionBuffer.statements.length > 0) {
        await this.driver.executeBatch(transactionBuffer.statements)
      }
      return result
    })
  }

  async listThemes(): Promise<Theme[]> {
    const rows = await this.select<ThemeRow>(
      'SELECT id, name, color, sort_order FROM themes ORDER BY sort_order, id',
    )
    return rows.map(themeFromRow)
  }

  async listGoals(themeId: Id): Promise<Goal[]> {
    const rows = await this.select<GoalRow>(
      'SELECT id, theme_id, name, sort_order FROM goals WHERE theme_id = ? ORDER BY sort_order, id',
      [themeId],
    )
    return rows.map(goalFromRow)
  }

  async listTasks(goalId: Id): Promise<Task[]> {
    const rows = await this.select<TaskRow>(
      'SELECT id, goal_id, name, description, start_date, end_date, recurrence_type, weekly_quota, completed_at, sort_order FROM tasks WHERE goal_id = ? ORDER BY sort_order, id',
      [goalId],
    )
    return rows.map(taskFromRow)
  }

  async getTask(id: Id): Promise<Task | null> {
    const rows = await this.select<TaskRow>(
      'SELECT id, goal_id, name, description, start_date, end_date, recurrence_type, weekly_quota, completed_at, sort_order FROM tasks WHERE id = ? LIMIT 1',
      [id],
    )
    return rows[0] ? taskFromRow(rows[0]) : null
  }

  async saveTheme(theme: Theme): Promise<void> {
    await this.execute(
      "INSERT INTO themes (id, name, color, sort_order) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, sort_order = excluded.sort_order, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
      [theme.id, theme.name, theme.color, theme.sortOrder],
    )
  }

  async saveGoal(goal: Goal): Promise<void> {
    await this.execute(
      "INSERT INTO goals (id, theme_id, name, sort_order) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET theme_id = excluded.theme_id, name = excluded.name, sort_order = excluded.sort_order, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
      [goal.id, goal.themeId, goal.name, goal.sortOrder],
    )
  }

  async saveTask(task: Task): Promise<void> {
    await this.execute(
      "INSERT INTO tasks (id, goal_id, name, description, start_date, end_date, recurrence_type, weekly_quota, completed_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET goal_id = excluded.goal_id, name = excluded.name, description = excluded.description, start_date = excluded.start_date, end_date = excluded.end_date, recurrence_type = excluded.recurrence_type, weekly_quota = excluded.weekly_quota, completed_at = excluded.completed_at, sort_order = excluded.sort_order, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
      [
        task.id,
        task.goalId,
        task.name,
        task.description,
        task.startDate,
        task.endDate,
        task.recurrenceType,
        task.weeklyQuota,
        task.completedAt,
        task.sortOrder,
      ],
    )
  }

  async upsertOccurrences(items: TaskOccurrence[]): Promise<void> {
    if (items.length === 0) return

    await this.transaction(async (repository) => {
      const transactionRepository = repository as SqliteRepository
      for (const item of items) {
        await transactionRepository.execute(
          "INSERT INTO task_occurrences (id, task_id, period_key, planned_date, bound_date, state, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(task_id, period_key) DO UPDATE SET planned_date = excluded.planned_date, bound_date = excluded.bound_date, state = excluded.state, completed_at = excluded.completed_at, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
          [
            item.id,
            item.taskId,
            item.periodKey,
            item.plannedDate,
            item.boundDate,
            item.state,
            item.completedAt,
          ],
        )
      }
    })
  }

  async listOccurrences(from: LocalDate, to: LocalDate): Promise<TaskOccurrence[]> {
    const rows = await this.select<TaskOccurrenceRow>(
      'SELECT id, task_id, period_key, planned_date, bound_date, state, completed_at FROM task_occurrences WHERE COALESCE(bound_date, planned_date) >= ? AND COALESCE(bound_date, planned_date) <= ? ORDER BY COALESCE(bound_date, planned_date), period_key, id',
      [from, to],
    )
    return rows.map(occurrenceFromRow)
  }

  async listOccurrencesForTask(taskId: Id): Promise<TaskOccurrence[]> {
    const rows = await this.select<TaskOccurrenceRow>(
      'SELECT id, task_id, period_key, planned_date, bound_date, state, completed_at FROM task_occurrences WHERE task_id = ? ORDER BY period_key, id',
      [taskId],
    )
    return rows.map(occurrenceFromRow)
  }

  async saveFocusSession(session: FocusSession): Promise<void> {
    await this.execute(
      "INSERT INTO focus_sessions (id, task_id, occurrence_id, started_at, ended_at, source) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET task_id = excluded.task_id, occurrence_id = excluded.occurrence_id, started_at = excluded.started_at, ended_at = excluded.ended_at, source = excluded.source, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
      [
        session.id,
        session.taskId,
        session.occurrenceId,
        session.startedAt,
        session.endedAt,
        session.source,
      ],
    )
  }

  async deleteFocusSession(id: Id): Promise<void> {
    await this.execute('DELETE FROM focus_sessions WHERE id = ?', [id])
  }

  async listFocusSessions(from: string, to: string): Promise<FocusSession[]> {
    const rows = await this.select<FocusSessionRow>(
      'SELECT id, task_id, occurrence_id, started_at, ended_at, source FROM focus_sessions WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?) ORDER BY started_at, id',
      [to, from],
    )
    return rows.map(focusSessionFromRow)
  }

  async listFocusSessionsForTask(taskId: Id): Promise<FocusSession[]> {
    const rows = await this.select<FocusSessionRow>(
      'SELECT id, task_id, occurrence_id, started_at, ended_at, source FROM focus_sessions WHERE task_id = ? ORDER BY started_at, id',
      [taskId],
    )
    return rows.map(focusSessionFromRow)
  }

  async getActiveFocusSession(): Promise<FocusSession | null> {
    const rows = await this.select<FocusSessionRow>(
      'SELECT id, task_id, occurrence_id, started_at, ended_at, source FROM focus_sessions WHERE ended_at IS NULL LIMIT 1',
    )
    return rows[0] ? focusSessionFromRow(rows[0]) : null
  }

  async countDeletionImpact(
    kind: 'theme' | 'goal' | 'task',
    id: Id,
  ): Promise<DeletionImpact> {
    const rows = await this.select<ImpactRow>(this.impactSql(kind), [id])
    const row = rows[0]

    return {
      themes: Number(row?.themes ?? 0),
      goals: Number(row?.goals ?? 0),
      tasks: Number(row?.tasks ?? 0),
      occurrences: Number(row?.occurrences ?? 0),
      focusSessions: Number(row?.focus_sessions ?? 0),
    }
  }

  async deleteCascade(kind: 'theme' | 'goal' | 'task', id: Id): Promise<void> {
    const table = {
      theme: 'themes',
      goal: 'goals',
      task: 'tasks',
    }[kind]

    await this.execute('DELETE FROM ' + table + ' WHERE id = ?', [id])
  }

  private impactSql(kind: 'theme' | 'goal' | 'task'): string {
    const selectedThemes =
      kind === 'theme' ? 'SELECT id FROM themes WHERE id = ?' : 'SELECT id FROM themes WHERE 0'
    const selectedGoals =
      kind === 'theme'
        ? 'SELECT id FROM goals WHERE theme_id IN (SELECT id FROM selected_themes)'
        : kind === 'goal'
          ? 'SELECT id FROM goals WHERE id = ?'
          : 'SELECT id FROM goals WHERE 0'
    const selectedTasks =
      kind === 'task'
        ? 'SELECT id FROM tasks WHERE id = ?'
        : 'SELECT id FROM tasks WHERE goal_id IN (SELECT id FROM selected_goals)'

    return [
      'WITH selected_themes AS (' + selectedThemes + '),',
      'selected_goals AS (' + selectedGoals + '),',
      'selected_tasks AS (' + selectedTasks + ')',
      'SELECT',
      '(SELECT COUNT(*) FROM selected_themes) AS themes,',
      '(SELECT COUNT(*) FROM selected_goals) AS goals,',
      '(SELECT COUNT(*) FROM selected_tasks) AS tasks,',
      '(SELECT COUNT(*) FROM task_occurrences WHERE task_id IN (SELECT id FROM selected_tasks)) AS occurrences,',
      '(SELECT COUNT(*) FROM focus_sessions WHERE task_id IN (SELECT id FROM selected_tasks)) AS focus_sessions',
    ].join(' ')
  }

  private async execute(sql: string, bindValues: unknown[] = []): Promise<void> {
    if (this.transactionBuffer !== null) {
      this.transactionBuffer.statements.push({ sql, bindValues: [...bindValues] })
      return
    }

    await this.withConnection(async () => {
      await this.driver.execute(sql, bindValues)
    })
  }

  private async select<T>(sql: string, bindValues: unknown[] = []): Promise<T[]> {
    if (this.transactionBuffer !== null) {
      throw new Error(TRANSACTION_READ_ERROR)
    }

    return this.withConnection(() => this.driver.select<T>(sql, bindValues))
  }

  private async withConnection<T>(work: () => Promise<T>): Promise<T> {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const previous = this.state.tail
    this.state.tail = previous.then(() => gate)
    await previous

    try {
      return await work()
    } finally {
      release()
    }
  }
}

export const TRANSACTION_READ_ERROR =
  'SQLite repository transactions are write-only; reads must happen before or after the transaction'

export const FOCUS_MIND_DATABASE_URL = 'sqlite:focus-mind.db'

export async function openFocusMindRepository(
  databaseUrl = FOCUS_MIND_DATABASE_URL,
): Promise<SqliteRepository> {
  const { default: Database } = await import('@tauri-apps/plugin-sql')
  const { invoke } = await import('@tauri-apps/api/core')
  const database = await Database.load(databaseUrl)
  const executeBatch = async (
    statements: readonly SqliteStatement[],
  ): Promise<SqliteExecuteResult[]> => {
    const rowsAffected = await invoke<number[]>('execute_sqlite_batch', {
      databaseUrl,
      statements,
    })
    return rowsAffected.map((count) => ({ rowsAffected: count }))
  }
  const driver: SqliteDriver = {
    execute: async (sql, bindValues = []) =>
      (await executeBatch([{ sql, bindValues }]))[0] ?? { rowsAffected: 0 },
    executeBatch,
    select: <T>(sql: string, bindValues?: unknown[]) =>
      database.select<T[]>(sql, bindValues),
  }
  const repository = new SqliteRepository(driver)
  await repository.initialize()
  return repository
}

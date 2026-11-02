// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskService } from '../../src/application/TaskService'
import type { FocusSession, Goal, Task, TaskOccurrence, Theme } from '../../src/domain/models'
import {
  SqliteRepository,
  type SqliteDriver,
  type SqliteStatement,
} from '../../src/infrastructure/sqlite/SqliteRepository'

interface CapturedStatement {
  sql: string
  bindValues: unknown[]
}

class NonAffineDriver {
  readonly batches: CapturedStatement[][] = []
  readonly individualSql: string[] = []

  async execute(sql: string) {
    this.individualSql.push(sql)
    if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/.test(sql)) {
      throw new Error('pseudo transactions cannot rely on connection affinity')
    }
    return { rowsAffected: 0 }
  }

  async executeBatch(statements: CapturedStatement[]) {
    this.batches.push(statements)
    return statements.map(() => ({ rowsAffected: 1 }))
  }

  async select<T>(): Promise<T[]> {
    return []
  }
}

class NodeSqliteDriver implements SqliteDriver {
  readonly batches: SqliteStatement[][] = []

  constructor(private readonly database: DatabaseSync) {}

  async execute(sql: string, bindValues: unknown[] = []) {
    if (bindValues.length === 0 && /;\s*\S/.test(sql.trim().replace(/;$/, ''))) {
      this.database.exec(sql)
      return { rowsAffected: 0 }
    }

    const result = this.database.prepare(sql).run(...bindValues as never[])
    return { rowsAffected: Number(result.changes) }
  }

  async executeBatch(statements: readonly SqliteStatement[]) {
    this.batches.push(statements.map((statement) => ({
      sql: statement.sql,
      bindValues: [...statement.bindValues],
    })))
    const results: Array<{ rowsAffected: number }> = []
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const statement of statements) {
        const result = this.database
          .prepare(statement.sql)
          .run(...statement.bindValues as never[])
        results.push({ rowsAffected: Number(result.changes) })
      }
      this.database.exec('COMMIT')
      return results
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async select<T>(sql: string, bindValues: unknown[] = []): Promise<T[]> {
    return this.database.prepare(sql).all(...bindValues as never[]) as T[]
  }
}

const theme: Theme = { id: 'theme-1', name: '身心', color: '#35A67C', sortOrder: 1 }
const goal: Goal = { id: 'goal-1', themeId: theme.id, name: '保持专注', sortOrder: 2 }
const task: Task = {
  id: 'task-1',
  goalId: goal.id,
  name: '深度工作',
  description: '完成核心工作',
  startDate: '2026-07-01',
  endDate: '2026-07-31',
  recurrenceType: 'daily',
  weeklyQuota: null,
  completedAt: null,
  sortOrder: 3,
}
const occurrence: TaskOccurrence = {
  id: 'occurrence-1',
  taskId: task.id,
  periodKey: 'daily:task-1:2026-07-18',
  plannedDate: '2026-07-18',
  boundDate: null,
  state: 'pending',
  completedAt: null,
}
const session: FocusSession = {
  id: 'session-1',
  taskId: task.id,
  occurrenceId: occurrence.id,
  startedAt: '2026-07-18T09:00:00.000Z',
  endedAt: '2026-07-18T10:00:00.000Z',
  source: 'timer',
}

describe('SqliteRepository', () => {
  let database: DatabaseSync
  let driver: NodeSqliteDriver
  let repository: SqliteRepository

  beforeEach(async () => {
    database = new DatabaseSync(':memory:')
    const migrationUrl = new URL('../../src-tauri/migrations/0001_initial.sql', import.meta.url)
    database.exec(await readFile(fileURLToPath(migrationUrl), 'utf8'))
    driver = new NodeSqliteDriver(database)
    repository = new SqliteRepository(driver)
    await repository.initialize()
  })

  afterEach(() => database.close())

  async function saveHierarchy() {
    await repository.saveTheme(theme)
    await repository.saveGoal(goal)
    await repository.saveTask(task)
    await repository.upsertOccurrences([occurrence])
    await repository.saveFocusSession(session)
  }

  it('maps CRUD rows and reports then atomically deletes a theme cascade', async () => {
    await saveHierarchy()

    expect(await repository.listThemes()).toEqual([theme])
    expect(await repository.listGoals(theme.id)).toEqual([goal])
    expect(await repository.listTasks(goal.id)).toEqual([task])
    expect(await repository.getTask(task.id)).toEqual(task)
    expect(await repository.getTask('missing-task')).toBeNull()
    expect(await repository.listOccurrencesForTask(task.id)).toEqual([occurrence])
    expect(await repository.listFocusSessionsForTask(task.id)).toEqual([session])
    expect(await repository.countDeletionImpact('theme', theme.id)).toEqual({
      themes: 1,
      goals: 1,
      tasks: 1,
      occurrences: 1,
      focusSessions: 1,
    })

    await repository.deleteCascade('theme', theme.id)

    for (const table of ['themes', 'goals', 'tasks', 'task_occurrences', 'focus_sessions']) {
      const rows = database.prepare('SELECT COUNT(*) AS count FROM ' + table).all() as Array<{ count: number }>
      expect(rows[0]?.count, table).toBe(0)
    }
  })

  it('permits only one active focus session and exposes it', async () => {
    await saveHierarchy()
    const active = { ...session, id: 'active-1', endedAt: null }
    await repository.saveFocusSession(active)

    await expect(repository.saveFocusSession({ ...active, id: 'active-2' })).rejects.toThrow()
    expect(await repository.getActiveFocusSession()).toEqual(active)
  })

  it('queries only occurrences and focus sessions intersecting the visible range', async () => {
    await saveHierarchy()
    await repository.upsertOccurrences([
      { ...occurrence, id: 'before', periodKey: 'daily:task-1:2026-07-01', plannedDate: '2026-07-01' },
      { ...occurrence, id: 'bound', periodKey: 'weekly:task-1:2026-W29:0', plannedDate: null, boundDate: '2026-07-19' },
      { ...occurrence, id: 'after', periodKey: 'daily:task-1:2026-07-31', plannedDate: '2026-07-31' },
    ])
    await repository.saveFocusSession({
      ...session,
      id: 'crosses-start',
      occurrenceId: null,
      startedAt: '2026-07-17T23:30:00.000Z',
      endedAt: '2026-07-18T00:30:00.000Z',
    })
    await repository.saveFocusSession({
      ...session,
      id: 'outside',
      occurrenceId: null,
      startedAt: '2026-07-21T00:00:00.000Z',
      endedAt: '2026-07-21T01:00:00.000Z',
    })

    expect((await repository.listOccurrences('2026-07-18', '2026-07-20')).map((item) => item.id)).toEqual([
      occurrence.id,
      'bound',
    ])
    expect((await repository.listFocusSessions('2026-07-18T00:00:00.000Z', '2026-07-20T00:00:00.000Z')).map((item) => item.id)).toEqual([
      'crosses-start',
      session.id,
    ])
  })

  it('lists unbound weekly occurrences by task without widening calendar range queries', async () => {
    await saveHierarchy()
    const weeklyOccurrence: TaskOccurrence = {
      ...occurrence,
      id: 'weekly-unbound',
      periodKey: 'weekly:task-1:2026-W29:0',
      plannedDate: null,
      boundDate: null,
    }
    await repository.upsertOccurrences([weeklyOccurrence])

    expect(await repository.listOccurrencesForTask(task.id)).toEqual([
      occurrence,
      weeklyOccurrence,
    ])
    expect(await repository.listOccurrences('2026-07-18', '2026-07-20')).toEqual([occurrence])
  })

  it('creates a recurring occurrence before its completion-form session in one transaction', async () => {
    await repository.saveTheme(theme)
    await repository.saveGoal(goal)
    await repository.saveTask(task)
    const completionNow = new Date('2026-07-18T12:00:00.000Z')

    const completed = await new TaskService(repository, () => 'completion-session').completeTask(
      task.id,
      completionNow,
      {
        startedAt: '2026-07-18T09:00:00.000Z',
        endedAt: '2026-07-18T10:00:00.000Z',
      },
    )

    expect(await repository.listOccurrencesForTask(task.id)).toEqual([completed.occurrence])
    expect(await repository.listFocusSessionsForTask(task.id)).toMatchObject([{
      id: 'completion-session',
      occurrenceId: completed.occurrence?.id,
      source: 'completion_form',
    }])
    expect(driver.batches.at(-1)?.map((statement) => (
      statement.sql.includes('focus_sessions') ? 'session' : 'occurrence'
    ))).toEqual(['occurrence', 'session', 'occurrence'])
  })

  it('rolls back every write when transaction work fails', async () => {
    await expect(repository.transaction(async (transaction) => {
      await transaction.saveTheme(theme)
      throw new Error('abort')
    })).rejects.toThrow('abort')

    expect(await repository.listThemes()).toEqual([])
  })

  it('submits multiple writes as one atomic driver batch without pseudo-transaction SQL', async () => {
    const driver = new NonAffineDriver()
    const batchRepository = new SqliteRepository(driver as unknown as SqliteDriver)

    await batchRepository.transaction(async (transaction) => {
      await transaction.saveTheme(theme)
      await transaction.saveGoal(goal)
    })

    expect(driver.batches).toHaveLength(1)
    expect(driver.batches[0]).toHaveLength(2)
    expect(driver.batches[0]?.map((statement) => statement.bindValues[0])).toEqual([
      theme.id,
      goal.id,
    ])
    expect(driver.individualSql).toEqual([])
  })

  it('rejects reads inside a write-only transaction with a stable error', async () => {
    const driver = new NonAffineDriver()
    const batchRepository = new SqliteRepository(driver as unknown as SqliteDriver)

    await expect(batchRepository.transaction(
      (transaction) => transaction.listThemes(),
    )).rejects.toThrow('SQLite repository transactions are write-only')
    expect(driver.batches).toEqual([])
  })

  it('rolls a failed nested transaction back to its buffered-write checkpoint', async () => {
    const driver = new NonAffineDriver()
    const batchRepository = new SqliteRepository(driver as unknown as SqliteDriver)

    await batchRepository.transaction(async (transaction) => {
      await transaction.saveTheme(theme)
      await expect(transaction.transaction(async (nested) => {
        await nested.saveGoal(goal)
        throw new Error('nested abort')
      })).rejects.toThrow('nested abort')
      await transaction.saveTask(task)
    })

    expect(driver.batches).toHaveLength(1)
    expect(driver.batches[0]?.map((statement) => statement.bindValues[0])).toEqual([
      theme.id,
      task.id,
    ])
  })
})

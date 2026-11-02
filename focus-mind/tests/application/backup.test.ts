// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  TauriDesktopPort,
  type BackupFileAdapter,
  type BackupFileEntry,
} from '../../src/infrastructure/tauri/TauriDesktopPort'

const SQLITE_HEADER = 'SQLite format 3\0'
const DATABASE_PATH = '/data/focus-mind.db'
const BACKUP_DIRECTORY = '/data/backups'

interface FakeDatabaseFile {
  header: string
  schemaVersion: number
  payload: string
  modifiedAt: number
}

class FakeFileAdapter implements BackupFileAdapter {
  readonly operations: string[] = []
  readonly files = new Map<string, FakeDatabaseFile>()
  importCandidate: string | null = null
  exportDestination: string | null = null
  databaseOpen = true

  constructor() {
    this.writeDatabase(DATABASE_PATH, 'current', 0)
  }

  writeDatabase(path: string, payload: string, modifiedAt: number, schemaVersion = 2) {
    this.files.set(path, {
      header: SQLITE_HEADER,
      schemaVersion,
      payload,
      modifiedAt,
    })
  }

  getPayload(path: string) {
    return this.files.get(path)?.payload
  }

  async databasePath() {
    return DATABASE_PATH
  }

  async backupDirectory() {
    return BACKUP_DIRECTORY
  }

  async ensureDirectory(path: string) {
    this.operations.push(`mkdir:${path}`)
  }

  async listFiles(directory: string): Promise<BackupFileEntry[]> {
    return [...this.files.entries()]
      .filter(([path]) => path.startsWith(`${directory}/`))
      .map(([path, file]) => ({
        path,
        name: path.slice(directory.length + 1),
        modifiedAt: file.modifiedAt,
      }))
  }

  async checkpointWal() {
    this.operations.push('checkpoint')
  }

  async copyFile(source: string, destination: string) {
    this.operations.push(`copy:${source}->${destination}`)
    const sourceFile = this.files.get(source)
    if (!sourceFile) throw new Error(`missing source: ${source}`)
    this.files.set(destination, { ...sourceFile })
  }

  async validateDatabase(path: string, expectedSchemaVersion: number) {
    this.operations.push(`validate:${path}`)
    const file = this.files.get(path)
    if (file?.header !== SQLITE_HEADER || file.schemaVersion !== expectedSchemaVersion) {
      throw new Error('invalid backup database')
    }
  }

  async replaceFile(source: string, destination: string) {
    this.operations.push(`replace:${source}->${destination}`)
    const sourceFile = this.files.get(source)
    if (!sourceFile) throw new Error(`missing replacement: ${source}`)
    this.files.set(destination, { ...sourceFile })
    this.files.delete(source)
  }

  async removeFile(path: string) {
    this.operations.push(`remove:${path}`)
    this.files.delete(path)
  }

  async chooseExportDestination() {
    return this.exportDestination
  }

  async chooseImportCandidate() {
    return this.importCandidate
  }

  async closeDatabase() {
    this.operations.push('close')
    this.databaseOpen = false
  }

  async migrateAndReopenDatabase() {
    this.operations.push('migrate-reopen')
    this.databaseOpen = true
  }
}

function localNoon(year: number, month: number, day: number) {
  return new Date(year, month - 1, day, 12)
}

describe('TauriDesktopPort backup orchestration', () => {
  it('creates at most one backup per local calendar day', async () => {
    const files = new FakeFileAdapter()
    const desktop = new TauriDesktopPort(files, () => localNoon(2026, 7, 18))

    await desktop.createDailyBackup()
    await desktop.createDailyBackup()

    expect(files.getPayload(`${BACKUP_DIRECTORY}/focus-mind-2026-07-18.db`)).toBe('current')
    expect(files.operations.filter((operation) => operation === 'checkpoint')).toHaveLength(1)
  })

  it('retains only the newest seven daily backups', async () => {
    const files = new FakeFileAdapter()
    let today = localNoon(2026, 7, 10)
    const desktop = new TauriDesktopPort(files, () => today)

    for (let day = 10; day <= 17; day += 1) {
      today = localNoon(2026, 7, day)
      await desktop.createDailyBackup()
    }

    expect((await files.listFiles(BACKUP_DIRECTORY)).map((file) => file.name).sort()).toEqual([
      'focus-mind-2026-07-11.db',
      'focus-mind-2026-07-12.db',
      'focus-mind-2026-07-13.db',
      'focus-mind-2026-07-14.db',
      'focus-mind-2026-07-15.db',
      'focus-mind-2026-07-16.db',
      'focus-mind-2026-07-17.db',
    ])
  })

  it('copies the current database to a pre-import backup before replacement', async () => {
    const files = new FakeFileAdapter()
    files.importCandidate = '/chosen/import.db'
    files.writeDatabase(files.importCandidate, 'candidate', 1)
    const desktop = new TauriDesktopPort(files, () => localNoon(2026, 7, 18))

    await desktop.importBackup()

    const preImport = (await files.listFiles(BACKUP_DIRECTORY))
      .find((file) => file.name.startsWith('focus-mind-pre-import-'))
    expect(preImport && files.getPayload(preImport.path)).toBe('current')
    expect(files.operations.indexOf(`copy:${DATABASE_PATH}->${preImport?.path}.tmp`))
      .toBeLessThan(files.operations.indexOf(`replace:${DATABASE_PATH}.import.tmp->${DATABASE_PATH}`))
  })

  it('replaces the active database with a valid import and reopens it', async () => {
    const files = new FakeFileAdapter()
    files.importCandidate = '/chosen/import.db'
    files.writeDatabase(files.importCandidate, 'candidate', 1)
    const desktop = new TauriDesktopPort(files, () => localNoon(2026, 7, 18))

    await desktop.importBackup()

    expect(files.getPayload(DATABASE_PATH)).toBe('candidate')
    expect(files.databaseOpen).toBe(true)
    expect(files.operations.slice(-1)).toEqual(['migrate-reopen'])
  })

  it('restores the original database when candidate validation fails', async () => {
    const files = new FakeFileAdapter()
    files.importCandidate = '/chosen/import.db'
    files.writeDatabase(files.importCandidate, 'candidate', 1, 99)
    const desktop = new TauriDesktopPort(files, () => localNoon(2026, 7, 18))

    await expect(desktop.importBackup()).rejects.toThrow('invalid backup database')

    expect(files.getPayload(DATABASE_PATH)).toBe('current')
    expect(files.databaseOpen).toBe(true)
    expect(files.operations).toContain(`replace:${DATABASE_PATH}.restore.tmp->${DATABASE_PATH}`)
  })
})

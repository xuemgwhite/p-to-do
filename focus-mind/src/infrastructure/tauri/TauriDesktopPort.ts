import type { DesktopPort } from '../../ports/DesktopPort'

const EXPECTED_SCHEMA_VERSION = 2
const DAILY_BACKUP_LIMIT = 7
const DAILY_BACKUP_PATTERN = /^focus-mind-\d{4}-\d{2}-\d{2}\.db$/

export interface BackupFileEntry {
  path: string
  name: string
  modifiedAt: number
}

export interface BackupFileAdapter {
  databasePath(): Promise<string>
  backupDirectory(): Promise<string>
  ensureDirectory(path: string): Promise<void>
  listFiles(directory: string): Promise<BackupFileEntry[]>
  checkpointWal(): Promise<void>
  copyFile(source: string, destination: string): Promise<void>
  validateDatabase(path: string, expectedSchemaVersion: number): Promise<void>
  replaceFile(source: string, destination: string): Promise<void>
  removeFile(path: string): Promise<void>
  chooseExportDestination(suggestedName: string): Promise<string | null>
  chooseImportCandidate(): Promise<string | null>
  closeDatabase(): Promise<void>
  migrateAndReopenDatabase(): Promise<void>
}

type Clock = () => Date

export class TauriDesktopPort implements DesktopPort {
  readonly mode = 'tauri' as const
  private adapter: BackupFileAdapter | undefined
  private readonly now: Clock

  constructor(adapter?: BackupFileAdapter, now: Clock = () => new Date()) {
    this.adapter = adapter
    this.now = now
  }

  async createDailyBackup(): Promise<void> {
    const adapter = await this.getAdapter()
    const databasePath = await adapter.databasePath()
    const backupDirectory = await adapter.backupDirectory()
    const backupName = `focus-mind-${localDateKey(this.now())}.db`
    const destination = joinPath(backupDirectory, backupName)

    await adapter.ensureDirectory(backupDirectory)
    const existing = await adapter.listFiles(backupDirectory)
    if (existing.some((file) => file.name === backupName)) return

    await adapter.checkpointWal()
    await this.copyValidated(databasePath, `${destination}.tmp`, destination)
    await this.retainNewestDailyBackups(backupDirectory)
  }

  async exportBackup(): Promise<void> {
    const adapter = await this.getAdapter()
    const suggestedName = `focus-mind-export-${localDateKey(this.now())}.db`
    const destination = await adapter.chooseExportDestination(suggestedName)
    if (!destination) return

    await adapter.checkpointWal()
    await this.copyValidated(await adapter.databasePath(), `${destination}.tmp`, destination)
  }

  async importBackup(): Promise<void> {
    const adapter = await this.getAdapter()
    const candidate = await adapter.chooseImportCandidate()
    if (!candidate) return

    const databasePath = await adapter.databasePath()
    const backupDirectory = await adapter.backupDirectory()
    const preImportPath = joinPath(
      backupDirectory,
      `focus-mind-pre-import-${localTimestampKey(this.now())}.db`,
    )

    await adapter.ensureDirectory(backupDirectory)
    await adapter.checkpointWal()
    await adapter.closeDatabase()
    await this.copyValidated(databasePath, `${preImportPath}.tmp`, preImportPath)

    try {
      await adapter.validateDatabase(candidate, EXPECTED_SCHEMA_VERSION)
      await this.copyValidated(candidate, `${databasePath}.import.tmp`, databasePath)
      await adapter.migrateAndReopenDatabase()
    } catch (error) {
      await this.copyValidated(preImportPath, `${databasePath}.restore.tmp`, databasePath)
      await adapter.migrateAndReopenDatabase()
      throw error
    }
  }

  private async getAdapter(): Promise<BackupFileAdapter> {
    if (!this.adapter) {
      const { TauriBackupFileAdapter } = await import('./TauriBackupFileAdapter')
      this.adapter = new TauriBackupFileAdapter()
    }
    return this.adapter
  }

  private async copyValidated(source: string, temporary: string, destination: string) {
    const adapter = await this.getAdapter()
    await adapter.removeFile(temporary)
    try {
      await adapter.copyFile(source, temporary)
      await adapter.validateDatabase(temporary, EXPECTED_SCHEMA_VERSION)
      await adapter.replaceFile(temporary, destination)
    } catch (error) {
      await adapter.removeFile(temporary)
      throw error
    }
  }

  private async retainNewestDailyBackups(directory: string) {
    const adapter = await this.getAdapter()
    const backups = (await adapter.listFiles(directory))
      .filter((file) => DAILY_BACKUP_PATTERN.test(file.name))
      .sort((left, right) => (
        right.modifiedAt - left.modifiedAt || right.name.localeCompare(left.name)
      ))

    await Promise.all(
      backups.slice(DAILY_BACKUP_LIMIT).map((file) => adapter.removeFile(file.path)),
    )
  }
}

function localDateKey(date: Date) {
  return [
    date.getFullYear().toString().padStart(4, '0'),
    (date.getMonth() + 1).toString().padStart(2, '0'),
    date.getDate().toString().padStart(2, '0'),
  ].join('-')
}

function localTimestampKey(date: Date) {
  return [
    localDateKey(date),
    date.getHours().toString().padStart(2, '0'),
    date.getMinutes().toString().padStart(2, '0'),
    date.getSeconds().toString().padStart(2, '0'),
    date.getMilliseconds().toString().padStart(3, '0'),
  ].join('-')
}

function joinPath(directory: string, name: string) {
  return `${directory.replace(/[\\/]$/, '')}/${name}`
}

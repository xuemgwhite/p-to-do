import { invoke } from '@tauri-apps/api/core'
import { appConfigDir, join } from '@tauri-apps/api/path'
import { open, save } from '@tauri-apps/plugin-dialog'
import {
  copyFile,
  exists,
  mkdir,
  readDir,
  remove,
  rename,
  stat,
} from '@tauri-apps/plugin-fs'
import Database from '@tauri-apps/plugin-sql'
import { FOCUS_MIND_DATABASE_URL } from '../sqlite/SqliteRepository'
import type { BackupFileAdapter, BackupFileEntry } from './TauriDesktopPort'

const DATABASE_FILENAME = 'focus-mind.db'
const BACKUP_DIRECTORY_NAME = 'backups'

export class TauriBackupFileAdapter implements BackupFileAdapter {
  async databasePath() {
    return join(await appConfigDir(), DATABASE_FILENAME)
  }

  async backupDirectory() {
    return join(await appConfigDir(), BACKUP_DIRECTORY_NAME)
  }

  async ensureDirectory(path: string) {
    await mkdir(path, { recursive: true })
  }

  async listFiles(directory: string): Promise<BackupFileEntry[]> {
    if (!await exists(directory)) return []
    const entries = await readDir(directory)
    const files: BackupFileEntry[] = []
    for (const entry of entries) {
      if (!entry.isFile) continue
      const path = await join(directory, entry.name)
      const info = await stat(path)
      files.push({ path, name: entry.name, modifiedAt: info.mtime?.getTime() ?? 0 })
    }
    return files
  }

  async checkpointWal() {
    await invoke('checkpoint_focus_mind_database')
  }

  async copyFile(source: string, destination: string) {
    await copyFile(source, destination)
  }

  async validateDatabase(path: string, expectedSchemaVersion: number) {
    await invoke('validate_focus_mind_database', { path, expectedSchemaVersion })
  }

  async replaceFile(source: string, destination: string) {
    if (await exists(destination)) await remove(destination)
    await rename(source, destination)
  }

  async removeFile(path: string) {
    if (await exists(path)) await remove(path)
  }

  async chooseExportDestination(suggestedName: string) {
    return save({
      title: '导出土豆栗丝特备份',
      defaultPath: suggestedName,
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
    })
  }

  async chooseImportCandidate() {
    return open({
      title: '导入土豆栗丝特备份',
      multiple: false,
      directory: false,
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
    })
  }

  async closeDatabase() {
    await Database.get(FOCUS_MIND_DATABASE_URL).close(FOCUS_MIND_DATABASE_URL)
  }

  async migrateAndReopenDatabase() {
    await Database.load(FOCUS_MIND_DATABASE_URL)
  }
}

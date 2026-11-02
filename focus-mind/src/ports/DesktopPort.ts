export type RuntimeMode = 'preview' | 'tauri'

export interface DesktopPort {
  readonly mode: RuntimeMode
  createDailyBackup(): Promise<void>
  exportBackup(): Promise<void>
  importBackup(): Promise<void>
}

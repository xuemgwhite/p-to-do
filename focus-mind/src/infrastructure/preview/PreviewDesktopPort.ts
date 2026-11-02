import type { DesktopPort } from '../../ports/DesktopPort'

export class PreviewDesktopPort implements DesktopPort {
  readonly mode = 'preview' as const

  async createDailyBackup(): Promise<void> {
    throw new Error('浏览器预览不支持备份操作。')
  }

  async exportBackup(): Promise<void> {
    throw new Error('浏览器预览不支持备份操作。')
  }

  async importBackup(): Promise<void> {
    throw new Error('浏览器预览不支持备份操作。')
  }
}

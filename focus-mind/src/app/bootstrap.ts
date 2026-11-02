import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ScheduleService } from '../application/ScheduleService'
import { StatisticsService } from '../application/StatisticsService'
import { TaskService } from '../application/TaskService'
import { TimerService } from '../application/TimerService'
import { PreviewDesktopPort } from '../infrastructure/preview/PreviewDesktopPort'
import { PreviewRepository } from '../infrastructure/preview/PreviewRepository'
import type { DesktopPort } from '../ports/DesktopPort'
import type { FocusMindRepository } from '../ports/FocusMindRepository'
import { App } from './App'
import { QuickTasksWindow } from '../ui/quick-tasks/QuickTasksWindow'

export interface ApplicationRuntime {
  repository: FocusMindRepository
  desktopPort: DesktopPort
  taskService: TaskService
  timerService: TimerService
  scheduleService: ScheduleService
  statisticsService: StatisticsService
}

export function createApplicationRuntime(
  repository: FocusMindRepository = new PreviewRepository(),
  desktopPort: DesktopPort = new PreviewDesktopPort(),
): ApplicationRuntime {
  return {
    repository,
    desktopPort,
    taskService: new TaskService(repository),
    timerService: new TimerService(repository),
    scheduleService: new ScheduleService(repository),
    statisticsService: new StatisticsService(repository),
  }
}

export function bootstrapApplication(
  desktopPort?: DesktopPort,
  repository?: FocusMindRepository,
): Promise<ApplicationRuntime> {
  return resolveRuntimeAdapters(desktopPort, repository).then((runtime) => {
    const container = document.getElementById('root')

    if (!container) {
      throw new Error('土豆栗丝特需要一个根元素。')
    }

    createRoot(container).render(createElement(App, {
      runtimeMode: runtime.desktopPort.mode,
      repository: runtime.repository,
      taskService: runtime.taskService,
      timerService: runtime.timerService,
      scheduleService: runtime.scheduleService,
      statisticsService: runtime.statisticsService,
    }))
    return runtime
  })
}

export function bootstrapQuickTasks(
  desktopPort?: DesktopPort,
  repository?: FocusMindRepository,
): Promise<ApplicationRuntime> {
  return resolveRuntimeAdapters(desktopPort, repository, false).then((runtime) => {
    const container = document.getElementById('root')
    if (!container) throw new Error('今日任务悬浮窗需要一个根元素。')

    createRoot(container).render(createElement(QuickTasksWindow, {
      scheduleService: runtime.scheduleService,
      taskService: runtime.taskService,
      timerService: runtime.timerService,
      runtimeMode: runtime.desktopPort.mode,
    }))
    return runtime
  })
}

async function resolveRuntimeAdapters(
  desktopPort?: DesktopPort,
  repository?: FocusMindRepository,
  createBackup = true,
) {
  if (desktopPort || repository) {
    return createApplicationRuntime(
      repository ?? new PreviewRepository(),
      desktopPort ?? new PreviewDesktopPort(),
    )
  }

  if ('__TAURI_INTERNALS__' in window) {
    const [{ TauriDesktopPort }, { openFocusMindRepository }] = await Promise.all([
      import('../infrastructure/tauri/TauriDesktopPort'),
      import('../infrastructure/sqlite/SqliteRepository'),
    ])
    const tauriDesktopPort = new TauriDesktopPort()
    const runtime = createApplicationRuntime(await openFocusMindRepository(), tauriDesktopPort)
    if (createBackup) {
      try {
        await tauriDesktopPort.createDailyBackup()
      } catch (error) {
        console.error('创建每日备份失败，应用将继续启动。', error)
      }
    }
    return runtime
  }

  return createApplicationRuntime(new PreviewRepository(), new PreviewDesktopPort())
}

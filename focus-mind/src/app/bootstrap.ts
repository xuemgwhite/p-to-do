import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ScheduleService } from '../application/ScheduleService'
import { TaskService } from '../application/TaskService'
import { TimerService } from '../application/TimerService'
import { PreviewDesktopPort } from '../infrastructure/preview/PreviewDesktopPort'
import { PreviewRepository } from '../infrastructure/preview/PreviewRepository'
import type { DesktopPort } from '../ports/DesktopPort'
import type { FocusMindRepository } from '../ports/FocusMindRepository'
import { App } from './App'

export interface ApplicationRuntime {
  repository: FocusMindRepository
  desktopPort: DesktopPort
  taskService: TaskService
  timerService: TimerService
  scheduleService: ScheduleService
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
  }
}

export function bootstrapApplication(
  desktopPort?: DesktopPort,
  repository?: FocusMindRepository,
): Promise<ApplicationRuntime> {
  return resolveRuntimeAdapters(desktopPort, repository).then((runtime) => {
    const container = document.getElementById('root')

    if (!container) {
      throw new Error('Focus Mind requires a root element.')
    }

    createRoot(container).render(createElement(App, {
      runtimeMode: runtime.desktopPort.mode,
      repository: runtime.repository,
      taskService: runtime.taskService,
      timerService: runtime.timerService,
      scheduleService: runtime.scheduleService,
    }))
    return runtime
  })
}

async function resolveRuntimeAdapters(
  desktopPort?: DesktopPort,
  repository?: FocusMindRepository,
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
    await tauriDesktopPort.createDailyBackup()
    return runtime
  }

  return createApplicationRuntime(new PreviewRepository(), new PreviewDesktopPort())
}

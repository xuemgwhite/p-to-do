import type { TaskService } from '../../application/TaskService'
import type { TimerService } from '../../application/TimerService'
import type { FocusSession, Task } from '../../domain/models'
import type { FocusMindRepository } from '../../ports/FocusMindRepository'

export async function completeThemeTask({ task, activeSession, completedAt, repository, taskService, timerService }: {
  task: Task
  activeSession: FocusSession | null
  completedAt: Date
  repository: FocusMindRepository
  taskService: TaskService
  timerService: TimerService
}): Promise<void> {
  if (activeSession?.taskId === task.id) await timerService.stop(completedAt)
  await taskService.completeTask(task.id, completedAt)
  if (task.recurrenceType !== 'none') {
    await repository.saveTask({ ...task, completedAt: completedAt.toISOString() })
  }
}

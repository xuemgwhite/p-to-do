import type {
  FocusSession,
  Goal,
  Id,
  LocalDate,
  Task,
  TaskOccurrence,
  Theme,
} from '../domain/models'

export interface DeletionImpact {
  themes: number
  goals: number
  tasks: number
  occurrences: number
  focusSessions: number
}

export interface FocusMindRepository {
  /**
   * Atomically commits buffered writes. Reads through the transaction
   * repository reject immediately. Failed nested transactions discard the
   * writes added since their in-memory checkpoint.
   */
  transaction<T>(work: (repo: FocusMindRepository) => Promise<T>): Promise<T>
  listThemes(): Promise<Theme[]>
  listGoals(themeId: Id): Promise<Goal[]>
  listTasks(goalId: Id): Promise<Task[]>
  getTask(id: Id): Promise<Task | null>
  saveTheme(theme: Theme): Promise<void>
  saveGoal(goal: Goal): Promise<void>
  saveTask(task: Task): Promise<void>
  upsertOccurrences(items: TaskOccurrence[]): Promise<void>
  listOccurrences(from: LocalDate, to: LocalDate): Promise<TaskOccurrence[]>
  listOccurrencesForTask(taskId: Id): Promise<TaskOccurrence[]>
  saveFocusSession(session: FocusSession): Promise<void>
  deleteFocusSession(id: Id): Promise<void>
  listFocusSessions(from: string, to: string): Promise<FocusSession[]>
  listFocusSessionsForTask(taskId: Id): Promise<FocusSession[]>
  getActiveFocusSession(): Promise<FocusSession | null>
  countDeletionImpact(kind: 'theme' | 'goal' | 'task', id: Id): Promise<DeletionImpact>
  deleteCascade(kind: 'theme' | 'goal' | 'task', id: Id): Promise<void>
}

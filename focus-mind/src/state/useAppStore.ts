import { create } from 'zustand'
import type { Goal, Id, Task, Theme } from '../domain/models'

export type EntityKind = 'theme' | 'goal' | 'task'
export type EntityMode = 'create' | 'edit'

export interface ContextMenuState {
  kind: EntityKind
  id: Id
  x: number
  y: number
}

export interface EntityDialogState {
  kind: EntityKind
  mode: EntityMode
  id?: Id
}

interface AppState {
  themes: Theme[]
  goals: Goal[]
  tasks: Task[]
  selectedThemeId: Id | null
  selectedGoalId: Id | null
  loading: boolean
  error: string | null
  contextMenu: ContextMenuState | null
  entityDialog: EntityDialogState | null
  deleteTarget: { kind: EntityKind; id: Id; name: string } | null
  completionTaskId: Id | null
  setThemes: (themes: Theme[]) => void
  setCatalog: (themes: Theme[], goals: Goal[], tasks: Task[]) => void
  selectTheme: (id: Id | null) => void
  selectGoal: (id: Id | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  openContextMenu: (menu: ContextMenuState) => void
  closeContextMenu: () => void
  openEntityDialog: (dialog: EntityDialogState) => void
  closeEntityDialog: () => void
  openDeleteDialog: (target: { kind: EntityKind; id: Id; name: string }) => void
  closeDeleteDialog: () => void
  openCompletionDialog: (taskId: Id) => void
  closeCompletionDialog: () => void
}

const initialState = {
  themes: [] as Theme[],
  goals: [] as Goal[],
  tasks: [] as Task[],
  selectedThemeId: null as Id | null,
  selectedGoalId: null as Id | null,
  loading: true,
  error: null as string | null,
  contextMenu: null as ContextMenuState | null,
  entityDialog: null as EntityDialogState | null,
  deleteTarget: null as { kind: EntityKind; id: Id; name: string } | null,
  completionTaskId: null as Id | null,
}

export const useAppStore = create<AppState>((set) => ({
  ...initialState,
  setThemes: (themes) => set({ themes, loading: false }),
  setCatalog: (themes, goals, tasks) => set({ themes, goals, tasks, loading: false }),
  selectTheme: (selectedThemeId) => set({ selectedThemeId, selectedGoalId: null, contextMenu: null }),
  selectGoal: (selectedGoalId) => set({ selectedGoalId, contextMenu: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
  openEntityDialog: (entityDialog) => set({ entityDialog, contextMenu: null }),
  closeEntityDialog: () => set({ entityDialog: null }),
  openDeleteDialog: (deleteTarget) => set({ deleteTarget, contextMenu: null }),
  closeDeleteDialog: () => set({ deleteTarget: null }),
  openCompletionDialog: (completionTaskId) => set({ completionTaskId }),
  closeCompletionDialog: () => set({ completionTaskId: null }),
}))

export function resetAppStore(): void {
  useAppStore.setState(initialState)
}

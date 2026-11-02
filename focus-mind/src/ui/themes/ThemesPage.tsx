import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { TaskService } from '../../application/TaskService'
import { ApplicationError } from '../../application/TaskService'
import type { TimerService } from '../../application/TimerService'
import type { FocusSession, Goal, LocalDate, Task, Theme } from '../../domain/models'
import type { FocusMindRepository } from '../../ports/FocusMindRepository'
import { useAppStore, type EntityKind } from '../../state/useAppStore'
import { DeleteDialog } from '../shared/DeleteDialog'
import { EntityDialog, type EntityValue } from '../shared/EntityDialog'
import { GoalColumn } from './GoalColumn'
import { TaskColumn } from './TaskColumn'
import { ThemeColumn } from './ThemeColumn'
import { completeThemeTask } from './completeThemeTask'

interface ThemesPageProps {
  repository: FocusMindRepository
  taskService: TaskService
  timerService: TimerService
  now?: () => Date
  createId?: () => string
  confirmDiscard?: () => boolean
  onNavigate?: (page: 'themes' | 'schedule' | 'timer') => void
  embeddedInShell?: boolean
}

export function ThemesPage({ repository, taskService, timerService, now = () => new Date(), createId = () => crypto.randomUUID(), confirmDiscard, onNavigate = () => undefined, embeddedInShell = false }: ThemesPageProps) {
  const state = useAppStore()
  const {
    themes,
    selectedThemeId,
    selectedGoalId,
    setCatalog,
    setError,
    setLoading,
    selectGoal,
    selectTheme,
  } = state
  const [activeSession, setActiveSession] = useState<FocusSession | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  function rememberFocus(force = false) {
    if (!force && returnFocusRef.current !== null) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }

  function restoreFocus() {
    const target = returnFocusRef.current
    returnFocusRef.current = null
    queueMicrotask(() => target?.focus())
  }

  function closeContextMenu(restore = true) {
    state.closeContextMenu()
    if (restore) restoreFocus()
  }

  function openEntityDialog(dialog: Parameters<typeof state.openEntityDialog>[0]) {
    rememberFocus()
    state.openEntityDialog(dialog)
  }

  function closeEntityDialog() { state.closeEntityDialog(); restoreFocus() }
  function closeDeleteDialog() { state.closeDeleteDialog(); restoreFocus() }
  function closeCompletionDialog() { state.closeCompletionDialog(); restoreFocus() }

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const themes = await repository.listThemes()
      const goalGroups = await Promise.all(themes.map((theme) => repository.listGoals(theme.id)))
      const goals = goalGroups.flat()
      const taskGroups = await Promise.all(goals.map((goal) => repository.listTasks(goal.id)))
      const tasks = taskGroups.flat()
      const active = await repository.getActiveFocusSession()
      setCatalog(themes, goals, tasks)
      setActiveSession(active)
      setError(null)
    } catch (error) {
      setError(messageFor(error))
    }
  }, [repository, setCatalog, setError, setLoading])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (themes.length === 0) {
      if (selectedThemeId !== null) selectTheme(null)
      return
    }
    if (!themes.some((theme) => theme.id === selectedThemeId)) selectTheme(themes[0]?.id ?? null)
  }, [selectedThemeId, selectTheme, themes])
  const visibleGoals = useMemo(() => state.goals.filter((goal) => goal.themeId === selectedThemeId), [state.goals, selectedThemeId])
  useEffect(() => {
    if (!visibleGoals.some((goal) => goal.id === selectedGoalId)) selectGoal(visibleGoals[0]?.id ?? null)
  }, [selectGoal, selectedGoalId, visibleGoals])
  const visibleTasks = useMemo(() => state.tasks.filter((task) => task.goalId === selectedGoalId), [state.tasks, selectedGoalId])
  const taskCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const task of state.tasks) counts.set(task.goalId, (counts.get(task.goalId) ?? 0) + 1)
    return counts
  }, [state.tasks])

  const initialEntity = useMemo(() => {
    const dialog = state.entityDialog
    if (dialog === null) return null
    if (dialog.mode === 'edit') {
      if (dialog.kind === 'theme') return state.themes.find((theme) => theme.id === dialog.id) ?? null
      if (dialog.kind === 'goal') return state.goals.find((goal) => goal.id === dialog.id) ?? null
      return state.tasks.find((task) => task.id === dialog.id) ?? null
    }
    const id = createId()
    if (dialog.kind === 'theme') return { id, name: '', color: '#FF3B30', sortOrder: nextSortOrder(state.themes) } satisfies Theme
    if (dialog.kind === 'goal') return { id, themeId: state.selectedThemeId ?? state.themes[0]?.id ?? '', name: '', sortOrder: nextSortOrder(state.goals.filter((goal) => goal.themeId === state.selectedThemeId)) } satisfies Goal
    return { id, goalId: state.selectedGoalId ?? state.goals[0]?.id ?? '', name: '', description: '', startDate: '' as LocalDate, endDate: '' as LocalDate, recurrenceType: 'none', weeklyQuota: null, completedAt: null, sortOrder: nextSortOrder(state.tasks.filter((task) => task.goalId === state.selectedGoalId)) } satisfies Task
  }, [createId, state.entityDialog, state.goals, state.selectedGoalId, state.selectedThemeId, state.tasks, state.themes])

  async function saveEntity(value: EntityValue) {
    if ('color' in value) await repository.saveTheme(value)
    else if (!('description' in value)) await repository.saveGoal(value)
    else await repository.saveTask(value)
    await refresh()
  }

  async function reorder<T extends Theme | Goal | Task>(items: T[]) {
    await repository.transaction(async (transaction) => {
      for (const [index, item] of items.entries()) {
        const normalized = { ...item, sortOrder: index }
        if ('color' in normalized) await transaction.saveTheme(normalized)
        else if (!('description' in normalized)) await transaction.saveGoal(normalized)
        else await transaction.saveTask(normalized)
      }
    })
    await refresh()
  }

  async function startTask(task: Task) {
    try {
      if (activeSession?.taskId === task.id) await timerService.stop(now())
      else await timerService.start(task.id, now())
      await refresh()
    } catch (error) { state.setError(messageFor(error)) }
  }

  async function completeTask(task: Task) {
    try {
      await completeThemeTask({ task, activeSession, completedAt: now(), repository, taskService, timerService })
      await refresh()
    } catch (error) {
      if (error instanceof ApplicationError && error.code === 'MANUAL_SESSION_REQUIRED') { rememberFocus(); state.openCompletionDialog(task.id) }
      else state.setError(messageFor(error))
    }
  }

  async function restoreTask(task: Task) {
    try { await repository.saveTask({ ...task, completedAt: null }); await refresh() }
    catch (error) { state.setError(messageFor(error)) }
  }

  function openContext(kind: EntityKind, id: string, x: number, y: number) { rememberFocus(true); state.openContextMenu({ kind, id, x, y }) }
  const contextEntity = state.contextMenu === null ? null : findEntity(state.contextMenu.kind, state.contextMenu.id, state.themes, state.goals, state.tasks)

  return <main className={`themes-workspace${embeddedInShell ? ' embedded' : ''}`} onClick={() => { if (state.contextMenu) closeContextMenu() }}>
    {!embeddedInShell && <ThemeColumn themes={state.themes} selectedId={state.selectedThemeId} onSelect={state.selectTheme} onAdd={() => openEntityDialog({ kind: 'theme', mode: 'create' })} onContextMenu={(theme, x, y) => openContext('theme', theme.id, x, y)} onReorder={reorder} onNavigate={onNavigate} />}
    <GoalColumn goals={visibleGoals} taskCounts={taskCounts} selectedId={state.selectedGoalId} canAdd={state.selectedThemeId !== null} onSelect={state.selectGoal} onAdd={() => state.selectedThemeId && openEntityDialog({ kind: 'goal', mode: 'create' })} onContextMenu={(goal, x, y) => openContext('goal', goal.id, x, y)} onReorder={reorder} />
    <TaskColumn tasks={visibleTasks} activeSession={activeSession} canAdd={state.selectedGoalId !== null} onAdd={() => state.selectedGoalId && openEntityDialog({ kind: 'task', mode: 'create' })} onStart={startTask} onComplete={completeTask} onRestore={restoreTask} onContextMenu={(task, x, y) => openContext('task', task.id, x, y)} onReorder={reorder} />

    {state.loading && state.themes.length === 0 && <div className="loading-state" role="status">正在载入主题…</div>}
    {state.error && <div className="error-toast" role="alert"><span>{state.error}</span><button type="button" onClick={() => { state.setError(null); void refresh() }}>重试</button></div>}
    {state.contextMenu && contextEntity && <div className="context-menu" role="menu" style={{ left: state.contextMenu.x, top: state.contextMenu.y }} onKeyDown={(event) => { if (event.key === 'Escape') closeContextMenu() }} onClick={(event) => event.stopPropagation()}>
      <button autoFocus type="button" aria-label={`编辑${labelFor(state.contextMenu.kind)}`} onClick={() => openEntityDialog({ kind: state.contextMenu?.kind ?? 'task', mode: 'edit', id: state.contextMenu?.id })}>编辑</button>
      <button className="danger-item" type="button" aria-label={`删除${labelFor(state.contextMenu.kind)}`} onClick={() => state.openDeleteDialog({ kind: state.contextMenu?.kind ?? 'task', id: state.contextMenu?.id ?? '', name: contextEntity.name })}>删除</button>
    </div>}
    {state.entityDialog && initialEntity && <EntityDialog kind={state.entityDialog.kind} mode={state.entityDialog.mode} initial={initialEntity} themes={state.themes} goals={state.goals} confirmDiscard={confirmDiscard} onClose={closeEntityDialog} onSubmit={saveEntity} />}
    {state.deleteTarget && <DeleteDialog {...state.deleteTarget} repository={repository} onClose={closeDeleteDialog} onDeleted={refresh} />}
    {state.completionTaskId && <CompletionDialog taskId={state.completionTaskId} now={now()} taskService={taskService} onClose={closeCompletionDialog} onCompleted={refresh} onError={state.setError} />}
  </main>
}

function CompletionDialog({ taskId, now, taskService, onClose, onCompleted, onError }: { taskId: string; now: Date; taskService: TaskService; onClose: () => void; onCompleted: () => Promise<void>; onError: (error: string | null) => void }) {
  const [date, setDate] = useState(formatDateLocal(now))
  const [startedTime, setStartedTime] = useState(formatTimeLocal(new Date(now.getTime() - 30 * 60_000)))
  const [endedTime, setEndedTime] = useState(formatTimeLocal(now))
  const [saving, setSaving] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true)
    const endedAt = new Date(`${date}T${endedTime}:00`)
    const sameDayStart = new Date(`${date}T${startedTime}:00`)
    const startedAt = sameDayStart > endedAt ? new Date(sameDayStart.getTime() - 86_400_000) : sameDayStart
    try { await taskService.completeTask(taskId, endedAt, { startedAt, endedAt }); await onCompleted(); onClose() }
    catch (error) { onError(messageFor(error)); setSaving(false) }
  }
  return <div className="dialog-backdrop" onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}><section className="entity-dialog completion-dialog" role="dialog" aria-modal="true" aria-label="完成任务"><header className="dialog-header"><div><span className="eyebrow">补填专注记录</span><h2>完成任务</h2></div><button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>×</button></header><p>该任务还没有专注记录，请填写本次实际专注时间。</p><form onSubmit={submit}><label className="field"><span>完成日期</span><input autoFocus type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label><div className="field-row"><label className="field"><span>开始时刻</span><input className="numeric" type="time" step="60" required value={startedTime} onChange={(event) => setStartedTime(event.target.value)} /></label><label className="field"><span>完成时刻</span><input className="numeric" type="time" step="60" required value={endedTime} onChange={(event) => setEndedTime(event.target.value)} /></label></div><footer className="dialog-actions"><button className="button-secondary" type="button" onClick={onClose}>取消</button><button className="button-primary" type="submit" disabled={saving}>{saving ? '完成中…' : '确认完成'}</button></footer></form></section></div>
}

function nextSortOrder(items: Array<{ sortOrder: number }>): number { return items.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1 }
function labelFor(kind: EntityKind): string { return kind === 'theme' ? '主题' : kind === 'goal' ? '目标' : '任务' }
function findEntity(kind: EntityKind, id: string, themes: Theme[], goals: Goal[], tasks: Task[]) { return kind === 'theme' ? themes.find((item) => item.id === id) : kind === 'goal' ? goals.find((item) => item.id === id) : tasks.find((item) => item.id === id) }
function messageFor(error: unknown): string { return error instanceof Error ? error.message : '操作失败，请重试' }
function formatDateLocal(date: Date): string { const pad = (value: number) => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` }
function formatTimeLocal(date: Date): string { return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }

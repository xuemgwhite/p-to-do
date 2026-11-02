import { useMemo, useState, type FormEvent } from 'react'
import type { Goal, LocalDate, RecurrenceType, Task, Theme } from '../../domain/models'
import type { EntityKind, EntityMode } from '../../state/useAppStore'
import { isValidLocalDate } from './entityValidation'

const themePalette = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#5AC8FA', '#007AFF', '#5856D6', '#FF2D55', '#AF52DE', '#8E8E93', '#555555', '#E5B4A1']
export type EntityValue = Theme | Goal | Task

interface EntityDialogProps {
  kind: EntityKind
  mode: EntityMode
  initial: EntityValue
  themes: Theme[]
  goals: Goal[]
  confirmDiscard?: () => boolean
  onClose: () => void
  onSubmit: (value: EntityValue) => Promise<void>
}

const kindLabel: Record<EntityKind, string> = { theme: '主题', goal: '目标', task: '任务' }

export function EntityDialog({ kind, mode, initial, themes, goals, confirmDiscard = () => window.confirm('放弃未保存的更改？'), onClose, onSubmit }: EntityDialogProps) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const title = `${mode === 'create' ? '新增' : '编辑'}${kindLabel[kind]}`
  const isThemeDialog = kind === 'theme'
  const displayTitle = isThemeDialog ? `${mode === 'create' ? '创建' : '编辑'}主题` : title
  const dirty = useMemo(() => JSON.stringify(value) !== JSON.stringify(initial), [initial, value])

  function requestClose() {
    if (dirty && !confirmDiscard()) return
    onClose()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const name = value.name.trim()
    if (name.length === 0) return setError('名称不能为空')
    const normalized = { ...value, name } as EntityValue
    if (kind === 'task') {
      const task = normalized as Task
      if (task.startDate.length === 0) return setError('开始日期必填')
      if (task.endDate.length === 0) return setError('结束日期必填')
      if (!isValidLocalDate(task.startDate) || !isValidLocalDate(task.endDate)) return setError('日期格式无效')
      if (task.endDate < task.startDate) return setError('结束日期不能早于开始日期')
      if (task.recurrenceType === 'weekly_quota' && (task.weeklyQuota ?? 0) < 1) return setError('每周次数至少为 1')
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit(normalized)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return <div className="dialog-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === 'Escape') requestClose() }} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose() }}>
    <section className={`entity-dialog${isThemeDialog ? ' create-theme-dialog' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="dialog-header">{isThemeDialog ? <h2>{displayTitle}</h2> : <div><span className="eyebrow">FOCUS MIND</span><h2>{displayTitle}</h2></div>}<button className="icon-button" type="button" aria-label="关闭" onClick={requestClose}>×</button></header>
      <form onSubmit={submit}>
        <label className="field"><span>名称</span><input autoFocus placeholder={isThemeDialog ? '输入主题名称...' : undefined} value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value } as EntityValue)} /></label>
        {kind === 'theme' && <fieldset className="field color-field"><legend>颜色</legend><div className="color-palette">
          {themePalette.map((color) => <button key={color} type="button" className="color-swatch" aria-label={`选择颜色 ${color}`} aria-pressed={(value as Theme).color === color} style={{ backgroundColor: color }} onClick={() => setValue({ ...value, color } as Theme)}><span aria-hidden="true" /></button>)}
        </div></fieldset>}
        {kind === 'goal' && <label className="field"><span>所属主题</span><select value={(value as Goal).themeId} onChange={(event) => setValue({ ...value, themeId: event.target.value } as Goal)}>{themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>}
        {kind === 'task' && <TaskFields task={value as Task} goals={goals} setTask={(task) => setValue(task)} />}
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="dialog-actions"><button className="button-secondary" type="button" onClick={requestClose}>取消</button><button className="button-primary" type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</button></footer>
      </form>
    </section>
  </div>
}

function TaskFields({ task, goals, setTask }: { task: Task; goals: Goal[]; setTask: (task: Task) => void }) {
  return <>
    <label className="field"><span>描述</span><textarea rows={3} value={task.description} onChange={(event) => setTask({ ...task, description: event.target.value })} /></label>
    <label className="field"><span>所属目标</span><select value={task.goalId} onChange={(event) => setTask({ ...task, goalId: event.target.value })}>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}</select></label>
    <div className="field-row"><label className="field"><span>开始日期</span><input type="date" value={task.startDate} onChange={(event) => setTask({ ...task, startDate: event.target.value as LocalDate })} /></label><label className="field"><span>结束日期</span><input type="date" value={task.endDate} onChange={(event) => setTask({ ...task, endDate: event.target.value as LocalDate })} /></label></div>
    <label className="field"><span>重复类型</span><select value={task.recurrenceType} onChange={(event) => { const recurrenceType = event.target.value as RecurrenceType; setTask({ ...task, recurrenceType, weeklyQuota: recurrenceType === 'weekly_quota' ? (task.weeklyQuota ?? 1) : null }) }}><option value="none">不重复</option><option value="daily">每天</option><option value="weekly_quota">每周完成 N 次</option></select></label>
    {task.recurrenceType === 'weekly_quota' && <label className="field"><span>每周次数</span><input type="number" min="1" max="7" value={task.weeklyQuota ?? 1} onChange={(event) => setTask({ ...task, weeklyQuota: Number(event.target.value) })} /></label>}
  </>
}

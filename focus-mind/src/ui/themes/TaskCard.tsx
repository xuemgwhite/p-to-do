import { useSortable } from '@dnd-kit/sortable'
import type { Task } from '../../domain/models'
import { recurrenceLabel } from '../../domain/taskLabels'

interface TaskCardProps {
  task: Task
  active: boolean
  completed: boolean
  onStart: (task: Task) => Promise<void>
  onComplete: (task: Task) => Promise<void>
  onRestore: (task: Task) => Promise<void>
  onContextMenu: (task: Task, x: number, y: number) => void
  onKeyboardMove: (direction: -1 | 1) => void
}

export function TaskCard({ task, active, completed, onStart, onComplete, onRestore, onContextMenu, onKeyboardMove }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const recurrence = recurrenceLabel(task)
  return <article
    ref={setNodeRef}
    {...attributes}
    {...listeners}
    aria-label={`拖动任务 ${task.name}`}
    onKeyDown={(event) => { if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); onKeyboardMove(event.key === 'ArrowUp' ? -1 : 1) } else listeners?.onKeyDown?.(event) }}
    style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})` : undefined, transition }}
    className={`task-card draggable-surface${completed ? ' completed' : ''}${active ? ' active' : ''}${isDragging ? ' is-dragging' : ''}`}
    data-testid={`task-card-${task.id}`}
    tabIndex={0}
    onContextMenu={(event) => { event.preventDefault(); onContextMenu(task, event.clientX, event.clientY) }}
  >
    <div className="task-card-top">
      <label className="completion-control">
        <input type="checkbox" checked={completed} aria-label={`${completed ? '恢复' : '完成'} ${task.name}`} onChange={() => { void (completed ? onRestore(task) : onComplete(task)) }} />
        <span aria-hidden="true">✓</span>
      </label>
      <div className="task-copy"><h3>{task.name}</h3>{task.description && <p>{task.description}</p>}</div>
      {!completed && <button className={`start-button${active ? ' active' : ''}`} type="button" aria-label={`${active ? '结束' : '开始'} ${task.name}`} onClick={() => { void onStart(task) }}>{active ? '■' : '▶'}</button>}
    </div>
    {!completed && <div className="task-meta">
      {active && <span className="tag active-tag">▶ 专注中 <i /></span>}
      {task.endDate.length > 0 && <span className="tag deadline-tag">{formatDate(task.endDate)} 结束</span>}
      {recurrence && <span className="tag repeat-tag">↻ {recurrence}</span>}
    </div>}
  </article>
}

function formatDate(date: string): string {
  const [, month, day] = date.split('-')
  return `${Number(month)}月${Number(day)}日`
}

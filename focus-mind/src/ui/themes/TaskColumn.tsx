import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { FocusSession, Task } from '../../domain/models'
import { TaskCard } from './TaskCard'

interface TaskColumnProps {
  tasks: Task[]
  activeSession: FocusSession | null
  canAdd: boolean
  onAdd: () => void
  onStart: (task: Task) => Promise<void>
  onComplete: (task: Task) => Promise<void>
  onRestore: (task: Task) => Promise<void>
  onContextMenu: (task: Task, x: number, y: number) => void
  onReorder: (tasks: Task[]) => Promise<void>
}

export function TaskColumn(props: TaskColumnProps) {
  const pending = props.tasks.filter((task) => task.completedAt === null)
  const completed = props.tasks.filter((task) => task.completedAt !== null)
  const reorderSection = (section: 'pending' | 'completed', reordered: Task[]) => props.onReorder(section === 'pending' ? [...reordered, ...completed] : [...pending, ...reordered])
  return <section className="task-column workspace-column" aria-label="任务栏">
    <header className="column-header task-header"><h1>任务</h1><button className="header-add" type="button" aria-label="新增任务" disabled={!props.canAdd} onClick={props.onAdd}>＋</button></header>
    <div className="task-scroll column-scroll">
      {pending.length === 0 && completed.length === 0 && <button className="empty-action task-empty" type="button" disabled={!props.canAdd} onClick={props.onAdd}>{props.canAdd ? '添加当前目标的第一个任务' : '请先选择或创建目标'}</button>}
      {pending.length > 0 && <TaskSection {...props} label="未完成任务" tasks={pending} activeSession={props.activeSession} completed={false} onReorder={(items) => reorderSection('pending', items)} />}
      {completed.length > 0 && <section className="completed-section" role="region" aria-label="已完成任务"><div className="section-divider"><span>已完成任务</span></div><TaskSection {...props} label="已完成任务列表" tasks={completed} activeSession={null} completed onReorder={(items) => reorderSection('completed', items)} /></section>}
    </div>
  </section>
}

function TaskSection({ label, tasks, activeSession, completed, onStart, onComplete, onRestore, onContextMenu, onReorder }: TaskColumnProps & { label: string; completed: boolean }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  async function dragEnd(event: DragEndEvent) {
    if (event.over === null || event.active.id === event.over.id) return
    const oldIndex = tasks.findIndex((task) => task.id === event.active.id)
    const newIndex = tasks.findIndex((task) => task.id === event.over?.id)
    if (oldIndex >= 0 && newIndex >= 0) await onReorder(arrayMove(tasks, oldIndex, newIndex))
  }
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}><div className="task-list" role="region" aria-label={label}>
    {tasks.map((task) => <TaskCard key={task.id} task={task} active={!completed && activeSession?.taskId === task.id} completed={completed} onStart={onStart} onComplete={onComplete} onRestore={onRestore} onContextMenu={onContextMenu} onKeyboardMove={(direction) => { const index = tasks.findIndex((item) => item.id === task.id); const target = Math.max(0, Math.min(tasks.length - 1, index + direction)); if (target !== index) void onReorder(arrayMove(tasks, index, target)) }} />)}
  </div></SortableContext></DndContext>
}

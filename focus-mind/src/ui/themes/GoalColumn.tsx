import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Goal } from '../../domain/models'

interface GoalColumnProps {
  goals: Goal[]
  taskCounts: Map<string, number>
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onContextMenu: (goal: Goal, x: number, y: number) => void
  onReorder: (goals: Goal[]) => Promise<void>
  canAdd: boolean
}

export function GoalColumn({ goals, taskCounts, selectedId, onSelect, onAdd, onContextMenu, onReorder, canAdd }: GoalColumnProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  async function dragEnd(event: DragEndEvent) {
    if (event.over === null || event.active.id === event.over.id) return
    const oldIndex = goals.findIndex((goal) => goal.id === event.active.id)
    const newIndex = goals.findIndex((goal) => goal.id === event.over?.id)
    if (oldIndex >= 0 && newIndex >= 0) await onReorder(arrayMove(goals, oldIndex, newIndex))
  }
  return <section className="goal-column workspace-column" aria-label="目标栏">
    <header className="column-header"><h1>目标</h1><button className="header-add subtle" type="button" aria-label="新增目标" disabled={!canAdd} onClick={onAdd}>＋</button></header>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
      <SortableContext items={goals.map((goal) => goal.id)} strategy={verticalListSortingStrategy}>
        <div className="goal-scroll column-scroll">
          {goals.length === 0 ? canAdd ? <button className="empty-action" type="button" onClick={onAdd}>为当前主题添加目标</button> : <p className="empty-guidance">请先创建主题</p> : goals.map((goal) => <SortableGoal key={goal.id} goal={goal} count={taskCounts.get(goal.id) ?? 0} selected={goal.id === selectedId} onSelect={onSelect} onContextMenu={onContextMenu} onKeyboardMove={(direction) => { const index = goals.findIndex((item) => item.id === goal.id); const target = Math.max(0, Math.min(goals.length - 1, index + direction)); if (target !== index) void onReorder(arrayMove(goals, index, target)) }} />)}
        </div>
      </SortableContext>
    </DndContext>
  </section>
}

function SortableGoal({ goal, count, selected, onSelect, onContextMenu, onKeyboardMove }: { goal: Goal; count: number; selected: boolean; onSelect: (id: string) => void; onContextMenu: (goal: Goal, x: number, y: number) => void; onKeyboardMove: (direction: -1 | 1) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: goal.id })
  return <article ref={setNodeRef} {...attributes} {...listeners} tabIndex={0} aria-label={`拖动目标 ${goal.name}`} onKeyDown={(event) => { if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); onKeyboardMove(event.key === 'ArrowUp' ? -1 : 1) } else listeners?.onKeyDown?.(event) }} style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})` : undefined, transition }} className={`goal-item draggable-surface${selected ? ' selected' : ''}${isDragging ? ' is-dragging' : ''}`} onContextMenu={(event) => { event.preventDefault(); onContextMenu(goal, event.clientX, event.clientY) }}>
    <button className="goal-select" type="button" aria-label={`选择目标 ${goal.name}`} aria-pressed={selected} onClick={() => onSelect(goal.id)}><span>{goal.name}</span><small>{count}</small></button>
  </article>
}

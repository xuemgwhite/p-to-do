import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Theme } from '../../domain/models'

interface ThemeColumnProps {
  themes: Theme[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onContextMenu: (theme: Theme, x: number, y: number) => void
  onReorder: (themes: Theme[]) => Promise<void>
  onNavigate: (page: 'themes' | 'schedule' | 'timer') => void
}

export function ThemeColumn({ themes, selectedId, onSelect, onAdd, onContextMenu, onReorder, onNavigate }: ThemeColumnProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  async function dragEnd(event: DragEndEvent) {
    if (event.over === null || event.active.id === event.over.id) return
    const oldIndex = themes.findIndex((theme) => theme.id === event.active.id)
    const newIndex = themes.findIndex((theme) => theme.id === event.over?.id)
    if (oldIndex >= 0 && newIndex >= 0) await onReorder(arrayMove(themes, oldIndex, newIndex))
  }
  return <aside className="theme-column workspace-column" aria-label="主题栏">
    <header className="brand"><div className="brand-mark" aria-hidden="true"><img src="/app-icon.png" alt="" /></div><div><strong>Focus Mind</strong><small>PRODUCTIVITY</small></div></header>
    <nav className="primary-nav" aria-label="主导航"><button type="button" onClick={() => onNavigate('schedule')}><i aria-hidden="true">□</i>日程</button><button type="button" onClick={() => onNavigate('timer')}><i aria-hidden="true">◷</i>计时</button></nav>
    <div className="column-label"><span>主题</span><button className="tiny-add" type="button" aria-label="新增主题" onClick={onAdd}>＋</button></div>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
      <SortableContext items={themes.map((theme) => theme.id)} strategy={verticalListSortingStrategy}>
        <div className="theme-scroll column-scroll">
          {themes.length === 0 ? <button className="empty-action" type="button" onClick={onAdd}>创建第一个主题</button> : themes.map((theme) => <SortableTheme key={theme.id} theme={theme} selected={theme.id === selectedId} onSelect={onSelect} onContextMenu={onContextMenu} onKeyboardMove={(direction) => { const index = themes.findIndex((item) => item.id === theme.id); const target = Math.max(0, Math.min(themes.length - 1, index + direction)); if (target !== index) void onReorder(arrayMove(themes, index, target)) }} />)}
        </div>
      </SortableContext>
    </DndContext>
  </aside>
}

function SortableTheme({ theme, selected, onSelect, onContextMenu, onKeyboardMove }: { theme: Theme; selected: boolean; onSelect: (id: string) => void; onContextMenu: (theme: Theme, x: number, y: number) => void; onKeyboardMove: (direction: -1 | 1) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: theme.id })
  return <div ref={setNodeRef} {...attributes} {...listeners} tabIndex={0} aria-label={`拖动主题 ${theme.name}`} onKeyDown={(event) => { if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); onKeyboardMove(event.key === 'ArrowUp' ? -1 : 1) } else listeners?.onKeyDown?.(event) }} style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})` : undefined, transition }} className={`theme-sortable draggable-surface${isDragging ? ' is-dragging' : ''}`} onContextMenu={(event) => { event.preventDefault(); onContextMenu(theme, event.clientX, event.clientY) }}>
    <button className="theme-item" type="button" aria-label={`选择主题 ${theme.name}`} onClick={() => onSelect(theme.id)} aria-pressed={selected}>
      <span className="theme-dot" style={{ backgroundColor: theme.color }} /><span>{theme.name}</span>
    </button>
  </div>
}

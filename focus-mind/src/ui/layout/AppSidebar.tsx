import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Theme } from '../../domain/models'
import './app-sidebar.css'

export type AppPage = 'themes' | 'schedule' | 'timer'

interface AppSidebarProps {
  activePage: AppPage
  themes: Theme[]
  selectedThemeId: string | null
  onNavigate: (page: AppPage) => void
  onSelectTheme: (id: string) => void
  onAddTheme: () => void
  onThemeContextMenu: (theme: Theme, x: number, y: number) => void
  onReorderThemes: (themes: Theme[]) => Promise<void>
}

export function AppSidebar({ activePage, themes, selectedThemeId, onNavigate, onSelectTheme, onAddTheme, onThemeContextMenu, onReorderThemes }: AppSidebarProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  async function dragEnd(event: DragEndEvent) {
    if (event.over === null || event.active.id === event.over.id) return
    const oldIndex = themes.findIndex((theme) => theme.id === event.active.id)
    const newIndex = themes.findIndex((theme) => theme.id === event.over?.id)
    if (oldIndex >= 0 && newIndex >= 0) await onReorderThemes(arrayMove(themes, oldIndex, newIndex))
  }
  return <aside className="app-sidebar" aria-label="应用侧栏">
    <header className="app-sidebar-brand">
      <span className="app-sidebar-brand-mark" aria-hidden="true"><img src="/app-icon.png" alt="" /></span>
      <span><strong>Focus Mind</strong><small>PRODUCTIVITY</small></span>
    </header>

    <nav className="app-sidebar-nav" aria-label="主导航">
      <button type="button" aria-current={activePage === 'schedule' ? 'page' : undefined} onClick={() => onNavigate('schedule')}>
        <CalendarIcon />
        <span>日程</span>
      </button>
      <button type="button" aria-current={activePage === 'timer' ? 'page' : undefined} onClick={() => onNavigate('timer')}>
        <TimerIcon />
        <span>计时</span>
      </button>
    </nav>

    <div className="app-sidebar-section-heading"><span>主题</span><button type="button" aria-label="新增主题" onClick={onAddTheme}>＋</button></div>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={themes.map((theme) => theme.id)} strategy={verticalListSortingStrategy}><div className="app-sidebar-themes">
      {themes.length === 0
        ? <button className="app-sidebar-empty" type="button" onClick={onAddTheme}>创建第一个主题</button>
        : themes.map((theme) => <SortableSidebarTheme key={theme.id} theme={theme} selected={activePage === 'themes' && theme.id === selectedThemeId} onSelect={onSelectTheme} onContextMenu={onThemeContextMenu} />)}
    </div></SortableContext></DndContext>
  </aside>
}

function SortableSidebarTheme({ theme, selected, onSelect, onContextMenu }: { theme: Theme; selected: boolean; onSelect: (id: string) => void; onContextMenu: (theme: Theme, x: number, y: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: theme.id })
  return <button ref={setNodeRef} {...attributes} {...listeners} className={`app-sidebar-theme draggable-surface${isDragging ? ' is-dragging' : ''}`} style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }} type="button" aria-label={`选择主题 ${theme.name}`} aria-pressed={selected} onClick={() => onSelect(theme.id)} onContextMenu={(event) => { event.preventDefault(); onContextMenu(theme, event.clientX, event.clientY) }}><i style={{ backgroundColor: theme.color }} /><span>{theme.name}</span></button>
}

function CalendarIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><title>日程图标</title><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9h17M7 13h2M11 13h2M15 13h2M7 17h2M11 17h2"/></svg>
}

function TimerIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><title>计时图标</title><circle cx="12" cy="13" r="8"/><path d="M9 2.75h6M12 5v2M18.1 6.9l1.4-1.4M12 10v3.5l2.5 1.5"/><circle className="timer-icon-dot" cx="12" cy="13" r="1"/></svg>
}

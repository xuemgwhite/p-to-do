import { format, getDay, parseISO } from 'date-fns'
import type {
  FocusSessionSegment,
  MonthSchedule,
  MonthScheduleItem,
} from '../../application/ScheduleService'
import { toLocalDate } from '../../domain/dates'

interface MonthViewProps {
  schedule: MonthSchedule
  today: string
  onOpenSession: (segment: FocusSessionSegment) => void
}

export function MonthView({ schedule, today, onOpenSession }: MonthViewProps) {
  const leading = getDay(parseISO(schedule.from))
  return <div className="schedule-month-view">
    <div className="month-weekdays" aria-hidden="true">
      {['日', '一', '二', '三', '四', '五', '六'].map((day) => <span key={day}>周{day}</span>)}
    </div>
    <div className="month-grid">
      {Array.from({ length: leading }, (_, index) => <div className="month-blank" key={`blank-${index}`} />)}
      {schedule.days.map((day) => <section
        className={`schedule-month-cell${day.date === today ? ' today' : ''}`}
        data-testid={`month-cell-${day.date}`}
        key={day.date}
        aria-label={`${Number(day.date.slice(5, 7))}月${Number(day.date.slice(8))}日`}
      >
        <header>{Number(day.date.slice(8))}</header>
        <div className="month-cell-items">
          {sortMonthItems(collapseSessionItems(day.items)).map((item) => item.kind === 'session'
            ? <button
                className="month-item month-session-item"
                data-testid={`month-item-session-${item.id}`}
                key={item.id}
                type="button"
                aria-label={`专注记录 ${item.task.name} ${formatSegmentTime(item)}`}
                onClick={() => onOpenSession(item)}
                style={{ background: hexToRgba(item.theme.color, .14) }}
              ><i style={{ background: hexToRgba(item.theme.color, .42) }}>✓</i><strong>{item.task.name}</strong><small>{format(new Date(item.startedAt), 'HH:mm')}</small></button>
            : <button
                className={`month-item month-task-item ${item.state}`}
                data-testid={`month-item-task-${item.id}`}
                key={item.id}
                type="button"
                aria-label={`任务 ${item.task.name}`}
                style={{ background: hexToRgba(item.theme.color, item.state === 'completed' ? .09 : .17) }}
              ><i style={{ borderColor: hexToRgba(item.theme.color, .6), background: item.state === 'completed' ? hexToRgba(item.theme.color, .42) : 'transparent' }}>{item.state === 'completed' ? '✓' : ''}</i><strong>{item.task.name}</strong></button>)}
          {day.items.length === 0 && <span className="month-empty">—</span>}
        </div>
      </section>)}
    </div>
  </div>
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return `rgb(120 120 120 / ${alpha})`
  const [red, green, blue] = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16))
  return `rgb(${red} ${green} ${blue} / ${alpha})`
}

function sortMonthItems(items: MonthScheduleItem[]): MonthScheduleItem[] {
  return [...items].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'session' ? -1 : 1
    if (left.kind === 'session' && right.kind === 'session') {
      return left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id)
    }
    return left.id.localeCompare(right.id)
  })
}

function collapseSessionItems(items: MonthScheduleItem[]): MonthScheduleItem[] {
  const earliestSessionByTask = new Map<string, FocusSessionSegment>()
  const taskItems: MonthScheduleItem[] = []

  for (const item of items) {
    if (item.kind === 'task') {
      taskItems.push(item)
      continue
    }

    const earliest = earliestSessionByTask.get(item.taskId)
    if (earliest === undefined || item.startedAt.localeCompare(earliest.startedAt) < 0) {
      earliestSessionByTask.set(item.taskId, item)
    }
  }

  return [...earliestSessionByTask.values(), ...taskItems]
}

function formatSegmentTime(segment: FocusSessionSegment): string {
  const start = format(new Date(segment.startedAt), 'HH:mm')
  const endDate = new Date(segment.endedAt)
  const end = toLocalDate(endDate) === segment.date ? format(endDate, 'HH:mm') : '24:00'
  return `${start}–${end}`
}

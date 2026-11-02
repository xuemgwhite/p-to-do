import { format } from 'date-fns'
import type {
  FocusSessionSegment,
  WeekSchedule,
} from '../../application/ScheduleService'
import { toLocalDate } from '../../domain/dates'

interface WeekViewProps {
  schedule: WeekSchedule
  today: string
  onOpenSession: (segment: FocusSessionSegment) => void
}

interface PositionedSegment {
  segment: FocusSessionSegment
  column: number
  columnCount: number
}

const HOUR_HEIGHT = 60

export function WeekView({ schedule, today, onOpenSession }: WeekViewProps) {
  const positioned = positionSegments(schedule.timedSegments)
  return <div className="schedule-week-view">
    <section className="week-plan" role="region" aria-label="周计划">
      {schedule.unboundWeeklyQuota.length > 0 && <div className="week-unbound">
        {schedule.unboundWeeklyQuota.map((item) => <span key={item.id} style={{ '--item-color': item.theme.color, background: hexToRgba(item.theme.color, .16) } as React.CSSProperties}>{item.task.name} · {item.completed}/{item.quota} 已完成 · 还需 {item.remaining} 次</span>)}
      </div>}
      <div className="week-plan-grid">
        {schedule.days.map((day) => <div className={`week-plan-day${day.date === today ? ' today' : ''}`} key={day.date}>
          <header><span>周{weekday(day.date)}</span><strong className="numeric">{dayNumber(day.date)}</strong></header>
          <div className="week-plan-items">
            {[...day.allDay, ...day.completed].map((item) => <div className={`week-plan-item ${item.state}`} key={item.id} style={{ '--item-color': item.theme.color, background: hexToRgba(item.theme.color, item.state === 'completed' ? .08 : .16) } as React.CSSProperties}><i>{item.state === 'completed' ? '✓' : ''}</i><span>{item.task.name}</span></div>)}
          </div>
        </div>)}
      </div>
    </section>
    <section className="week-timeline-scroll" role="region" aria-label="24 小时时间轴">
      <div className="week-timeline" style={{ height: 24 * HOUR_HEIGHT }}>
        <div className="week-hours" aria-hidden="true">
          {Array.from({ length: 24 }, (_, hour) => <span className="numeric" key={hour} style={{ top: hour === 0 ? 7 : hour * HOUR_HEIGHT }}>{String(hour).padStart(2, '0')}:00</span>)}
        </div>
        <div className="week-time-columns">
          {schedule.days.map((day) => <div className="week-time-day" key={day.date}>
            {Array.from({ length: 24 }, (_, hour) => <i className="week-hour-line" key={hour} style={{ top: hour * HOUR_HEIGHT }} />)}
            {positioned.filter((item) => item.segment.date === day.date).map(({ segment, column, columnCount }) => {
              const top = minutesIntoSegmentDay(segment, 'start')
              const bottom = minutesIntoSegmentDay(segment, 'end')
              const left = column / columnCount * 100
              return <button
                key={segment.id}
                className="week-session"
                data-testid={segmentTestId(segment)}
                type="button"
                aria-label={`专注记录 ${segment.task.name} ${formatSegmentTime(segment)}`}
                style={{
                  top,
                  height: Math.max(24, bottom - top),
                  left: `${left}%`,
                  width: `${100 / columnCount}%`,
                  '--session-color': segment.theme.color,
                  background: hexToRgba(segment.theme.color, .18),
                  color: darkenHex(segment.theme.color, .42),
                } as React.CSSProperties}
                onClick={() => onOpenSession(segment)}
              ><strong>{segment.task.name}</strong><span>{formatSegmentTime(segment)}</span></button>
            })}
          </div>)}
        </div>
      </div>
    </section>
  </div>
}

function positionSegments(segments: FocusSessionSegment[]): PositionedSegment[] {
  const byDate = new Map<string, FocusSessionSegment[]>()
  for (const segment of segments) byDate.set(segment.date, [...(byDate.get(segment.date) ?? []), segment])
  const result: PositionedSegment[] = []
  for (const dateSegments of byDate.values()) {
    const sorted = [...dateSegments].sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id))
    const columns: number[] = []
    const assigned = sorted.map((segment) => {
      const start = new Date(segment.startedAt).getTime()
      let column = columns.findIndex((end) => end <= start)
      if (column === -1) column = columns.length
      columns[column] = new Date(segment.endedAt).getTime()
      return { segment, column }
    })
    const columnCount = Math.max(1, columns.length)
    result.push(...assigned.map((item) => ({ ...item, columnCount })))
  }
  return result
}

function minutesIntoSegmentDay(segment: FocusSessionSegment, edge: 'start' | 'end'): number {
  const value = new Date(edge === 'start' ? segment.startedAt : segment.endedAt)
  if (edge === 'end' && toLocalDate(value) !== segment.date) return 24 * HOUR_HEIGHT
  return value.getHours() * HOUR_HEIGHT + value.getMinutes()
}

function formatSegmentTime(segment: FocusSessionSegment): string {
  const start = format(new Date(segment.startedAt), 'HH:mm')
  const endDate = new Date(segment.endedAt)
  const end = toLocalDate(endDate) === segment.date ? format(endDate, 'HH:mm') : '24:00'
  return `${start}–${end}`
}

function segmentTestId(segment: FocusSessionSegment): string {
  return segment.id === segment.sessionId
    ? `session-segment-${segment.sessionId}`
    : `session-segment-${segment.sessionId}-${segment.date}`
}

function weekday(date: string): string {
  return ['日', '一', '二', '三', '四', '五', '六'][new Date(`${date}T00:00:00`).getDay()] ?? ''
}

function dayNumber(date: string): number {
  return Number(date.slice(-2))
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return `rgb(120 120 120 / ${alpha})`
  const [red, green, blue] = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16))
  return `rgb(${red} ${green} ${blue} / ${alpha})`
}

function darkenHex(hex: string, amount: number): string {
  const normalized = hex.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return '#4d5255'
  const channels = [0, 2, 4].map((offset) => Math.round(Number.parseInt(normalized.slice(offset, offset + 2), 16) * (1 - amount)))
  return `rgb(${channels.join(' ')})`
}

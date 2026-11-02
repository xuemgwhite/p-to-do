import { addDays, addMonths, addWeeks, addYears, parseISO } from 'date-fns'
import { useEffect, useState, type CSSProperties } from 'react'
import {
  heatmapLeadingSlots,
  statisticsRangeLabel,
  type FocusTrendPoint,
  type StatisticsPeriod,
  type StatisticsService,
  type StatisticsSnapshot,
} from '../../application/StatisticsService'
import { toLocalDate } from '../../domain/dates'
import type { LocalDate } from '../../domain/models'
import './statistics.css'

interface StatisticsPageProps {
  statisticsService: StatisticsService
  now?: () => Date
}

const systemNow = () => new Date()

export function StatisticsPage({ statisticsService, now = systemNow }: StatisticsPageProps) {
  const [period, setPeriod] = useState<StatisticsPeriod>('month')
  const [anchorDate, setAnchorDate] = useState<LocalDate>(() => toLocalDate(now()))
  const [snapshot, setSnapshot] = useState<StatisticsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void statisticsService.getSnapshot(period, parseISO(anchorDate), now())
      .then((next) => {
        if (cancelled) return
        setSnapshot(next)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '统计数据载入失败')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [anchorDate, now, period, statisticsService])

  function movePeriod(direction: -1 | 1) {
    const anchor = parseISO(anchorDate)
    const moved = period === 'day'
      ? addDays(anchor, direction)
      : period === 'week' ? addWeeks(anchor, direction)
      : period === 'month' ? addMonths(anchor, direction) : addYears(anchor, direction)
    setAnchorDate(toLocalDate(moved))
  }

  return <main className="statistics-page">
    <header className="statistics-header">
      <div>
        <span className="statistics-eyebrow">专注数据总览</span>
        <h1>统计</h1>
        {snapshot && <div className="statistics-range-controls" role="group" aria-label="统计日期范围">
          <button type="button" aria-label={previousPeriodLabel(period)} onClick={() => movePeriod(-1)}>‹</button>
          <p>{statisticsRangeLabel(snapshot)}</p>
          <button type="button" aria-label={nextPeriodLabel(period)} onClick={() => movePeriod(1)}>›</button>
        </div>}
      </div>
      <div className="statistics-period-switch" role="group" aria-label="统计周期">
        {([['day', '日'], ['week', '周'], ['month', '月'], ['year', '年']] as const).map(([value, label]) => <button
          key={value}
          type="button"
          aria-pressed={period === value}
          onClick={() => setPeriod(value)}
        >{label}</button>)}
      </div>
    </header>

    {loading && snapshot === null && <p className="statistics-status" role="status">正在整理专注数据…</p>}
    {error && <p className="statistics-status statistics-error" role="alert">{error}</p>}
    {snapshot && <div className={`statistics-dashboard${loading ? ' is-updating' : ''}`}>
      <div className="statistics-summary-grid">
        <SummaryCard
          icon={<ClockIcon />}
          title="专注时长"
          value={<DurationValue durationMs={snapshot.totalFocusMs} />}
          comparison={<Comparison current={snapshot.totalFocusMs} previous={snapshot.previousFocusMs} label={snapshot.comparisonLabel} />}
        />
        <SummaryCard
          icon={<CheckIcon />}
          title="完成任务"
          value={<><strong className="numeric">{snapshot.completedTasks}</strong><span>个</span></>}
          comparison={<Comparison current={snapshot.completedTasks} previous={snapshot.previousCompletedTasks} label={snapshot.comparisonLabel} />}
        />
      </div>

      <Heatmap snapshot={snapshot} />

      <div className="statistics-detail-grid">
        <ThemeBreakdown snapshot={snapshot} />
        <TrendChart snapshot={snapshot} />
      </div>
    </div>}
  </main>
}

function SummaryCard({ icon, title, value, comparison }: {
  icon: React.ReactNode
  title: string
  value: React.ReactNode
  comparison: React.ReactNode
}) {
  return <section className="statistics-card statistics-summary-card">
    <h2><i>{icon}</i>{title}</h2>
    <div className="statistics-summary-value">{value}</div>
    {comparison}
  </section>
}

function Comparison({ current, previous, label }: { current: number; previous: number; label: string }) {
  if (previous === 0) {
    return <p className={current > 0 ? 'comparison positive' : 'comparison neutral'}>
      {current > 0 ? '↑ 新增' : '— 持平'} <span>{label}</span>
    </p>
  }
  const percent = Math.round((current - previous) / previous * 100)
  return <p className={`comparison ${percent > 0 ? 'positive' : percent < 0 ? 'negative' : 'neutral'}`}>
    {percent > 0 ? '↑' : percent < 0 ? '↓' : '—'} {Math.abs(percent)}% <span>{label}</span>
  </p>
}

function DurationValue({ durationMs }: { durationMs: number }) {
  const totalMinutes = Math.round(durationMs / 60_000)
  return <><strong className="numeric">{Math.floor(totalMinutes / 60)}</strong><span>小时</span><strong className="numeric">{totalMinutes % 60}</strong><span>分钟</span></>
}

function Heatmap({ snapshot }: { snapshot: StatisticsSnapshot }) {
  const firstHeatmapDate = snapshot.heatmap[0]?.date
  const leading = firstHeatmapDate === undefined ? 0 : heatmapLeadingSlots(firstHeatmapDate)
  const columns = Math.ceil((leading + snapshot.heatmap.length) / 7)
  return <section className="statistics-card statistics-heatmap-card" aria-labelledby="statistics-heatmap-title">
    <header className="statistics-card-header">
      <div><h2 id="statistics-heatmap-title">专注热力图</h2><p>自 2026 年 7 月 15 日起的每日专注记录</p></div>
      <div className="heatmap-legend"><span>少</span>{[0, 1, 2, 3, 4, 5].map((level) => <i key={level} data-level={level} />)}<span>多</span></div>
    </header>
    <div className="heatmap-layout">
      <div className="heatmap-weekdays" aria-hidden="true"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>
      <div className="heatmap-scroll">
        <div className="heatmap-grid" style={{ '--heatmap-columns': columns } as CSSProperties}>
          {Array.from({ length: leading }, (_, index) => <i className="heatmap-empty" key={`empty-${index}`} />)}
          {snapshot.heatmap.map((day) => <i
            key={day.date}
            data-level={day.intensity}
            title={`${day.date} · ${formatDuration(day.durationMs)}`}
            aria-label={`${day.date}，${formatDuration(day.durationMs)}`}
          />)}
        </div>
      </div>
    </div>
  </section>
}

function ThemeBreakdown({ snapshot }: { snapshot: StatisticsSnapshot }) {
  const maximum = Math.max(0, ...snapshot.themes.map((item) => item.durationMs))
  return <section className="statistics-card statistics-theme-card" aria-labelledby="statistics-theme-title">
    <header className="statistics-card-header"><div><h2 id="statistics-theme-title">主题专注时长</h2><p>{periodSummaryLabel(snapshot.period)}累计 {formatDuration(snapshot.totalFocusMs)}</p></div></header>
    {snapshot.themes.length === 0
      ? <EmptyState>这个周期还没有专注记录</EmptyState>
      : <div className="theme-stat-list">{snapshot.themes.map((theme) => <div className="theme-stat-row" key={theme.themeId}>
          <span className="theme-stat-name"><i style={{ backgroundColor: theme.color }} />{theme.name}</span>
          <span className="theme-stat-track"><i style={{ width: `${theme.durationMs / maximum * 100}%`, backgroundColor: theme.color }} /></span>
          <span className="theme-stat-duration numeric">{formatDurationShort(theme.durationMs)}</span>
        </div>)}</div>}
  </section>
}

function TrendChart({ snapshot }: { snapshot: StatisticsSnapshot }) {
  return <section className="statistics-card statistics-trend-card" aria-labelledby="statistics-trend-title">
    <header className="statistics-card-header">
      <div><h2 id="statistics-trend-title">专注趋势</h2><p>{trendDescription(snapshot.period)}</p></div>
      <div className="trend-average"><strong className="numeric">{formatAverage(snapshot.averageFocusMs)}</strong><span>{averageLabel(snapshot.period)}</span></div>
    </header>
    <TrendSvg points={snapshot.trend} />
  </section>
}

function TrendSvg({ points }: { points: FocusTrendPoint[] }) {
  const width = 720
  const height = 270
  const plot = { left: 50, top: 18, right: 16, bottom: 42 }
  const innerWidth = width - plot.left - plot.right
  const innerHeight = height - plot.top - plot.bottom
  const maximum = niceMaximum(Math.max(0, ...points.map((point) => point.durationMs)))
  const coordinates = points.map((point, index) => ({
    x: plot.left + (points.length === 1 ? innerWidth / 2 : index / (points.length - 1) * innerWidth),
    y: plot.top + innerHeight - point.durationMs / maximum * innerHeight,
  }))
  const line = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const area = coordinates.length === 0 ? '' : `${line} L ${coordinates.at(-1)?.x} ${plot.top + innerHeight} L ${coordinates[0]?.x} ${plot.top + innerHeight} Z`

  return <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="专注趋势图">
    <defs><linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4779ef" stopOpacity=".24" /><stop offset="100%" stopColor="#4779ef" stopOpacity="0" /></linearGradient></defs>
    {[0, 1, 2, 3].map((step) => {
      const y = plot.top + step / 3 * innerHeight
      const value = maximum * (1 - step / 3)
      return <g key={step}><line x1={plot.left} y1={y} x2={width - plot.right} y2={y} /><text x={plot.left - 10} y={y + 4} textAnchor="end">{formatAxis(value)}</text></g>
    })}
    {area && <path className="trend-area" d={area} />}
    {line && <path className="trend-line" d={line} />}
    {coordinates.map((point, index) => <g key={points[index]?.key}>
      <circle cx={point.x} cy={point.y} r="4.5" />
      {(points.length <= 12 || index % 3 === 0) && <text className="trend-label" x={point.x} y={height - 13} textAnchor="middle">{points[index]?.label}</text>}
    </g>)}
  </svg>
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="statistics-empty">{children}</p>
}

function formatDuration(durationMs: number): string {
  const minutes = Math.round(durationMs / 60_000)
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

function formatDurationShort(durationMs: number): string {
  const minutes = Math.round(durationMs / 60_000)
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

function formatAverage(durationMs: number): string {
  const hours = durationMs / 3_600_000
  return hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(durationMs / 60_000)}m`
}

function formatAxis(durationMs: number): string {
  const hours = durationMs / 3_600_000
  return hours >= 1 ? `${Number(hours.toFixed(1))}h` : `${Math.round(durationMs / 60_000)}m`
}

function niceMaximum(value: number): number {
  if (value <= 0) return 60 * 60_000
  const hours = value / 3_600_000
  return Math.ceil(hours / 2) * 2 * 3_600_000 || 60 * 60_000
}

function periodSummaryLabel(period: StatisticsPeriod): string {
  return period === 'day' ? '当日' : period === 'week' ? '本周' : period === 'month' ? '本月' : '本年'
}

function trendDescription(period: StatisticsPeriod): string {
  return period === 'day' ? '当日每小时' : period === 'week' ? '本周每日' : period === 'month' ? '本月每周' : '本年每月'
}

function averageLabel(period: StatisticsPeriod): string {
  return period === 'day' ? '小时均' : period === 'week' ? '日均' : period === 'month' ? '周均' : '月均'
}

function previousPeriodLabel(period: StatisticsPeriod): string {
  return period === 'day' ? '上一日' : period === 'week' ? '上一周' : period === 'month' ? '上一月' : '上一年'
}

function nextPeriodLabel(period: StatisticsPeriod): string {
  return period === 'day' ? '下一日' : period === 'week' ? '下一周' : period === 'month' ? '下一月' : '下一年'
}

function ClockIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></svg>
}

function CheckIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.3 3.2 7.7-8" /></svg>
}

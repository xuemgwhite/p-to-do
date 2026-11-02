import { useEffect, useMemo, useState } from 'react'
import { ScheduleService } from '../application/ScheduleService'
import { StatisticsService } from '../application/StatisticsService'
import { TaskService } from '../application/TaskService'
import { TimerService } from '../application/TimerService'
import type { FocusSession } from '../domain/models'
import { toLocalDate } from '../domain/dates'
import { PreviewRepository } from '../infrastructure/preview/PreviewRepository'
import type { RuntimeMode } from '../ports/DesktopPort'
import type { FocusMindRepository } from '../ports/FocusMindRepository'
import { RecoveryDialog } from '../ui/timer/RecoveryDialog'
import { TimerPage } from '../ui/timer/TimerPage'
import { ThemesPage } from '../ui/themes/ThemesPage'
import { SchedulePage } from '../ui/schedule/SchedulePage'
import { StatisticsPage } from '../ui/statistics/StatisticsPage'
import { AppSidebar, type AppPage } from '../ui/layout/AppSidebar'
import { useAppStore } from '../state/useAppStore'
import '../styles/global.css'

interface AppProps {
  runtimeMode: RuntimeMode
  repository?: FocusMindRepository
  taskService?: TaskService
  timerService?: TimerService
  scheduleService?: ScheduleService
  statisticsService?: StatisticsService
}

export function App({ runtimeMode, repository, taskService, timerService, scheduleService, statisticsService }: AppProps) {
  const fallbackRepository = useMemo(() => new PreviewRepository(), [])
  const resolvedRepository = repository ?? fallbackRepository
  const fallbackTaskService = useMemo(() => new TaskService(resolvedRepository), [resolvedRepository])
  const fallbackTimerService = useMemo(() => new TimerService(resolvedRepository), [resolvedRepository])
  const fallbackScheduleService = useMemo(() => new ScheduleService(resolvedRepository), [resolvedRepository])
  const fallbackStatisticsService = useMemo(() => new StatisticsService(resolvedRepository), [resolvedRepository])
  const resolvedTimerService = timerService ?? fallbackTimerService
  const [recoverySession, setRecoverySession] = useState<FocusSession | null | undefined>(undefined)
  const [page, setPage] = useState<AppPage>(readPage)
  const [timerSyncRevision, setTimerSyncRevision] = useState(0)
  const previewNow = useMemo(() => previewClock(runtimeMode), [runtimeMode])
  const themes = useAppStore((state) => state.themes)
  const selectedThemeId = useAppStore((state) => state.selectedThemeId)
  const setThemes = useAppStore((state) => state.setThemes)
  const selectTheme = useAppStore((state) => state.selectTheme)
  const openEntityDialog = useAppStore((state) => state.openEntityDialog)
  const openContextMenu = useAppStore((state) => state.openContextMenu)

  useEffect(() => {
    let cancelled = false
    void resolvedTimerService.getActiveSession().then((active) => {
      if (!cancelled) setRecoverySession(active)
    })
    return () => { cancelled = true }
  }, [resolvedTimerService])
  useEffect(() => {
    let cancelled = false
    void resolvedRepository.listThemes().then((items) => { if (!cancelled) setThemes(items) })
    return () => { cancelled = true }
  }, [resolvedRepository, setThemes])
  useEffect(() => {
    const onPopState = () => setPage(readPage())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  useEffect(() => {
    if (runtimeMode !== 'tauri' || !('__TAURI_INTERNALS__' in window)) return
    let disposed = false
    let unlisten: (() => void)[] = []
    void import('@tauri-apps/api/event').then(async ({ listen }) => Promise.all([
      listen<string>('quick-task-start', (event) => {
        const params = new URLSearchParams(window.location.search)
        params.set('page', 'timer')
        params.set('timerTask', event.payload)
        window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`)
        setPage('timer')
      }),
      listen('quick-timer-changed', () => setTimerSyncRevision((revision) => revision + 1)),
    ])).then((stops) => {
      if (disposed) stops.forEach((stop) => stop())
      else unlisten = stops
    })
    return () => {
      disposed = true
      unlisten.forEach((stop) => stop())
    }
  }, [runtimeMode])

  function navigate(next: AppPage) {
    const params = new URLSearchParams(window.location.search)
    if (next === 'themes') params.delete('page')
    else params.set('page', next)
    if (next === 'schedule' && !params.has('date')) params.set('date', toLocalDate(previewNow()))
    const search = params.toString()
    window.history.pushState({}, '', `${window.location.pathname}${search ? `?${search}` : ''}`)
    setPage(next)
  }

  async function refreshRecovery() {
    setRecoverySession(await resolvedTimerService.getActiveSession())
  }

  async function reorderThemes(items: typeof themes) {
    const reordered = items.map((theme, sortOrder) => ({ ...theme, sortOrder }))
    await resolvedRepository.transaction(async (transaction) => {
      for (const theme of reordered) await transaction.saveTheme(theme)
    })
    setThemes(reordered)
  }

  if (recoverySession === undefined) {
    return <div className="app-shell">
      {runtimeMode === 'preview' && <span className="preview-badge">预览模式</span>}
      <p role="status">正在检查恢复记录…</p>
    </div>
  }

  return (
    <div className={`app-shell runtime-${runtimeMode}`}>
      <AppSidebar
        activePage={page}
        themes={themes}
        selectedThemeId={selectedThemeId}
        onNavigate={navigate}
        onSelectTheme={(id) => { selectTheme(id); navigate('themes') }}
        onAddTheme={() => { openEntityDialog({ kind: 'theme', mode: 'create' }); navigate('themes') }}
        onThemeContextMenu={(theme, x, y) => { openContextMenu({ kind: 'theme', id: theme.id, x, y }); navigate('themes') }}
        onReorderThemes={reorderThemes}
      />
      <div className="app-page">
        {page === 'timer'
          ? <TimerPage timerService={resolvedTimerService} scheduleService={scheduleService ?? fallbackScheduleService} now={previewNow} refreshSignal={timerSyncRevision} />
          : page === 'schedule'
            ? <SchedulePage repository={resolvedRepository} scheduleService={scheduleService ?? fallbackScheduleService} taskService={taskService ?? fallbackTaskService} timerService={resolvedTimerService} runtimeMode={runtimeMode} now={previewNow} />
            : page === 'statistics'
              ? <StatisticsPage statisticsService={statisticsService ?? fallbackStatisticsService} now={previewNow} />
              : <ThemesPage repository={resolvedRepository} taskService={taskService ?? fallbackTaskService} timerService={resolvedTimerService} now={previewNow} embeddedInShell />}
      </div>
      {runtimeMode === 'preview' && <span className="preview-badge">预览模式</span>}
      {recoverySession && <RecoveryDialog activeSession={recoverySession} timerService={resolvedTimerService} onRecovered={refreshRecovery} />}
    </div>
  )
}

function readPage(): AppPage {
  const page = new URLSearchParams(window.location.search).get('page')
  return page === 'schedule' || page === 'timer' || page === 'statistics' ? page : 'themes'
}

function previewClock(runtimeMode: RuntimeMode): () => Date {
  if (runtimeMode !== 'preview') return () => new Date()
  return () => {
    const raw = new URLSearchParams(window.location.search).get('now')
    const parsed = raw === null ? null : new Date(raw)
    return parsed !== null && !Number.isNaN(parsed.getTime()) ? parsed : new Date()
  }
}

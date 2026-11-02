# Focus Mind Shared Sidebar and Timer Visual Design

## Goal

Fix navigation and layout consistency by keeping one shared left sidebar visible on the themes, schedule, and timer pages, then restyle the timer page to match the supplied HTML reference without adding pause semantics.

## Scope

- Extract a shared `AppSidebar` rendered by the application shell.
- Keep the sidebar fixed at 260px while the active page scrolls independently.
- Preserve the current themes workspace and schedule content structures.
- Recompose the timer page as a central timer area plus a 420px today-summary and record column.
- Deliver a Vite browser preview for approval. Do not run or produce a new Tauri package in this change.

## Shared Sidebar

The application shell owns the sidebar so page transitions cannot remove or duplicate it. The sidebar contains:

- Focus Mind branding.
- Schedule and timer navigation.
- Local inline SVG icons based on the reference's `calendar_today` and `timer` symbols; no Google Fonts or CDN dependency.
- Active-page treatment using a white surface, subtle border, rounded corners, and soft shadow.
- Theme shortcuts with their existing colors. Theme shortcuts navigate to the themes workspace and select the chosen theme where feasible without changing repository behavior.

Themes, schedule, and timer pages render only their page content. Navigation continues to use the current in-memory SPA page state so browser-preview data survives page changes.

## Timer Page

The timer page follows the supplied reference's visual hierarchy:

- Flexible central focus area with the selected task control, large tabular timer digits, and a single circular primary control.
- The primary control shows play when idle and stop when active. There is no pause state.
- Fixed-width right column with "今日概览" and "今日记录".
- Overview card shows session count and total duration.
- Active and completed record cards show task, status, start/end time, and derived duration.
- Existing `TimerService` and `ScheduleService` behavior remains unchanged.

## Responsive Behavior

- Desktop width keeps 260px sidebar, flexible timer center, and 420px records column.
- At narrower preview widths, the records column shrinks before the timer center; the sidebar remains fixed and visible.
- Page content owns scrolling; the sidebar does not scroll away.

## Testing and Acceptance

- UI tests verify the sidebar remains present while navigating themes → schedule → timer → schedule.
- Timer tests continue to verify elapsed time is derived from timestamps and start/stop behavior is unchanged.
- Browser E2E clicks visible navigation rather than entering page URLs directly.
- Visual browser QA checks sidebar alignment, active icons, timer composition, record cards, and common desktop viewport behavior.
- Run Vitest, TypeScript, and Vite build. Do not run `tauri build` before user visual approval.

## Out of Scope

- Pause/resume timer behavior.
- Redesigning the themes or schedule content areas.
- Changing persistence, recurrence, completion, or focus-session domain rules.
- Desktop packaging before visual approval.

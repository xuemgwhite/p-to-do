# Focus Mind Shared Sidebar and Timer Visual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep one fixed sidebar visible across themes, schedule, and timer, and restyle the timer page to match the supplied reference while preserving start/stop behavior.

**Architecture:** `App` owns one `AppSidebar` and renders page content beside it. Pages stop rendering their own navigation shells. `TimerPage` remains service-driven but splits its presentation into a flexible timer stage and a fixed-width today-summary column.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library, Playwright, Vite.

## Global Constraints

- The sidebar stays fixed at 260px on themes, schedule, and timer pages.
- Use local inline SVG icons based on `calendar_today` and `timer`; do not add Google Fonts, Material Symbols, Tailwind CDN, or another runtime CDN.
- Preserve existing start/end timer semantics; do not add pause/resume behavior.
- Preserve themes and schedule content behavior and repository/service boundaries.
- Deliver Vite browser preview for approval; do not run `tauri build` in this change.

---

### Task 1: Shared Application Sidebar

**Files:**
- Create: `focus-mind/src/ui/layout/AppSidebar.tsx`
- Create: `focus-mind/src/ui/layout/app-sidebar.css`
- Modify: `focus-mind/src/app/App.tsx`
- Modify: `focus-mind/src/ui/themes/ThemesPage.tsx`
- Modify: `focus-mind/src/ui/themes/ThemeColumn.tsx`
- Modify: `focus-mind/src/ui/schedule/SchedulePage.tsx`
- Modify: `focus-mind/src/ui/timer/TimerPage.tsx`
- Test: `focus-mind/tests/ui/app-shell.test.tsx`

**Interfaces:**
- Consumes: current `AppPage`, `navigate(page)`, and repository themes.
- Produces: `AppSidebar({ activePage, themes, onNavigate, onSelectTheme })` and a shell whose sidebar survives page changes.

- [ ] **Step 1: Extend the failing shell test**

Assert one `主导航` remains mounted while navigating themes → schedule → timer → schedule, active navigation uses `aria-current="page"`, and the buttons expose local SVG icons by accessible label.

```tsx
expect(screen.getAllByRole('navigation', { name: '主导航' })).toHaveLength(1)
fireEvent.click(screen.getByRole('button', { name: '日程' }))
expect(screen.getByRole('button', { name: '日程' })).toHaveAttribute('aria-current', 'page')
fireEvent.click(screen.getByRole('button', { name: '计时' }))
expect(screen.getByRole('button', { name: '计时' })).toHaveAttribute('aria-current', 'page')
expect(screen.getByTitle('日程图标')).toBeInTheDocument()
expect(screen.getByTitle('计时图标')).toBeInTheDocument()
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run tests/ui/app-shell.test.tsx`

Expected: FAIL because each page currently owns different navigation and no shared icon component exists.

- [ ] **Step 3: Implement the shared sidebar**

Create `AppSidebar` with inline calendar and timer SVG paths, active-page treatment, theme color rows, and callbacks. Render it once in `App`, fetch themes from the repository into shell state, and remove page-owned sidebar/navigation markup. Keep `navigate()` as the only page-state writer.

- [ ] **Step 4: Run shell and existing page tests**

Run: `pnpm vitest run tests/ui/app-shell.test.tsx tests/ui/themes-page.test.tsx tests/ui/schedule-page.test.tsx tests/ui/timer-page.test.tsx`

Expected: PASS with one shared sidebar across every page.

- [ ] **Step 5: Commit**

```bash
git add focus-mind/src/app focus-mind/src/ui/layout focus-mind/src/ui/themes focus-mind/src/ui/schedule focus-mind/src/ui/timer focus-mind/tests/ui/app-shell.test.tsx
git commit -m "refactor: share application sidebar"
```

---

### Task 2: Reference-Aligned Timer Layout

**Files:**
- Modify: `focus-mind/src/ui/timer/TimerPage.tsx`
- Modify: `focus-mind/src/ui/timer/timer.css`
- Test: `focus-mind/tests/ui/timer-page.test.tsx`

**Interfaces:**
- Consumes: existing `TimerService`, `ScheduleService`, candidates, active session, and daily records.
- Produces: timer stage, single circular play/stop control, today overview card, and record cards with derived timestamps/durations.

- [ ] **Step 1: Write failing layout assertions**

```tsx
expect(await screen.findByRole('region', { name: '计时控制' })).toBeInTheDocument()
expect(screen.getByRole('complementary', { name: '今日专注记录' })).toBeInTheDocument()
expect(screen.getByRole('button', { name: '开始计时' })).toHaveClass('timer-primary-control')
expect(screen.getByTestId('elapsed-time')).toHaveClass('timer-digits')
```

Verify active and ended record cards expose status, start time, end time, and derived duration without changing service behavior.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run tests/ui/timer-page.test.tsx`

Expected: FAIL because the current timer page uses vertically stacked sections rather than the reference layout.

- [ ] **Step 3: Implement the timer composition**

Render `.timer-stage` and `.timer-records-panel` inside `.timer-content`. Use a task selector-style control, large tabular digits, one circular play/stop button, overview metrics, and active/ended record cards. Add no pause button and no new state.

- [ ] **Step 4: Run timer tests and typecheck**

Run: `pnpm vitest run tests/ui/timer-page.test.tsx && pnpm tsc --noEmit`

Expected: PASS; elapsed time still derives from timestamps and the single button still starts/ends sessions.

- [ ] **Step 5: Commit**

```bash
git add focus-mind/src/ui/timer focus-mind/tests/ui/timer-page.test.tsx
git commit -m "feat: restyle focus timer workspace"
```

---

### Task 3: Browser Acceptance and Preview Handoff

**Files:**
- Modify: `focus-mind/tests/e2e/focus-mind.spec.ts`

**Interfaces:**
- Consumes: visible shared navigation and existing preview services.
- Produces: browser-level proof that the fixed sidebar persists and the timer visual structure is usable.

- [ ] **Step 1: Update E2E to use visible navigation**

Assert sidebar bounding box remains unchanged after theme → schedule → timer → schedule navigation, timer stage and records panel are visible at 1280×800, and no console/page errors occur.

- [ ] **Step 2: Run complete web verification**

Run:

```bash
pnpm vitest run
pnpm playwright test tests/e2e/focus-mind.spec.ts
pnpm tsc --noEmit
pnpm build
```

Expected: all commands exit 0. Do not run Tauri packaging.

- [ ] **Step 3: Start the preview server**

Run: `pnpm exec vite --host 127.0.0.1 --port 5173`

Expected: Vite serves Focus Mind at `http://127.0.0.1:5173/` for user review.

- [ ] **Step 4: Inspect the preview**

Open the preview in the in-app browser, verify fixed sidebar geometry, calendar/timer icons, active navigation, timer stage, overview, and record cards, then leave the server running.

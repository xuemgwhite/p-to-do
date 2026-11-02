# Focus Mind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first macOS Todo and forward-timing application with browser UI preview, hierarchical task management, flexible recurrence, day/week/month scheduling, SQLite persistence, backup, and crash recovery.

**Architecture:** Keep recurrence, status, time validation, and statistics in a platform-independent TypeScript domain. Application services consume repository and platform ports; SQLite/Tauri and browser preview are separate adapters. React pages consume application services and never execute SQL or call Tauri directly.

**Tech Stack:** React, TypeScript, Vite, Tauri 2, SQLite, Zustand, date-fns, dnd-kit, Vitest, Testing Library, Playwright, Rust/Tauri plugins.

## Global Constraints

- The production target is a macOS Tauri application; browser mode is preview-only and uses non-persistent demo data.
- The first release excludes login, server sync, iPad UI, WidgetKit, notifications, overdue state, and skipped occurrences.
- All original “截止日期” copy must be rendered as “结束日期”.
- A task start date must be on or before its end date.
- Duration is always derived from focus-session timestamps and is never stored.
- At most one focus session may have a null end timestamp.
- Focus sessions may not overlap, including manually edited sessions.
- Deleting a theme, goal, or task permanently cascades after an impact-count confirmation.
- Use repository ports so a later HTTP/PostgreSQL implementation does not change domain or React code.
- Use local fonts/icons or system assets in production; do not require Google CDN or Tailwind CDN at runtime.
- Implement behavior with TDD and commit after every independently passing task.

---

## Planned File Structure

```text
focus-mind/
  package.json
  vite.config.ts
  src/
    app/App.tsx                  # routes and application shell
    app/bootstrap.ts             # selects preview or Tauri adapters
    domain/models.ts             # shared entity and value types
    domain/dates.ts              # local-date and cross-midnight helpers
    domain/recurrence.ts         # daily and weekly-quota occurrence rules
    domain/focus.ts              # focus validation and daily statistics
    ports/FocusMindRepository.ts # persistence interface
    ports/DesktopPort.ts         # backup/export/window platform interface
    application/TaskService.ts
    application/TimerService.ts
    application/ScheduleService.ts
    infrastructure/preview/PreviewRepository.ts
    infrastructure/sqlite/SqliteRepository.ts
    infrastructure/sqlite/schema.ts
    state/useAppStore.ts
    ui/layout/AppSidebar.tsx
    ui/themes/ThemesPage.tsx
    ui/themes/ThemeColumn.tsx
    ui/themes/GoalColumn.tsx
    ui/themes/TaskColumn.tsx
    ui/themes/TaskCard.tsx
    ui/schedule/SchedulePage.tsx
    ui/schedule/DayView.tsx
    ui/schedule/WeekView.tsx
    ui/schedule/MonthView.tsx
    ui/timer/TimerPage.tsx
    ui/shared/EntityDialog.tsx
    ui/shared/DeleteDialog.tsx
    ui/shared/FocusSessionDialog.tsx
    styles/tokens.css
    styles/global.css
  src-tauri/
    migrations/0001_initial.sql
    src/lib.rs
    capabilities/default.json
    tauri.conf.json
  tests/
    domain/*.test.ts
    application/*.test.ts
    ui/*.test.tsx
    e2e/focus-mind.spec.ts
```

---

### Task 1: Scaffold the Web and Tauri Application Boundary

**Files:**
- Create: `focus-mind/package.json`
- Create: `focus-mind/vite.config.ts`
- Create: `focus-mind/src/app/App.tsx`
- Create: `focus-mind/src/app/bootstrap.ts`
- Create: `focus-mind/src/ports/DesktopPort.ts`
- Create: `focus-mind/src/infrastructure/preview/PreviewDesktopPort.ts`
- Create: `focus-mind/src/styles/tokens.css`
- Create: `focus-mind/src/styles/global.css`
- Create: `focus-mind/src-tauri/tauri.conf.json`
- Test: `focus-mind/tests/ui/app-shell.test.tsx`

**Interfaces:**
- Produces: `DesktopPort`, `RuntimeMode`, `bootstrapApplication()` and a working `pnpm dev` browser preview.

- [ ] **Step 1: Initialize React/TypeScript and Tauri in `focus-mind/`**

Run:

```bash
pnpm create vite focus-mind --template react-ts
cd focus-mind
pnpm add @tauri-apps/api zustand date-fns @dnd-kit/core @dnd-kit/sortable
pnpm add -D @tauri-apps/cli vitest jsdom @testing-library/react @testing-library/jest-dom @playwright/test
pnpm tauri init --ci --app-name "Focus Mind" --window-title "Focus Mind" --frontend-dist ../dist --dev-url http://localhost:5173 --before-dev-command "pnpm dev" --before-build-command "pnpm build"
```

Expected: `pnpm dev` serves the Vite page and `pnpm tauri dev` opens the same frontend in a macOS window.

- [ ] **Step 2: Write the failing application-shell test**

```tsx
// tests/ui/app-shell.test.tsx
import { render, screen } from '@testing-library/react';
import { App } from '../../src/app/App';

it('shows preview mode only in browser preview', () => {
  render(<App runtimeMode="preview" />);
  expect(screen.getByText('预览模式')).toBeInTheDocument();
  expect(screen.getByText('日程')).toBeInTheDocument();
  expect(screen.getByText('计时')).toBeInTheDocument();
});
```

Run: `pnpm vitest run tests/ui/app-shell.test.tsx`
Expected: FAIL because `App` does not accept `runtimeMode` and the shell is absent.

- [ ] **Step 3: Define the platform boundary and minimal shell**

```ts
// src/ports/DesktopPort.ts
export type RuntimeMode = 'preview' | 'tauri';

export interface DesktopPort {
  readonly mode: RuntimeMode;
  createDailyBackup(): Promise<void>;
  exportBackup(): Promise<void>;
  importBackup(): Promise<void>;
}
```

```tsx
// src/app/App.tsx
import type { RuntimeMode } from '../ports/DesktopPort';
import '../styles/global.css';

export function App({ runtimeMode }: { runtimeMode: RuntimeMode }) {
  return <div className="app-shell">
    <aside><strong>Focus Mind</strong><nav>日程<br />计时</nav></aside>
    <main>{runtimeMode === 'preview' && <span className="preview-badge">预览模式</span>}</main>
  </div>;
}
```

- [ ] **Step 4: Run shell tests and builds**

Run: `pnpm vitest run tests/ui/app-shell.test.tsx && pnpm build`
Expected: PASS and Vite production build succeeds.

- [ ] **Step 5: Commit**

```bash
git add focus-mind
git commit -m "chore: scaffold Focus Mind application"
```

---

### Task 2: Define Domain Models and Date Semantics

**Files:**
- Create: `focus-mind/src/domain/models.ts`
- Create: `focus-mind/src/domain/dates.ts`
- Test: `focus-mind/tests/domain/dates.test.ts`

**Interfaces:**
- Produces: `LocalDate`, `Task`, `TaskOccurrence`, `FocusSession`, `assertDateRange()`, `splitIntervalByLocalDay()`.

- [ ] **Step 1: Write failing tests for date ranges and midnight splitting**

```ts
import { describe, expect, it } from 'vitest';
import { assertDateRange, splitIntervalByLocalDay } from '../../src/domain/dates';

describe('dates', () => {
  it('rejects a start date after the end date', () => {
    expect(() => assertDateRange('2026-07-19', '2026-07-18')).toThrow('开始日期不能晚于结束日期');
  });

  it('splits a cross-midnight interval without duplicating the session', () => {
    const parts = splitIntervalByLocalDay(
      new Date('2026-07-18T23:30:00+08:00'),
      new Date('2026-07-19T00:30:00+08:00'),
    );
    expect(parts.map((p) => p.durationMs)).toEqual([1_800_000, 1_800_000]);
  });
});
```

Run: `pnpm vitest run tests/domain/dates.test.ts`
Expected: FAIL because date functions do not exist.

- [ ] **Step 2: Add exact domain types**

```ts
// src/domain/models.ts
export type Id = string;
export type LocalDate = `${number}-${number}-${number}`;
export type RecurrenceType = 'none' | 'daily' | 'weekly_quota';
export type CompletionState = 'pending' | 'completed';

export interface Theme { id: Id; name: string; color: string; sortOrder: number }
export interface Goal { id: Id; themeId: Id; name: string; sortOrder: number }
export interface Task {
  id: Id; goalId: Id; name: string; description: string;
  startDate: LocalDate; endDate: LocalDate; recurrenceType: RecurrenceType;
  weeklyQuota: number | null; completedAt: string | null; sortOrder: number;
}
export interface TaskOccurrence {
  id: Id; taskId: Id; periodKey: string; plannedDate: LocalDate | null;
  boundDate: LocalDate | null; state: CompletionState; completedAt: string | null;
}
export interface FocusSession {
  id: Id; taskId: Id; occurrenceId: Id | null;
  startedAt: string; endedAt: string | null; source: 'timer' | 'completion_form';
}
```

- [ ] **Step 3: Implement local-date helpers using `date-fns`**

Implement `assertDateRange`, `toLocalDate`, `startOfLocalDay`, and `splitIntervalByLocalDay`. Return parts shaped as `{ date: LocalDate; start: Date; end: Date; durationMs: number }` and iterate at local midnight boundaries.

- [ ] **Step 4: Verify tests**

Run: `pnpm vitest run tests/domain/dates.test.ts`
Expected: PASS with two equal 30-minute parts in Asia/Shanghai.

- [ ] **Step 5: Commit**

```bash
git add src/domain tests/domain
git commit -m "feat: define task and time domain models"
```

---

### Task 3: Implement Daily and Weekly-Quota Occurrence Generation

**Files:**
- Create: `focus-mind/src/domain/recurrence.ts`
- Test: `focus-mind/tests/domain/recurrence.test.ts`

**Interfaces:**
- Consumes: `Task`, `TaskOccurrence`, `LocalDate`.
- Produces: `occurrencesForRange(task, existing, from, to)`, `weeklyQuotaProgress()`, `bindWeeklyOccurrence()`.

- [ ] **Step 1: Write failing recurrence tests**

```ts
it('generates one idempotent daily occurrence per date', () => {
  const first = occurrencesForRange(dailyTask, [], '2026-07-18', '2026-07-20');
  const second = occurrencesForRange(dailyTask, first, '2026-07-18', '2026-07-20');
  expect(first).toHaveLength(3);
  expect(second).toHaveLength(3);
});

it('generates three undated occurrences for a weekly quota of three', () => {
  const items = occurrencesForRange(weeklyTask(3), [], '2026-07-13', '2026-07-19');
  expect(items).toHaveLength(3);
  expect(items.every((item) => item.boundDate === null)).toBe(true);
});

it('binds one available weekly occurrence to today', () => {
  const bound = bindWeeklyOccurrence(items, '2026-07-18');
  expect(bound.boundDate).toBe('2026-07-18');
});
```

Run: `pnpm vitest run tests/domain/recurrence.test.ts`
Expected: FAIL because recurrence functions do not exist.

- [ ] **Step 2: Implement stable occurrence keys**

Use keys `daily:<taskId>:<yyyy-mm-dd>` and `weekly:<taskId>:<ISO-week-key>:<slot-index>`. Merge generated rows with existing rows by key so repeated startup and range queries are idempotent.

- [ ] **Step 3: Implement quota edits without rewriting history**

For the current/future week, add pending slots when quota increases. When quota decreases, remove only unbound, pending surplus slots; never remove completed slots. Report progress as `{ completed, quota, remaining, overage }`.

- [ ] **Step 4: Run recurrence tests**

Run: `pnpm vitest run tests/domain/recurrence.test.ts`
Expected: PASS, including idempotency and quota-decrease edge cases.

- [ ] **Step 5: Commit**

```bash
git add src/domain/recurrence.ts tests/domain/recurrence.test.ts
git commit -m "feat: add flexible recurrence engine"
```

---

### Task 4: Implement Focus Validation, Status, and Statistics

**Files:**
- Create: `focus-mind/src/domain/focus.ts`
- Test: `focus-mind/tests/domain/focus.test.ts`

**Interfaces:**
- Produces: `validateFocusInterval()`, `deriveTaskStatus()`, `summarizeDay()`.

- [ ] **Step 1: Write failing focus tests**

```ts
it('rejects zero length and overlapping sessions', () => {
  expect(() => validateFocusInterval(start, start, [])).toThrow('结束时间必须晚于开始时间');
  expect(() => validateFocusInterval(start, end, [overlapping])).toThrow('专注记录不能重叠');
});

it('counts a cross-midnight session once on its start day', () => {
  expect(summarizeDay('2026-07-18', [crossMidnight])).toEqual({ count: 1, durationMs: 1_800_000 });
  expect(summarizeDay('2026-07-19', [crossMidnight])).toEqual({ count: 0, durationMs: 1_800_000 });
});
```

Run: `pnpm vitest run tests/domain/focus.test.ts`
Expected: FAIL because functions are missing.

- [ ] **Step 2: Implement interval validation**

Treat intervals as half-open `[start, end)`. Reject `end <= start`, `end > now`, and overlap where `candidateStart < existingEnd && candidateEnd > existingStart`. Exclude the edited record by ID.

- [ ] **Step 3: Implement derived task status**

Use priority `focusing` → `completed` → `in_progress` → `pending`. An activity row makes the task `focusing`; any saved row makes an unfinished task `in_progress`.

- [ ] **Step 4: Implement daily summaries and run tests**

Run: `pnpm vitest run tests/domain/focus.test.ts`
Expected: PASS for regular, cross-midnight, edit-exclusion, and active-session cases.

- [ ] **Step 5: Commit**

```bash
git add src/domain/focus.ts tests/domain/focus.test.ts
git commit -m "feat: validate and summarize focus sessions"
```

---

### Task 5: Create SQLite Schema, Migrations, and Repository

**Files:**
- Create: `focus-mind/src/ports/FocusMindRepository.ts`
- Create: `focus-mind/src/infrastructure/sqlite/schema.ts`
- Create: `focus-mind/src/infrastructure/sqlite/SqliteRepository.ts`
- Create: `focus-mind/src-tauri/migrations/0001_initial.sql`
- Modify: `focus-mind/src-tauri/src/lib.rs`
- Test: `focus-mind/tests/integration/sqlite-repository.test.ts`

**Interfaces:**
- Produces: `FocusMindRepository` with transaction-safe CRUD, range queries, impact counts, and active-session lookup.

- [ ] **Step 1: Define the repository contract**

```ts
export interface FocusMindRepository {
  transaction<T>(work: (repo: FocusMindRepository) => Promise<T>): Promise<T>;
  listThemes(): Promise<Theme[]>;
  listGoals(themeId: Id): Promise<Goal[]>;
  listTasks(goalId: Id): Promise<Task[]>;
  saveTheme(theme: Theme): Promise<void>;
  saveGoal(goal: Goal): Promise<void>;
  saveTask(task: Task): Promise<void>;
  upsertOccurrences(items: TaskOccurrence[]): Promise<void>;
  listOccurrences(from: LocalDate, to: LocalDate): Promise<TaskOccurrence[]>;
  saveFocusSession(session: FocusSession): Promise<void>;
  deleteFocusSession(id: Id): Promise<void>;
  listFocusSessions(from: string, to: string): Promise<FocusSession[]>;
  listFocusSessionsForTask(taskId: Id): Promise<FocusSession[]>;
  getActiveFocusSession(): Promise<FocusSession | null>;
  countDeletionImpact(kind: 'theme' | 'goal' | 'task', id: Id): Promise<DeletionImpact>;
  deleteCascade(kind: 'theme' | 'goal' | 'task', id: Id): Promise<void>;
}

export interface DeletionImpact {
  themes: number;
  goals: number;
  tasks: number;
  occurrences: number;
  focusSessions: number;
}
```

- [ ] **Step 2: Write a failing repository integration test**

Create a temporary database, insert theme → goal → task → occurrence → session, delete the theme, and assert every table count is zero. Also attempt two null-ended sessions and expect a unique-index failure.

Run: `pnpm vitest run tests/integration/sqlite-repository.test.ts`
Expected: FAIL because migrations and adapter do not exist.

- [ ] **Step 3: Add the initial migration**

Create tables `themes`, `goals`, `tasks`, `task_occurrences`, `focus_sessions`, and `schema_meta`; use foreign keys with `ON DELETE CASCADE`, unique occurrence keys, indexes on task/date/session timestamps, and a partial unique index that permits only one `focus_sessions.ended_at IS NULL` row.

- [ ] **Step 4: Implement repository methods with parameterized SQL**

Enable `PRAGMA foreign_keys = ON` and WAL mode. Map snake_case database rows to domain types in `schema.ts`. Perform deletion and timer switching inside explicit transactions.

- [ ] **Step 5: Run integration tests and commit**

Run: `pnpm vitest run tests/integration/sqlite-repository.test.ts`
Expected: PASS for CRUD, cascade, active uniqueness, and visible-range queries.

```bash
git add src/ports src/infrastructure/sqlite src-tauri tests/integration
git commit -m "feat: persist Focus Mind data in SQLite"
```

---

### Task 6: Add Application Services and Preview Repository

**Files:**
- Create: `focus-mind/src/application/TaskService.ts`
- Create: `focus-mind/src/application/TimerService.ts`
- Create: `focus-mind/src/application/ScheduleService.ts`
- Create: `focus-mind/src/infrastructure/preview/PreviewRepository.ts`
- Create: `focus-mind/src/app/bootstrap.ts`
- Test: `focus-mind/tests/application/services.test.ts`

**Interfaces:**
- Produces: `TaskService.completeTask()`, `TaskService.startEarly()`, `TimerService.start()`, `TimerService.stop()`, `TimerService.recover()`, `ScheduleService.getDay/Week/Month()`.

- [ ] **Step 1: Write failing use-case tests**

Cover these exact cases: completion without sessions requires a manual interval; completion with a saved session succeeds; starting another task ends the old session in one transaction; starting a future ordinary task moves start/end dates; an unscheduled daily task is rejected; a weekly-quota start binds one slot to today.

Run: `pnpm vitest run tests/application/services.test.ts`
Expected: FAIL because services are absent.

- [ ] **Step 2: Implement `TaskService`**

Expose errors as typed codes: `MANUAL_SESSION_REQUIRED`, `INVALID_DATE_RANGE`, `NO_OCCURRENCE_TODAY`, `WEEKLY_QUOTA_COMPLETE`, and `FOCUS_OVERLAP`. `completeTask` accepts optional `{ startedAt, endedAt }` and creates a `completion_form` session only when no session exists.

- [ ] **Step 3: Implement `TimerService`**

`start(target, now)` resolves or binds the correct occurrence, stops an existing active row at `now`, and creates the new active row in the same repository transaction. `stop(now)` fills `endedAt`. `recover(choice)` supports `end_now`, `end_at`, and `discard`.

- [ ] **Step 4: Implement range-based `ScheduleService` and preview demo data**

Return view models rather than raw tables. Day data includes pending/completed items and a weekly-quota reminder. Week data includes all-day planned items and timed session segments. Month data returns sorted timed segments followed by untimed tasks.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run tests/application/services.test.ts`
Expected: PASS for all listed use cases.

```bash
git add src/application src/infrastructure/preview src/app/bootstrap.ts tests/application
git commit -m "feat: orchestrate tasks schedules and timers"
```

---

### Task 7: Build the Three-Column Theme Workspace

**Files:**
- Create: `focus-mind/src/ui/themes/ThemesPage.tsx`
- Create: `focus-mind/src/ui/themes/ThemeColumn.tsx`
- Create: `focus-mind/src/ui/themes/GoalColumn.tsx`
- Create: `focus-mind/src/ui/themes/TaskColumn.tsx`
- Create: `focus-mind/src/ui/themes/TaskCard.tsx`
- Create: `focus-mind/src/ui/shared/EntityDialog.tsx`
- Create: `focus-mind/src/ui/shared/DeleteDialog.tsx`
- Create: `focus-mind/src/state/useAppStore.ts`
- Test: `focus-mind/tests/ui/themes-page.test.tsx`

**Interfaces:**
- Consumes: task services and repository list/save/delete operations.
- Produces: selectable, sortable theme/goal/task columns and all entity forms.

- [ ] **Step 1: Write failing interaction tests**

Test selection propagation, add defaults, right-click menus, task-card start button, completion fallback dialog, deletion impact counts, and same-level drag reorder. Assert there are no visible edit/delete buttons on a task card before context-menu activation.

Run: `pnpm vitest run tests/ui/themes-page.test.tsx`
Expected: FAIL because components are absent.

- [ ] **Step 2: Port design tokens and shell layout**

Translate the supplied HTML colors, spacing, typography, radii, and shadows into `tokens.css`. Use local/system icons and fonts. Implement fixed sidebar plus independent theme/goal/task scrollers without CDN dependencies.

- [ ] **Step 3: Implement entity dialogs and right-click menus**

Use one schema-driven `EntityDialog` for create/edit. `DeleteDialog` must render exact impact counts and require a destructive confirmation click. Dirty dialogs prompt before closing.

- [ ] **Step 4: Implement dnd-kit sorting and task sections**

Persist fractional or normalized `sortOrder` values after same-level drag. Render unfinished tasks first and a reduced-opacity completed section last. Do not permit cross-parent drag in the first release.

- [ ] **Step 5: Run UI tests and commit**

Run: `pnpm vitest run tests/ui/themes-page.test.tsx`
Expected: PASS for all interactions and form validation.

```bash
git add src/ui/themes src/ui/shared src/state src/styles tests/ui/themes-page.test.tsx
git commit -m "feat: build theme goal and task workspace"
```

---

### Task 8: Build Day, Week, and Month Schedule Views

**Files:**
- Create: `focus-mind/src/ui/schedule/SchedulePage.tsx`
- Create: `focus-mind/src/ui/schedule/DayView.tsx`
- Create: `focus-mind/src/ui/schedule/WeekView.tsx`
- Create: `focus-mind/src/ui/schedule/MonthView.tsx`
- Create: `focus-mind/src/ui/shared/FocusSessionDialog.tsx`
- Test: `focus-mind/tests/ui/schedule-page.test.tsx`

**Interfaces:**
- Consumes: `ScheduleService`, `TaskService`, `TimerService`.
- Produces: navigable day/week/month pages and focus-session edit/delete UI.

- [ ] **Step 1: Write failing schedule tests**

Assert: day view separates pending/completed; weekly reminder is last; non-today start controls are disabled; week all-day area is separate from timed sessions; cross-midnight session yields two visual pieces; month timed items sort ascending and untimed items sort last; month cells scroll internally.

Run: `pnpm vitest run tests/ui/schedule-page.test.tsx`
Expected: FAIL because schedule views are absent.

- [ ] **Step 2: Implement shared date navigation and day view**

Keep selected date in URL/search state. Label the current day “今天”. Reuse `TaskCard` behavior but disable starting unless selected date equals the system local date.

- [ ] **Step 3: Implement the Apple Calendar-style week grid**

Use a 24-hour vertical coordinate system. Render planned items in a top all-day section and actual focus segments in the time grid. Lay out overlapping visual segments side by side defensively even though repository validation prevents new overlap.

- [ ] **Step 4: Implement month cells and record dialog**

Render timed rows first by timestamp, then unfinished untimed rows. Give each date cell `overflow-y: auto`. Editing uses `FocusSessionDialog`, validates overlap, and refreshes all visible schedule summaries after save/delete.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run tests/ui/schedule-page.test.tsx`
Expected: PASS for day/week/month behaviors.

```bash
git add src/ui/schedule src/ui/shared/FocusSessionDialog.tsx tests/ui/schedule-page.test.tsx
git commit -m "feat: add day week and month schedules"
```

---

### Task 9: Build Timer Page and Crash-Recovery Gate

**Files:**
- Create: `focus-mind/src/ui/timer/TimerPage.tsx`
- Create: `focus-mind/src/ui/timer/RecoveryDialog.tsx`
- Modify: `focus-mind/src/app/App.tsx`
- Test: `focus-mind/tests/ui/timer-page.test.tsx`

**Interfaces:**
- Consumes: `TimerService`, `ScheduleService.getDay()`.
- Produces: live timer, today-only selector, overview, records, and mandatory startup recovery.

- [ ] **Step 1: Write failing timer-page tests**

Use fake timers to prove the display is `Date.now() - startedAt`, not an incremented persisted counter. Test a single Start/End button, today-only candidates, automatic task switching, immediate summary refresh, and all three recovery choices.

Run: `pnpm vitest run tests/ui/timer-page.test.tsx`
Expected: FAIL because timer UI is absent.

- [ ] **Step 2: Implement timer state and display**

Tick only component display state once per second. Never write during ticks. On start/stop, refetch active row and today summary. Show current task, elapsed time, today count, total duration, and record cards.

- [ ] **Step 3: Add application startup recovery gate**

Before rendering normal routes, call `getActiveFocusSession()`. If found, render a modal that cannot be dismissed with backdrop or Escape. Validate manual end time before calling `recover`.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run tests/ui/timer-page.test.tsx`
Expected: PASS with fake time and recovery coverage.

```bash
git add src/ui/timer src/app/App.tsx tests/ui/timer-page.test.tsx
git commit -m "feat: add forward timer and recovery flow"
```

---

### Task 10: Add Backup, Import, Window State, and Production Bootstrap

**Files:**
- Create: `focus-mind/src/infrastructure/tauri/TauriDesktopPort.ts`
- Modify: `focus-mind/src/app/bootstrap.ts`
- Modify: `focus-mind/src-tauri/src/lib.rs`
- Modify: `focus-mind/src-tauri/capabilities/default.json`
- Test: `focus-mind/tests/application/backup.test.ts`

**Interfaces:**
- Implements: `DesktopPort.exportBackup()`, `importBackup()`, `createDailyBackup()`, and production SQLite bootstrap.

- [ ] **Step 1: Write failing backup tests against a fake file adapter**

Test one backup per local day, retention of the newest seven files, import pre-backup, successful replacement, and rollback when validation fails.

Run: `pnpm vitest run tests/application/backup.test.ts`
Expected: FAIL because backup orchestration is absent.

- [ ] **Step 2: Implement safe backup orchestration**

Checkpoint WAL before copying. Write to a temporary file, validate SQLite header and schema version, then atomically rename. For import, close the active connection, copy current DB to pre-import backup, validate candidate, replace, migrate, and reopen; restore backup on any failure.

- [ ] **Step 3: Add Tauri capabilities and window-state persistence**

Grant only SQL, dialog, file access to the application data/backup directories, and window-state permissions. Configure a three-column-safe minimum size. Do not grant arbitrary shell execution.

- [ ] **Step 4: Select adapters in bootstrap**

Use `window.__TAURI_INTERNALS__` presence only inside `bootstrap.ts`: production receives `SqliteRepository` + `TauriDesktopPort`; browser receives `PreviewRepository` + `PreviewDesktopPort`. Components receive dependencies through context.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run tests/application/backup.test.ts && pnpm build && pnpm tauri build --debug`
Expected: tests pass, web build succeeds, and a debug macOS bundle is produced.

```bash
git add src/infrastructure/tauri src/app/bootstrap.ts src-tauri tests/application/backup.test.ts
git commit -m "feat: add desktop persistence and backups"
```

---

### Task 11: Complete End-to-End Acceptance and Packaging

**Files:**
- Create: `focus-mind/tests/e2e/focus-mind.spec.ts`
- Create: `focus-mind/README.md`
- Modify: `focus-mind/package.json`
- Modify: `focus-mind/src-tauri/tauri.conf.json`

**Interfaces:**
- Produces: reproducible test commands, browser acceptance coverage, and installable macOS build.

- [ ] **Step 1: Write the end-to-end acceptance path**

In Playwright browser preview: create a theme, goal, ordinary task, daily task, and weekly-quota task; start and stop focus; complete with and without prior session; inspect day/week/month; edit a session; verify deletion impact confirmation. Use deterministic preview time and repository data.

- [ ] **Step 2: Run E2E and fix only acceptance failures**

Run: `pnpm playwright test tests/e2e/focus-mind.spec.ts`
Expected: PASS in Chromium at the desktop viewport and no uncaught console errors.

- [ ] **Step 3: Run the complete verification matrix**

Run:

```bash
pnpm vitest run
pnpm playwright test
pnpm tsc --noEmit
pnpm build
pnpm tauri build --debug
```

Expected: every command exits 0; the final command produces `src-tauri/target/debug/bundle/macos/Focus Mind.app` or the target-equivalent debug bundle path printed by Tauri.

- [ ] **Step 4: Document operation and known scope**

README must include prerequisites, `pnpm dev`, `pnpm tauri dev`, test commands, database/backup locations, recovery behavior, browser-preview limitations, build command, and explicit exclusions for server sync, iPad, and WidgetKit.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e README.md package.json src-tauri/tauri.conf.json
git commit -m "test: verify Focus Mind MVP workflows"
```

---

## Final Review Checklist

- [ ] Every spec section maps to at least one task above.
- [ ] No React component imports SQLite or Tauri APIs directly.
- [ ] No duration column exists in the database.
- [ ] No overdue or skipped-occurrence state exists.
- [ ] Weekly recurrence is quota-based, not weekday-based.
- [ ] All delete paths show impact counts and execute transactionally.
- [ ] Cross-midnight sessions are stored once and rendered/summarized by day.
- [ ] Browser preview runs without packaging and without persistent production data.
- [ ] Production build contains no required CDN font, icon, or Tailwind runtime dependency.
- [ ] Full verification matrix passes before calling the MVP complete.

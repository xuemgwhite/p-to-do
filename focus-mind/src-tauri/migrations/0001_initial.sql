CREATE TABLE schema_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO schema_meta (id, version) VALUES (1, 1);

CREATE TABLE themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX goals_theme_sort_idx ON goals (theme_id, sort_order, id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  recurrence_type TEXT NOT NULL CHECK (recurrence_type IN ('none', 'daily', 'weekly_quota')),
  weekly_quota INTEGER CHECK (weekly_quota IS NULL OR weekly_quota > 0),
  completed_at TEXT,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX tasks_goal_sort_idx ON tasks (goal_id, sort_order, id);
CREATE INDEX tasks_date_range_idx ON tasks (start_date, end_date);

CREATE TABLE task_occurrences (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  planned_date TEXT,
  bound_date TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed')),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (task_id, period_key)
);

CREATE INDEX task_occurrences_task_idx ON task_occurrences (task_id);
CREATE INDEX task_occurrences_planned_date_idx ON task_occurrences (planned_date);
CREATE INDEX task_occurrences_bound_date_idx ON task_occurrences (bound_date);

CREATE TABLE focus_sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  occurrence_id TEXT REFERENCES task_occurrences(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  source TEXT NOT NULL CHECK (source IN ('timer', 'completion_form')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (ended_at IS NULL OR ended_at > started_at)
);

CREATE INDEX focus_sessions_task_started_idx ON focus_sessions (task_id, started_at);
CREATE INDEX focus_sessions_started_idx ON focus_sessions (started_at);
CREATE INDEX focus_sessions_ended_idx ON focus_sessions (ended_at);
CREATE UNIQUE INDEX focus_sessions_one_active_idx ON focus_sessions ((1)) WHERE ended_at IS NULL;

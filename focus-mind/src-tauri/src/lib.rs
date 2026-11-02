pub mod sqlite_batch;

use tauri::{Emitter, Manager};

const QUICK_COLLAPSED_WIDTH: f64 = 96.0;
const QUICK_COLLAPSED_HEIGHT: f64 = 96.0;
const QUICK_EXPANDED_WIDTH: f64 = 320.0;
const QUICK_EXPANDED_HEIGHT: f64 = 460.0;

fn resize_quick_tasks(app: &tauri::AppHandle, expanded: bool) -> Result<(), String> {
  let window = app
    .get_webview_window("quick-tasks")
    .ok_or_else(|| "找不到今日任务悬浮窗。".to_string())?;
  let old_position = window.outer_position().map_err(|error| error.to_string())?;
  let old_size = window.outer_size().map_err(|error| error.to_string())?;
  let monitor = window
    .current_monitor()
    .map_err(|error| error.to_string())?
    .or(window.primary_monitor().map_err(|error| error.to_string())?);
  let scale = window.scale_factor().map_err(|error| error.to_string())?;
  let (width, height) = if expanded {
    (QUICK_EXPANDED_WIDTH, QUICK_EXPANDED_HEIGHT)
  } else {
    (QUICK_COLLAPSED_WIDTH, QUICK_COLLAPSED_HEIGHT)
  };
  let new_width = (width * scale).round() as u32;
  window
    .set_size(tauri::LogicalSize::new(width, height))
    .map_err(|error| error.to_string())?;
  let mut x = old_position.x + old_size.width as i32 - new_width as i32;
  // Keep the top-right corner fixed so the panel opens down and left from the ball.
  let mut y = old_position.y;
  if let Some(monitor) = monitor {
    let position = monitor.position();
    let size = monitor.size();
    let min_x = position.x + 12;
    let min_y = position.y + 32;
    let max_x = position.x + size.width as i32 - new_width as i32 - 12;
    let max_y = position.y + size.height as i32 - (height * scale).round() as i32 - 12;
    x = x.clamp(min_x, max_x.max(min_x));
    y = y.clamp(min_y, max_y.max(min_y));
  }
  window
    .set_position(tauri::PhysicalPosition::new(x, y))
    .map_err(|error| error.to_string())?;
  window.show().map_err(|error| error.to_string())?;
  Ok(())
}

#[tauri::command]
fn set_quick_tasks_expanded(app: tauri::AppHandle, expanded: bool) -> Result<(), String> {
  resize_quick_tasks(&app, expanded)
}

#[tauri::command]
fn show_quick_tasks(app: tauri::AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window("quick-tasks")
    .ok_or_else(|| "找不到今日任务悬浮窗。".to_string())?;
  window
    .set_size(tauri::LogicalSize::new(
      QUICK_COLLAPSED_WIDTH,
      QUICK_COLLAPSED_HEIGHT,
    ))
    .map_err(|error| error.to_string())?;
  let main_window = app.get_webview_window("main");
  let scale = main_window
    .as_ref()
    .and_then(|main| main.scale_factor().ok())
    .unwrap_or(window.scale_factor().map_err(|error| error.to_string())?);
  let monitor = main_window
    .and_then(|main| main.current_monitor().ok().flatten())
    .or(window.primary_monitor().map_err(|error| error.to_string())?);
  if let Some(monitor) = monitor {
    let position = monitor.position();
    let size = monitor.size();
    let width = (QUICK_COLLAPSED_WIDTH * scale).round() as i32;
    window
      .set_position(tauri::PhysicalPosition::new(
        position.x + size.width as i32 - width - 28,
        position.y + 72,
      ))
      .map_err(|error| error.to_string())?;
  }
  window
    .set_always_on_top(true)
    .map_err(|error| error.to_string())?;
  window
    .set_visible_on_all_workspaces(true)
    .map_err(|error| error.to_string())?;
  window.show().map_err(|error| error.to_string())?;
  window
    .emit("force-collapse-quick-tasks", ())
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_quick_tasks_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
  if enabled {
    show_quick_tasks(app)
  } else {
    app
      .get_webview_window("quick-tasks")
      .ok_or_else(|| "找不到今日任务悬浮窗。".to_string())?
      .hide()
      .map_err(|error| error.to_string())
  }
}

#[tauri::command]
fn quick_tasks_visible(app: tauri::AppHandle) -> Result<bool, String> {
  app
    .get_webview_window("quick-tasks")
    .ok_or_else(|| "找不到今日任务悬浮窗。".to_string())?
    .is_visible()
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_main_timer(app: tauri::AppHandle, task_id: String) -> Result<(), String> {
  resize_quick_tasks(&app, false)?;
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "找不到主窗口。".to_string())?;
  window.show().map_err(|error| error.to_string())?;
  window.unminimize().map_err(|error| error.to_string())?;
  window.set_focus().map_err(|error| error.to_string())?;
  window
    .emit("quick-task-start", task_id)
    .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let migrations = vec![
    tauri_plugin_sql::Migration {
      version: 1,
      description: "initial_focus_mind_schema",
      sql: include_str!("../migrations/0001_initial.sql"),
      kind: tauri_plugin_sql::MigrationKind::Up,
    },
    tauri_plugin_sql::Migration {
      version: 2,
      description: "daily_excluded_weekdays",
      sql: include_str!("../migrations/0002_daily_excluded_weekdays.sql"),
      kind: tauri_plugin_sql::MigrationKind::Up,
    },
  ];

  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      sqlite_batch::execute_sqlite_batch,
      sqlite_batch::checkpoint_focus_mind_database,
      sqlite_batch::validate_focus_mind_database,
      set_quick_tasks_expanded,
      show_quick_tasks,
      set_quick_tasks_enabled,
      quick_tasks_visible,
      open_main_timer
    ])
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(
      tauri_plugin_window_state::Builder::default()
        .with_state_flags(tauri_plugin_window_state::StateFlags::SIZE)
        .with_denylist(&["quick-tasks"])
        .build(),
    )
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations("sqlite:focus-mind.db", migrations)
        .build(),
    )
    .on_window_event(|window, event| {
      if window.label() == "main" {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
          api.prevent_close();
          let _ = window.hide();
        }
      }
    })
    .setup(|app| {
      if let Some(window) = app.get_webview_window("main") {
        if let Some(monitor) = window.primary_monitor()? {
          let monitor_size = monitor.size();
          let monitor_position = monitor.position();
          let window_size = window.outer_size()?;
          let x = monitor_position.x
            + (monitor_size.width.saturating_sub(window_size.width) / 2) as i32;
          let y = monitor_position.y
            + (monitor_size.height.saturating_sub(window_size.height) / 2) as i32;
          window.set_position(tauri::PhysicalPosition::new(x, y))?;
        }
        window.show()?;
        window.set_focus()?;
      }
      if let Some(window) = app.get_webview_window("quick-tasks") {
        window.set_visible_on_all_workspaces(true)?;
        window.set_always_on_top(true)?;
        if let Some(monitor) = window.primary_monitor()? {
          let monitor_size = monitor.size();
          let monitor_position = monitor.position();
          let window_size = window.outer_size()?;
          let x = monitor_position.x + monitor_size.width as i32 - window_size.width as i32 - 28;
          let y = monitor_position.y + 72;
          window.set_position(tauri::PhysicalPosition::new(x, y))?;
        }
        window.show()?;
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let tauri::RunEvent::Reopen { .. } = event {
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.show();
          let _ = window.unminimize();
          let _ = window.set_focus();
        }
      }
    });
}

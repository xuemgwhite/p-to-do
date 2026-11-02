pub mod sqlite_batch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let migrations = vec![tauri_plugin_sql::Migration {
    version: 1,
    description: "initial_focus_mind_schema",
    sql: include_str!("../migrations/0001_initial.sql"),
    kind: tauri_plugin_sql::MigrationKind::Up,
  }];

  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      sqlite_batch::execute_sqlite_batch,
      sqlite_batch::checkpoint_focus_mind_database,
      sqlite_batch::validate_focus_mind_database
    ])
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations("sqlite:focus-mind.db", migrations)
        .build(),
    )
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

use app_lib::sqlite_batch::{execute_batch_at_path, SqliteStatement};
use serde_json::json;
use sqlx::{Connection, Row, SqliteConnection};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn temporary_database_path(label: &str) -> PathBuf {
  let nonce = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("system clock must be after the Unix epoch")
    .as_nanos();
  std::env::temp_dir().join(format!(
    "focus-mind-{label}-{}-{nonce}.db",
    std::process::id()
  ))
}

async fn count_rows(path: &PathBuf) -> i64 {
  let url = format!("sqlite:{}", path.display());
  let mut connection = SqliteConnection::connect(&url)
    .await
    .expect("test database must open");
  sqlx::query("SELECT COUNT(*) AS count FROM entries")
    .fetch_one(&mut connection)
    .await
    .expect("count query must succeed")
    .get("count")
}

#[test]
fn commits_every_statement_in_one_batch() {
  tauri::async_runtime::block_on(async {
    let path = temporary_database_path("commit");
    execute_batch_at_path(
      &path,
      vec![
        SqliteStatement::new("CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT)", vec![]),
        SqliteStatement::new("INSERT INTO entries (value) VALUES (?)", vec![json!("first")]),
        SqliteStatement::new("INSERT INTO entries (value) VALUES (?)", vec![json!("second")]),
      ],
    )
    .await
    .expect("batch must commit");

    assert_eq!(count_rows(&path).await, 2);
    std::fs::remove_file(path).expect("test database must be removable");
  });
}

#[test]
fn rolls_back_every_statement_when_one_fails() {
  tauri::async_runtime::block_on(async {
    let path = temporary_database_path("rollback");
    execute_batch_at_path(
      &path,
      vec![SqliteStatement::new(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT)",
        vec![],
      )],
    )
    .await
    .expect("schema batch must commit");

    let result = execute_batch_at_path(
      &path,
      vec![
        SqliteStatement::new("INSERT INTO entries (value) VALUES (?)", vec![json!("first")]),
        SqliteStatement::new("INSERT INTO missing_table (value) VALUES (?)", vec![json!("fail")]),
      ],
    )
    .await;

    assert!(result.is_err());
    assert_eq!(count_rows(&path).await, 0);
    std::fs::remove_file(path).expect("test database must be removable");
  });
}

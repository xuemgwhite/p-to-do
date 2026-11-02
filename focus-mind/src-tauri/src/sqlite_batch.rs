use serde::Deserialize;
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use sqlx::{Connection, Row, SqliteConnection};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Manager;

const FOCUS_MIND_DATABASE_URL: &str = "sqlite:focus-mind.db";
const FOCUS_MIND_DATABASE_FILENAME: &str = "focus-mind.db";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqliteStatement {
  sql: String,
  bind_values: Vec<Value>,
}

impl SqliteStatement {
  pub fn new(sql: impl Into<String>, bind_values: Vec<Value>) -> Self {
    Self {
      sql: sql.into(),
      bind_values,
    }
  }
}

pub async fn execute_batch_at_path(
  path: &Path,
  statements: Vec<SqliteStatement>,
) -> Result<Vec<u64>, String> {
  let options = SqliteConnectOptions::new()
    .filename(path)
    .create_if_missing(true)
    .foreign_keys(true)
    .journal_mode(SqliteJournalMode::Wal);
  let mut connection = SqliteConnection::connect_with(&options)
    .await
    .map_err(|error| error.to_string())?;
  let mut transaction = connection
    .begin()
    .await
    .map_err(|error| error.to_string())?;
  let mut rows_affected = Vec::with_capacity(statements.len());

  for statement in statements {
    let mut query = sqlx::query(&statement.sql);
    for value in statement.bind_values {
      query = match value {
        Value::Null => query.bind(Option::<String>::None),
        Value::Bool(value) => query.bind(value),
        Value::Number(value) => {
          if let Some(value) = value.as_i64() {
            query.bind(value)
          } else if let Some(value) = value.as_u64().and_then(|value| i64::try_from(value).ok()) {
            query.bind(value)
          } else if let Some(value) = value.as_f64() {
            query.bind(value)
          } else {
            transaction
              .rollback()
              .await
              .map_err(|error| error.to_string())?;
            return Err("unsupported numeric SQLite bind value".into());
          }
        }
        Value::String(value) => query.bind(value),
        Value::Array(_) | Value::Object(_) => {
          transaction
            .rollback()
            .await
            .map_err(|error| error.to_string())?;
          return Err("SQLite bind values must be null, boolean, number, or string".into());
        }
      };
    }

    match query.execute(&mut *transaction).await {
      Ok(result) => rows_affected.push(result.rows_affected()),
      Err(error) => {
        transaction
          .rollback()
          .await
          .map_err(|rollback_error| rollback_error.to_string())?;
        return Err(error.to_string());
      }
    }
  }

  transaction
    .commit()
    .await
    .map_err(|error| error.to_string())?;
  Ok(rows_affected)
}

#[tauri::command]
pub async fn execute_sqlite_batch(
  app: tauri::AppHandle,
  database_url: String,
  statements: Vec<SqliteStatement>,
) -> Result<Vec<u64>, String> {
  if database_url != FOCUS_MIND_DATABASE_URL {
    return Err("unsupported 土豆栗丝特 database URL".into());
  }

  let database_path = focus_mind_database_path(&app)?;

  execute_batch_at_path(&database_path, statements).await
}

fn focus_mind_database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let directory = app
    .path()
    .app_config_dir()
    .map_err(|error| error.to_string())?;
  Ok(directory.join(FOCUS_MIND_DATABASE_FILENAME))
}

#[tauri::command]
pub async fn checkpoint_focus_mind_database(app: tauri::AppHandle) -> Result<(), String> {
  let path = focus_mind_database_path(&app)?;
  let options = SqliteConnectOptions::new()
    .filename(path)
    .create_if_missing(false)
    .foreign_keys(true)
    .journal_mode(SqliteJournalMode::Wal);
  let mut connection = SqliteConnection::connect_with(&options)
    .await
    .map_err(|error| error.to_string())?;
  sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
    .execute(&mut connection)
    .await
    .map_err(|error| error.to_string())?;
  Ok(())
}

#[tauri::command]
pub async fn validate_focus_mind_database(
  path: String,
  expected_schema_version: i64,
) -> Result<(), String> {
  let mut header = [0_u8; 16];
  File::open(&path)
    .and_then(|mut file| file.read_exact(&mut header))
    .map_err(|error| error.to_string())?;
  if &header != b"SQLite format 3\0" {
    return Err("invalid SQLite header".into());
  }

  let options = SqliteConnectOptions::new()
    .filename(path)
    .read_only(true)
    .create_if_missing(false);
  let mut connection = SqliteConnection::connect_with(&options)
    .await
    .map_err(|error| error.to_string())?;
  let version: i64 = sqlx::query("SELECT version FROM schema_meta WHERE id = 1")
    .fetch_one(&mut connection)
    .await
    .map_err(|error| error.to_string())?
    .try_get("version")
    .map_err(|error| error.to_string())?;
  if version != expected_schema_version {
    return Err(format!(
      "unsupported schema version: expected {expected_schema_version}, found {version}"
    ));
  }
  Ok(())
}

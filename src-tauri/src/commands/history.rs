use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: i64,
    pub file_path: String,
    pub content_hash: String,
    pub timestamp: String,
    pub size: i64,
}

fn get_db_path() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("OpenCodeBrew");
    std::fs::create_dir_all(&path).ok();
    path.push("history.db");
    path
}

fn get_connection() -> Result<Connection, String> {
    let db_path = get_db_path();
    Connection::open(db_path).map_err(|e| format!("Failed to open database: {}", e))
}

#[command]
pub async fn init_history_db() -> Result<(), String> {
    let conn = get_connection()?;
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            content BLOB NOT NULL,
            timestamp TEXT NOT NULL,
            size INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("Failed to create table: {}", e))?;
    
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_file_path ON history(file_path)",
        [],
    )
    .map_err(|e| format!("Failed to create index: {}", e))?;
    
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_timestamp ON history(timestamp)",
        [],
    )
    .map_err(|e| format!("Failed to create index: {}", e))?;
    
    Ok(())
}

#[command]
pub async fn save_history_entry(file_path: String, content: String) -> Result<i64, String> {
    let conn = get_connection()?;
    
    let content_hash = format!("{:x}", md5::compute(content.as_bytes()));
    let timestamp = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let size = content.len() as i64;
    
    // Check if the last entry has the same hash (no actual changes)
    let last_hash: Option<String> = conn
        .query_row(
            "SELECT content_hash FROM history WHERE file_path = ? ORDER BY id DESC LIMIT 1",
            params![&file_path],
            |row| row.get(0),
        )
        .ok();
    
    if last_hash.as_ref() == Some(&content_hash) {
        // Content hasn't changed, don't save
        return Ok(-1);
    }
    
    conn.execute(
        "INSERT INTO history (file_path, content_hash, content, timestamp, size) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![&file_path, &content_hash, content.as_bytes(), &timestamp, size],
    )
    .map_err(|e| format!("Failed to save history: {}", e))?;
    
    let id = conn.last_insert_rowid();
    
    // Keep only the last 100 entries per file
    conn.execute(
        "DELETE FROM history WHERE file_path = ? AND id NOT IN (
            SELECT id FROM history WHERE file_path = ? ORDER BY id DESC LIMIT 100
        )",
        params![&file_path, &file_path],
    )
    .ok();
    
    Ok(id)
}

#[command]
pub async fn get_file_history(file_path: String, limit: Option<i32>) -> Result<Vec<HistoryEntry>, String> {
    let conn = get_connection()?;
    let limit = limit.unwrap_or(50);
    
    let mut stmt = conn
        .prepare(
            "SELECT id, file_path, content_hash, timestamp, size 
             FROM history 
             WHERE file_path = ? 
             ORDER BY id DESC 
             LIMIT ?",
        )
        .map_err(|e| format!("Failed to prepare statement: {}", e))?;
    
    let entries = stmt
        .query_map(params![&file_path, limit], |row| {
            Ok(HistoryEntry {
                id: row.get(0)?,
                file_path: row.get(1)?,
                content_hash: row.get(2)?,
                timestamp: row.get(3)?,
                size: row.get(4)?,
            })
        })
        .map_err(|e| format!("Failed to query: {}", e))?
        .filter_map(|e| e.ok())
        .collect();
    
    Ok(entries)
}

#[command]
pub async fn get_history_content(id: i64) -> Result<String, String> {
    let conn = get_connection()?;
    
    let content: Vec<u8> = conn
        .query_row(
            "SELECT content FROM history WHERE id = ?",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to get content: {}", e))?;
    
    String::from_utf8(content).map_err(|e| format!("Failed to decode content: {}", e))
}

use std::path::PathBuf;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager};
use chrono::Utc;
use uuid::Uuid;

// ============= Data Types =============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    pub id: String,
    pub model: String,
    pub provider: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageStats {
    pub model: String,
    pub provider: String,
    pub total_prompt_tokens: i64,
    pub total_completion_tokens: i64,
    pub total_tokens: i64,
    pub request_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverallStats {
    pub total_prompt_tokens: i64,
    pub total_completion_tokens: i64,
    pub total_tokens: i64,
    pub total_requests: i64,
    pub by_model: Vec<UsageStats>,
}

// ============= Database Connection =============

fn get_usage_db_path(app: &AppHandle) -> PathBuf {
    let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
    app_data_dir.join("usage.db")
}

fn get_connection(app: &AppHandle) -> Result<Connection, String> {
    let db_path = get_usage_db_path(app);
    
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    Connection::open(&db_path).map_err(|e| e.to_string())
}

// ============= Database Initialization =============

#[command]
pub async fn init_usage_db(app: AppHandle) -> Result<(), String> {
    let conn = get_connection(&app)?;
    
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS token_usage (
            id TEXT PRIMARY KEY,
            model TEXT NOT NULL,
            provider TEXT NOT NULL,
            prompt_tokens INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        
        CREATE INDEX IF NOT EXISTS idx_token_usage_model ON token_usage(model);
        CREATE INDEX IF NOT EXISTS idx_token_usage_provider ON token_usage(provider);
        CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage(created_at);
        "#
    ).map_err(|e| e.to_string())?;
    
    println!("[usage] Database initialized");
    Ok(())
}

// ============= Token Usage Commands =============

#[command]
pub async fn record_token_usage(
    app: AppHandle,
    model: String,
    provider: String,
    prompt_tokens: i64,
    completion_tokens: i64,
) -> Result<TokenUsage, String> {
    let conn = get_connection(&app)?;
    
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let total_tokens = prompt_tokens + completion_tokens;
    
    conn.execute(
        "INSERT INTO token_usage (id, model, provider, prompt_tokens, completion_tokens, total_tokens, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, model, provider, prompt_tokens, completion_tokens, total_tokens, now],
    ).map_err(|e| e.to_string())?;
    
    println!("[usage] Recorded usage: model={}, provider={}, prompt={}, completion={}, total={}", 
             model, provider, prompt_tokens, completion_tokens, total_tokens);
    
    Ok(TokenUsage {
        id,
        model,
        provider,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        created_at: now,
    })
}

#[command]
pub async fn get_usage_stats(app: AppHandle) -> Result<OverallStats, String> {
    let conn = get_connection(&app)?;
    
    // Get overall totals
    let (total_prompt, total_completion, total_tokens, total_requests): (i64, i64, i64, i64) = conn
        .query_row(
            "SELECT 
                COALESCE(SUM(prompt_tokens), 0),
                COALESCE(SUM(completion_tokens), 0),
                COALESCE(SUM(total_tokens), 0),
                COUNT(*)
             FROM token_usage",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| e.to_string())?;
    
    // Get per-model breakdown
    let mut stmt = conn
        .prepare(
            "SELECT 
                model,
                provider,
                COALESCE(SUM(prompt_tokens), 0) as total_prompt,
                COALESCE(SUM(completion_tokens), 0) as total_completion,
                COALESCE(SUM(total_tokens), 0) as total,
                COUNT(*) as request_count
             FROM token_usage
             GROUP BY model, provider
             ORDER BY total DESC"
        )
        .map_err(|e| e.to_string())?;
    
    let by_model: Vec<UsageStats> = stmt
        .query_map([], |row| {
            Ok(UsageStats {
                model: row.get(0)?,
                provider: row.get(1)?,
                total_prompt_tokens: row.get(2)?,
                total_completion_tokens: row.get(3)?,
                total_tokens: row.get(4)?,
                request_count: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    
    Ok(OverallStats {
        total_prompt_tokens: total_prompt,
        total_completion_tokens: total_completion,
        total_tokens,
        total_requests,
        by_model,
    })
}

#[command]
pub async fn get_usage_by_date_range(
    app: AppHandle,
    start_date: String,
    end_date: String,
) -> Result<OverallStats, String> {
    let conn = get_connection(&app)?;
    
    let (total_prompt, total_completion, total_tokens, total_requests): (i64, i64, i64, i64) = conn
        .query_row(
            "SELECT 
                COALESCE(SUM(prompt_tokens), 0),
                COALESCE(SUM(completion_tokens), 0),
                COALESCE(SUM(total_tokens), 0),
                COUNT(*)
             FROM token_usage
             WHERE created_at >= ?1 AND created_at <= ?2",
            params![start_date, end_date],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare(
            "SELECT 
                model,
                provider,
                COALESCE(SUM(prompt_tokens), 0),
                COALESCE(SUM(completion_tokens), 0),
                COALESCE(SUM(total_tokens), 0),
                COUNT(*)
             FROM token_usage
             WHERE created_at >= ?1 AND created_at <= ?2
             GROUP BY model, provider
             ORDER BY SUM(total_tokens) DESC"
        )
        .map_err(|e| e.to_string())?;
    
    let by_model: Vec<UsageStats> = stmt
        .query_map(params![start_date, end_date], |row| {
            Ok(UsageStats {
                model: row.get(0)?,
                provider: row.get(1)?,
                total_prompt_tokens: row.get(2)?,
                total_completion_tokens: row.get(3)?,
                total_tokens: row.get(4)?,
                request_count: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    
    Ok(OverallStats {
        total_prompt_tokens: total_prompt,
        total_completion_tokens: total_completion,
        total_tokens,
        total_requests,
        by_model,
    })
}

#[command]
pub async fn clear_usage_history(app: AppHandle) -> Result<(), String> {
    let conn = get_connection(&app)?;
    
    conn.execute("DELETE FROM token_usage", [])
        .map_err(|e| e.to_string())?;
    
    println!("[usage] Usage history cleared");
    Ok(())
}

#[command]
pub async fn get_recent_usage(app: AppHandle, limit: i32) -> Result<Vec<TokenUsage>, String> {
    let conn = get_connection(&app)?;
    
    let mut stmt = conn
        .prepare(
            "SELECT id, model, provider, prompt_tokens, completion_tokens, total_tokens, created_at
             FROM token_usage
             ORDER BY created_at DESC
             LIMIT ?1"
        )
        .map_err(|e| e.to_string())?;
    
    let usage: Vec<TokenUsage> = stmt
        .query_map(params![limit], |row| {
            Ok(TokenUsage {
                id: row.get(0)?,
                model: row.get(1)?,
                provider: row.get(2)?,
                prompt_tokens: row.get(3)?,
                completion_tokens: row.get(4)?,
                total_tokens: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    
    Ok(usage)
}

// ============= Helper Functions =============

/// Estimate token count from text (approximately 4 characters per token)
pub fn estimate_tokens(text: &str) -> i64 {
    (text.len() as f64 / 4.0).ceil() as i64
}

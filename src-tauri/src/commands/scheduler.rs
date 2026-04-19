use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager};
use tokio::sync::Mutex;
use chrono::Utc;
use uuid::Uuid;

// ============= Data Types =============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TriggerType {
    #[serde(rename = "cron")]
    Cron { expression: String },
    #[serde(rename = "file_watch")]
    FileWatch { path: String, events: Vec<String> },
    #[serde(rename = "webhook")]
    Webhook { path: String },
    #[serde(rename = "manual")]
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ActionType {
    #[serde(rename = "cli")]
    CliCommand { command: String, args: Vec<String>, cwd: Option<String> },
    #[serde(rename = "api")]
    ApiCall { method: String, url: String, headers: HashMap<String, String>, body: Option<String> },
    #[serde(rename = "mcp")]
    McpTool { server_id: String, tool_name: String, arguments: HashMap<String, serde_json::Value> },
    #[serde(rename = "ai_prompt")]
    AiPrompt { prompt: String, model: Option<String> },
    #[serde(rename = "save_file")]
    SaveFile { path: String, content: String, append: Option<bool> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub id: String,
    pub name: String,
    pub action_type: ActionType,
    pub order: i32,
    pub timeout_seconds: Option<i32>,
    pub on_error: String, // "stop" | "continue" | "retry"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub trigger: TriggerType,
    pub actions: Vec<Action>,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionLog {
    pub id: String,
    pub agent_id: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: String, // "running" | "success" | "failed" | "cancelled"
    pub trigger_type: String,
    pub output: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionLog {
    pub id: String,
    pub execution_id: String,
    pub action_id: String,
    pub action_name: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: String,
    pub output: Option<String>,
    pub error: Option<String>,
}

// ============= Database Connection =============

fn get_scheduler_db_path(app: &AppHandle) -> PathBuf {
    let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
    app_data_dir.join("scheduler.db")
}

async fn get_connection(app: &AppHandle) -> Result<Connection, String> {
    let db_path = get_scheduler_db_path(app);
    
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    Connection::open(&db_path).map_err(|e| e.to_string())
}

// ============= Database Initialization =============

#[command]
pub async fn init_scheduler_db(app: AppHandle) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS agents (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            trigger_json TEXT NOT NULL,
            actions_json TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        
        CREATE TABLE IF NOT EXISTS execution_logs (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            status TEXT NOT NULL,
            trigger_type TEXT NOT NULL,
            output TEXT,
            error TEXT,
            FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
        );
        
        CREATE TABLE IF NOT EXISTS action_logs (
            id TEXT PRIMARY KEY,
            execution_id TEXT NOT NULL,
            action_id TEXT NOT NULL,
            action_name TEXT NOT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            status TEXT NOT NULL,
            output TEXT,
            error TEXT,
            FOREIGN KEY (execution_id) REFERENCES execution_logs(id) ON DELETE CASCADE
        );
        
        CREATE INDEX IF NOT EXISTS idx_executions_agent ON execution_logs(agent_id);
        CREATE INDEX IF NOT EXISTS idx_executions_started ON execution_logs(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_action_logs_execution ON action_logs(execution_id);
        "#,
    )
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

// ============= Agent CRUD =============

#[command]
pub async fn list_agents(app: AppHandle) -> Result<Vec<Agent>, String> {
    let conn = get_connection(&app).await?;
    
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, trigger_json, actions_json, enabled, created_at, updated_at 
             FROM agents ORDER BY name"
        )
        .map_err(|e| e.to_string())?;
    
    let agents = stmt
        .query_map([], |row| {
            let trigger_json: String = row.get(3)?;
            let actions_json: String = row.get(4)?;
            
            Ok(Agent {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                trigger: serde_json::from_str(&trigger_json).unwrap_or(TriggerType::Manual),
                actions: serde_json::from_str(&actions_json).unwrap_or_default(),
                enabled: row.get::<_, i32>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    
    Ok(agents)
}

#[command]
pub async fn create_agent(
    app: AppHandle,
    name: String,
    description: Option<String>,
    trigger: TriggerType,
    actions: Vec<Action>,
) -> Result<Agent, String> {
    let conn = get_connection(&app).await?;
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    
    let trigger_json = serde_json::to_string(&trigger).map_err(|e| e.to_string())?;
    let actions_json = serde_json::to_string(&actions).map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT INTO agents (id, name, description, trigger_json, actions_json, enabled, created_at, updated_at) 
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7)",
        params![&id, &name, &description, &trigger_json, &actions_json, &now, &now],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(Agent {
        id,
        name,
        description,
        trigger,
        actions,
        enabled: true,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[command]
pub async fn update_agent(
    app: AppHandle,
    id: String,
    name: String,
    description: Option<String>,
    trigger: TriggerType,
    actions: Vec<Action>,
    enabled: bool,
) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    let now = Utc::now().to_rfc3339();
    
    let trigger_json = serde_json::to_string(&trigger).map_err(|e| e.to_string())?;
    let actions_json = serde_json::to_string(&actions).map_err(|e| e.to_string())?;
    
    conn.execute(
        "UPDATE agents SET name = ?1, description = ?2, trigger_json = ?3, actions_json = ?4, enabled = ?5, updated_at = ?6 WHERE id = ?7",
        params![&name, &description, &trigger_json, &actions_json, enabled as i32, &now, &id],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[command]
pub async fn delete_agent(app: AppHandle, id: String) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    
    conn.execute("DELETE FROM agents WHERE id = ?1", params![&id])
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[command]
pub async fn toggle_agent(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    let now = Utc::now().to_rfc3339();
    
    conn.execute(
        "UPDATE agents SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
        params![enabled as i32, &now, &id],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

// ============= Execution =============

#[command]
#[allow(non_snake_case)]
pub async fn execute_agent(app: AppHandle, agentId: String) -> Result<ExecutionLog, String> {
    let conn = get_connection(&app).await?;
    
    // Get agent
    let agent: Agent = conn
        .query_row(
            "SELECT id, name, description, trigger_json, actions_json, enabled, created_at, updated_at 
             FROM agents WHERE id = ?1",
            [&agentId],
            |row| {
                let trigger_json: String = row.get(3)?;
                let actions_json: String = row.get(4)?;
                
                Ok(Agent {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    trigger: serde_json::from_str(&trigger_json).unwrap_or(TriggerType::Manual),
                    actions: serde_json::from_str(&actions_json).unwrap_or_default(),
                    enabled: row.get::<_, i32>(5)? != 0,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    
    // Create execution log
    let execution_id = Uuid::new_v4().to_string();
    let started_at = Utc::now().to_rfc3339();
    let trigger_type = match &agent.trigger {
        TriggerType::Cron { .. } => "cron",
        TriggerType::FileWatch { .. } => "file_watch",
        TriggerType::Webhook { .. } => "webhook",
        TriggerType::Manual => "manual",
    };
    
    conn.execute(
        "INSERT INTO execution_logs (id, agent_id, started_at, status, trigger_type) VALUES (?1, ?2, ?3, 'running', ?4)",
        params![&execution_id, &agentId, &started_at, trigger_type],
    )
    .map_err(|e| e.to_string())?;
    
    let mut output_parts = Vec::new();
    let mut has_error = false;
    let mut error_msg = None;
    
    // Context for variable substitution between actions
    let mut context: HashMap<String, String> = HashMap::new();
    let mut previous_output = String::new();
    
    // Execute each action
    for (index, action) in agent.actions.iter().enumerate() {
        let action_id = Uuid::new_v4().to_string();
        let action_started = Utc::now().to_rfc3339();
        
        conn.execute(
            "INSERT INTO action_logs (id, execution_id, action_id, action_name, started_at, status) VALUES (?1, ?2, ?3, ?4, ?5, 'running')",
            params![&action_id, &execution_id, &action.id, &action.name, &action_started],
        )
        .map_err(|e| e.to_string())?;
        
        // Substitute variables in action before execution
        let substituted_action = substitute_variables(&action.action_type, &context, &previous_output);
        let result = execute_action(&app, &substituted_action).await;
        
        let action_finished = Utc::now().to_rfc3339();
        
        match result {
            Ok(output) => {
                output_parts.push(format!("[{}] Success: {}", action.name, output));
                
                // Store output for variable substitution in subsequent actions
                previous_output = output.clone();
                context.insert(format!("output_{}", index + 1), output.clone());
                context.insert(action.name.clone(), output.clone());
                
                conn.execute(
                    "UPDATE action_logs SET finished_at = ?1, status = 'success', output = ?2 WHERE id = ?3",
                    params![&action_finished, &output, &action_id],
                )
                .map_err(|e| e.to_string())?;
            }
            Err(err) => {
                output_parts.push(format!("[{}] Error: {}", action.name, err));
                has_error = true;
                error_msg = Some(err.clone());
                
                conn.execute(
                    "UPDATE action_logs SET finished_at = ?1, status = 'failed', error = ?2 WHERE id = ?3",
                    params![&action_finished, &err, &action_id],
                )
                .map_err(|e| e.to_string())?;
                
                if action.on_error == "stop" {
                    break;
                }
            }
        }
    }
    
    let finished_at = Utc::now().to_rfc3339();
    let status = if has_error { "failed" } else { "success" };
    let output = output_parts.join("\n");
    
    conn.execute(
        "UPDATE execution_logs SET finished_at = ?1, status = ?2, output = ?3, error = ?4 WHERE id = ?5",
        params![&finished_at, status, &output, &error_msg, &execution_id],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(ExecutionLog {
        id: execution_id,
        agent_id: agentId,
        started_at,
        finished_at: Some(finished_at),
        status: status.to_string(),
        trigger_type: trigger_type.to_string(),
        output: Some(output),
        error: error_msg,
    })
}

// Substitute variables like {{previous_output}}, {{output_1}}, {{action_name}} in action parameters
fn substitute_variables(
    action_type: &ActionType,
    context: &HashMap<String, String>,
    previous_output: &str,
) -> ActionType {
    let substitute = |text: &str| -> String {
        let mut result = text.to_string();
        
        // Replace {{previous_output}}
        result = result.replace("{{previous_output}}", previous_output);
        
        // Replace {{output_N}} patterns
        for (key, value) in context {
            result = result.replace(&format!("{{{{{}}}}}", key), value);
        }
        
        // Add timestamp variables
        let now = Utc::now();
        result = result.replace("{{date}}", &now.format("%Y-%m-%d").to_string());
        result = result.replace("{{time}}", &now.format("%H:%M:%S").to_string());
        result = result.replace("{{datetime}}", &now.format("%Y-%m-%d %H:%M:%S").to_string());
        result = result.replace("{{timestamp}}", &now.timestamp().to_string());
        
        result
    };
    
    match action_type {
        ActionType::CliCommand { command, args, cwd } => ActionType::CliCommand {
            command: substitute(command),
            args: args.iter().map(|a| substitute(a)).collect(),
            cwd: cwd.as_ref().map(|c| substitute(c)),
        },
        ActionType::ApiCall { method, url, headers, body } => ActionType::ApiCall {
            method: method.clone(),
            url: substitute(url),
            headers: headers.iter().map(|(k, v)| (k.clone(), substitute(v))).collect(),
            body: body.as_ref().map(|b| substitute(b)),
        },
        ActionType::McpTool { server_id, tool_name, arguments } => ActionType::McpTool {
            server_id: server_id.clone(),
            tool_name: tool_name.clone(),
            arguments: arguments.clone(), // TODO: substitute in JSON values
        },
        ActionType::AiPrompt { prompt, model } => ActionType::AiPrompt {
            prompt: substitute(prompt),
            model: model.clone(),
        },
        ActionType::SaveFile { path, content, append } => ActionType::SaveFile {
            path: substitute(path),
            content: substitute(content),
            append: *append,
        },
    }
}

async fn execute_action(app: &AppHandle, action_type: &ActionType) -> Result<String, String> {
    match action_type {
        ActionType::CliCommand { command, args, cwd } => {
            execute_cli_command(command, args, cwd.as_deref()).await
        }
        ActionType::ApiCall { method, url, headers, body } => {
            execute_api_call(method, url, headers, body.as_deref()).await
        }
        ActionType::McpTool { server_id, tool_name, arguments } => {
            execute_mcp_tool(app, server_id, tool_name, arguments).await
        }
        ActionType::AiPrompt { prompt, model } => {
            execute_ai_prompt_with_settings(app, prompt, model.as_deref()).await
        }
        ActionType::SaveFile { path, content, append } => {
            execute_save_file(path, content, append.unwrap_or(false)).await
        }
    }
}

async fn execute_save_file(path: &str, content: &str, append: bool) -> Result<String, String> {
    use std::fs::{self, OpenOptions};
    use std::io::Write;
    
    // Expand ~ to home directory
    let expanded_path = if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            home.join(&path[2..])
        } else {
            PathBuf::from(path)
        }
    } else {
        PathBuf::from(path)
    };
    
    // Create parent directories if they don't exist
    if let Some(parent) = expanded_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    if append {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&expanded_path)
            .map_err(|e| format!("Failed to open file for append: {}", e))?;
        
        writeln!(file, "{}", content).map_err(|e| format!("Failed to write to file: {}", e))?;
        
        Ok(format!("Appended {} bytes to {}", content.len(), expanded_path.display()))
    } else {
        fs::write(&expanded_path, content)
            .map_err(|e| format!("Failed to write file: {}", e))?;
        
        Ok(format!("Saved {} bytes to {}", content.len(), expanded_path.display()))
    }
}

async fn execute_cli_command(command: &str, args: &[String], cwd: Option<&str>) -> Result<String, String> {
    use std::process::Command;
    
    let mut cmd = Command::new(command);
    cmd.args(args);
    
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    
    let output = cmd.output().map_err(|e| e.to_string())?;
    
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

async fn execute_api_call(
    method: &str,
    url: &str,
    headers: &HashMap<String, String>,
    body: Option<&str>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    
    let mut request = match method.to_uppercase().as_str() {
        "GET" => client.get(url),
        "POST" => client.post(url),
        "PUT" => client.put(url),
        "DELETE" => client.delete(url),
        "PATCH" => client.patch(url),
        _ => return Err(format!("Unsupported HTTP method: {}", method)),
    };
    
    for (key, value) in headers {
        request = request.header(key, value);
    }
    
    if let Some(body) = body {
        request = request.body(body.to_string());
    }
    
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    
    if status.is_success() {
        Ok(text)
    } else {
        Err(format!("HTTP {} - {}", status, text))
    }
}

async fn execute_mcp_tool(
    _app: &AppHandle,
    server_id: &str,
    tool_name: &str,
    arguments: &HashMap<String, serde_json::Value>,
) -> Result<String, String> {
    use crate::commands::mcp;
    
    let args_value = serde_json::to_value(arguments).map_err(|e| e.to_string())?;
    
    let result = mcp::mcp_call_tool(
        server_id.to_string(),
        tool_name.to_string(),
        args_value,
    )
    .await?;
    
    let output: Vec<String> = result
        .content
        .iter()
        .filter_map(|c| c.text.clone())
        .collect();
    
    Ok(output.join("\n"))
}

async fn execute_ai_prompt_with_settings(
    app: &AppHandle,
    prompt: &str,
    model_override: Option<&str>,
) -> Result<String, String> {
    use crate::commands::settings::get_ai_settings_sync;
    
    let settings = get_ai_settings_sync(app);
    let client = reqwest::Client::new();
    
    let model = model_override.unwrap_or(&settings.model);
    let provider = &settings.ai_provider;
    
    println!("[scheduler] Executing AI prompt with provider '{}', model '{}': {}", provider, model, prompt);
    
    match provider.as_str() {
        "ollama" => {
            let base_url = if settings.ollama_url.is_empty() {
                "http://localhost:11434".to_string()
            } else {
                settings.ollama_url.clone()
            };
            let url = format!("{}/api/generate", base_url);
            
            let payload = serde_json::json!({
                "model": model,
                "prompt": prompt,
                "stream": false,
                "options": {
                    "temperature": settings.temperature
                }
            });
            
            let response = client
                .post(&url)
                .json(&payload)
                .timeout(std::time::Duration::from_secs(120))
                .send()
                .await
                .map_err(|e| format!("Failed to connect to Ollama at {}. Make sure Ollama is running. Error: {}", base_url, e))?;
            
            if !response.status().is_success() {
                let status = response.status();
                let error_text = response.text().await.unwrap_or_default();
                return Err(format!("Ollama returned error {}: {}", status, error_text));
            }
            
            let json: serde_json::Value = response.json().await
                .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;
            
            json.get("response")
                .and_then(|r| r.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "Invalid response format from Ollama".to_string())
        }
        
        "openai" => {
            if settings.openai_key.is_empty() {
                return Err("OpenAI API key not configured. Please set it in Settings.".to_string());
            }
            
            let payload = serde_json::json!({
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": settings.temperature,
                "max_tokens": settings.max_tokens
            });
            
            let response = client
                .post("https://api.openai.com/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", settings.openai_key))
                .header("Content-Type", "application/json")
                .json(&payload)
                .timeout(std::time::Duration::from_secs(120))
                .send()
                .await
                .map_err(|e| format!("OpenAI request failed: {}", e))?;
            
            if !response.status().is_success() {
                let error_text = response.text().await.unwrap_or_default();
                return Err(format!("OpenAI API error: {}", error_text));
            }
            
            let json: serde_json::Value = response.json().await
                .map_err(|e| format!("Failed to parse OpenAI response: {}", e))?;
            
            json.get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("message"))
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "Invalid response format from OpenAI".to_string())
        }
        
        "anthropic" => {
            if settings.anthropic_key.is_empty() {
                return Err("Anthropic API key not configured. Please set it in Settings.".to_string());
            }
            
            let payload = serde_json::json!({
                "model": model,
                "max_tokens": settings.max_tokens,
                "messages": [{"role": "user", "content": prompt}]
            });
            
            let response = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", &settings.anthropic_key)
                .header("anthropic-version", "2023-06-01")
                .header("Content-Type", "application/json")
                .json(&payload)
                .timeout(std::time::Duration::from_secs(120))
                .send()
                .await
                .map_err(|e| format!("Anthropic request failed: {}", e))?;
            
            if !response.status().is_success() {
                let error_text = response.text().await.unwrap_or_default();
                return Err(format!("Anthropic API error: {}", error_text));
            }
            
            let json: serde_json::Value = response.json().await
                .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;
            
            json.get("content")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("text"))
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "Invalid response format from Anthropic".to_string())
        }
        
        "custom" => {
            if settings.custom_base_url.is_empty() {
                return Err("Custom API base URL not configured. Please set it in Settings.".to_string());
            }
            
            let url = format!("{}/chat/completions", settings.custom_base_url.trim_end_matches('/'));
            
            let payload = serde_json::json!({
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": settings.temperature,
                "max_tokens": settings.max_tokens
            });
            
            let mut request = client
                .post(&url)
                .header("Content-Type", "application/json")
                .json(&payload)
                .timeout(std::time::Duration::from_secs(120));
            
            if !settings.custom_api_key.is_empty() {
                request = request.header("Authorization", format!("Bearer {}", settings.custom_api_key));
            }
            
            let response = request.send().await
                .map_err(|e| format!("Custom API request failed: {}", e))?;
            
            if !response.status().is_success() {
                let error_text = response.text().await.unwrap_or_default();
                return Err(format!("Custom API error: {}", error_text));
            }
            
            let json: serde_json::Value = response.json().await
                .map_err(|e| format!("Failed to parse response: {}", e))?;
            
            json.get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("message"))
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "Invalid response format from custom API".to_string())
        }
        
        _ => Err(format!("Unknown AI provider: {}. Please configure AI settings.", provider))
    }
}

// ============= Execution History =============

#[command]
#[allow(non_snake_case)]
pub async fn list_executions(
    app: AppHandle,
    agentId: Option<String>,
    limit: Option<i32>,
) -> Result<Vec<ExecutionLog>, String> {
    let conn = get_connection(&app).await?;
    let limit = limit.unwrap_or(50);
    
    let sql = if agentId.is_some() {
        "SELECT id, agent_id, started_at, finished_at, status, trigger_type, output, error 
         FROM execution_logs WHERE agent_id = ?1 ORDER BY started_at DESC LIMIT ?2"
    } else {
        "SELECT id, agent_id, started_at, finished_at, status, trigger_type, output, error 
         FROM execution_logs ORDER BY started_at DESC LIMIT ?1"
    };
    
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    
    let executions: Vec<ExecutionLog> = if let Some(aid) = agentId {
        stmt.query_map(params![&aid, limit], |row| {
            Ok(ExecutionLog {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                started_at: row.get(2)?,
                finished_at: row.get(3)?,
                status: row.get(4)?,
                trigger_type: row.get(5)?,
                output: row.get(6)?,
                error: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map(params![limit], |row| {
            Ok(ExecutionLog {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                started_at: row.get(2)?,
                finished_at: row.get(3)?,
                status: row.get(4)?,
                trigger_type: row.get(5)?,
                output: row.get(6)?,
                error: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    };
    
    Ok(executions)
}

#[command]
#[allow(non_snake_case)]
pub async fn get_execution_details(app: AppHandle, executionId: String) -> Result<(ExecutionLog, Vec<ActionLog>), String> {
    let conn = get_connection(&app).await?;
    
    let execution: ExecutionLog = conn
        .query_row(
            "SELECT id, agent_id, started_at, finished_at, status, trigger_type, output, error 
             FROM execution_logs WHERE id = ?1",
            [&executionId],
            |row| {
                Ok(ExecutionLog {
                    id: row.get(0)?,
                    agent_id: row.get(1)?,
                    started_at: row.get(2)?,
                    finished_at: row.get(3)?,
                    status: row.get(4)?,
                    trigger_type: row.get(5)?,
                    output: row.get(6)?,
                    error: row.get(7)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare(
            "SELECT id, execution_id, action_id, action_name, started_at, finished_at, status, output, error 
             FROM action_logs WHERE execution_id = ?1 ORDER BY started_at"
        )
        .map_err(|e| e.to_string())?;
    
    let action_logs: Vec<ActionLog> = stmt
        .query_map([&executionId], |row| {
            Ok(ActionLog {
                id: row.get(0)?,
                execution_id: row.get(1)?,
                action_id: row.get(2)?,
                action_name: row.get(3)?,
                started_at: row.get(4)?,
                finished_at: row.get(5)?,
                status: row.get(6)?,
                output: row.get(7)?,
                error: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    
    Ok((execution, action_logs))
}

#[command]
#[allow(non_snake_case)]
pub async fn clear_execution_history(app: AppHandle, agentId: Option<String>) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    
    if let Some(aid) = agentId {
        conn.execute("DELETE FROM execution_logs WHERE agent_id = ?1", params![&aid])
            .map_err(|e| e.to_string())?;
    } else {
        conn.execute("DELETE FROM execution_logs", [])
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

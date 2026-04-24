use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager};
use tokio::sync::Mutex;
use chrono::Utc;
use uuid::Uuid;

// ============= Default AI System Prompt (with web access capabilities) =============

const DEFAULT_AI_SYSTEM_PROMPT: &str = r#"You are a helpful AI assistant with access to web tools. You MUST use these tools for ANY question about:
- **Stock prices, market data, cryptocurrency prices** - These change constantly, NEVER guess or make up numbers
- **Current events, recent news, or anything time-sensitive**
- **Weather, sports scores, or live data**

### Available Tools (use XML tags):

**Search the web:**
<search_web query="your search query" />

**Fetch content from a URL:**
<fetch_url url="https://example.com/page" />

**Get a stock quote:**
<get_stock_quote symbol="TICKER" />

**Get market movers (gainers/losers/active):**
<get_market_movers />

### STOCK QUERIES - ALWAYS USE THE CORRECT TOOL:
- For a specific stock price (AMD, AAPL, etc.): <get_stock_quote symbol="TICKER" />
- For top gainers/losers: <get_market_movers />
- For stock news: <search_web query="TICKER news" />

### CRITICAL RULES:
1. NEVER just tell the user to "check these links" - FETCH the data and present the actual numbers
2. NEVER make up stock prices or financial data
3. ALWAYS use the stock quote tool for specific tickers
4. ALWAYS present data in a clear table format
5. NEVER say you don't have access to live data - you DO have tools for it
6. NEVER give generic advice about checking financial websites yourself"#;

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
pub struct ModelSettings {
    #[serde(rename = "provider")]
    pub provider: String,
    #[serde(rename = "model")]
    pub model: String,
    #[serde(rename = "temperature")]
    pub temperature: f32,
    #[serde(rename = "maxTokens")]
    pub max_tokens: i32,
    #[serde(rename = "ollamaUrl")]
    pub ollama_url: Option<String>,
    #[serde(rename = "openaiKey")]
    pub openai_key: Option<String>,
    #[serde(rename = "anthropicKey")]
    pub anthropic_key: Option<String>,
    #[serde(rename = "customBaseUrl")]
    pub custom_base_url: Option<String>,
    #[serde(rename = "customApiKey")]
    pub custom_api_key: Option<String>,
}

impl Default for ModelSettings {
    fn default() -> Self {
        Self {
            provider: "ollama".to_string(),
            model: String::new(),
            temperature: 0.7,
            max_tokens: 4096,
            ollama_url: None,
            openai_key: None,
            anthropic_key: None,
            custom_base_url: None,
            custom_api_key: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ActionType {
    #[serde(rename = "cli")]
    CliCommand { command: String, args: Vec<String>, cwd: Option<String> },
    #[serde(rename = "api")]
    ApiCall {
        method: String,
        url: String,
        headers: HashMap<String, String>,
        body: Option<String>,
        // auth
        auth_type: String, // "none" | "basic" | "bearer" | "api_key"
        auth_username: Option<String>,
        auth_password: Option<String>,
        auth_bearer_token: Option<String>,
        auth_api_key_name: Option<String>,
        auth_api_key_value: Option<String>,
        // content type
        content_type: Option<String>,
        // request body type
        body_type: Option<String>, // "raw" | "json" | "form_data"
        // query params
        query_params: Option<HashMap<String, String>>,
        // network
        follow_redirects: Option<bool>,
        timeout_seconds: Option<f64>,
    },
    #[serde(rename = "mcp")]
    McpTool { server_id: String, tool_name: String, arguments: HashMap<String, serde_json::Value> },
    #[serde(rename = "ai_prompt")]
    AiPrompt { prompt: String, system_prompt: Option<String>, model_settings: Option<ModelSettings> },
    #[serde(rename = "save_file")]
    SaveFile { path: String, content: String, append: Option<bool> },
    #[serde(rename = "send_email")]
    SendEmail { from: String, to: String, subject: String, body: String, smtp_host: String, smtp_port: u16, use_tls: bool, password: String },
    #[serde(rename = "send_slack")]
    SendSlack { webhook_url: String, channel: String, message: String, username: Option<String> },
    #[serde(rename = "send_discord")]
    SendDiscord { webhook_url: String, content: String, username: Option<String>, avatar_url: Option<String> },
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
        ActionType::ApiCall {
            method, url, headers, body,
            auth_type, auth_username, auth_password, auth_bearer_token,
            auth_api_key_name, auth_api_key_value, content_type, body_type,
            query_params, follow_redirects, timeout_seconds,
        } => ActionType::ApiCall {
            method: method.clone(),
            url: substitute(url),
            headers: headers.iter().map(|(k, v)| (k.clone(), substitute(v))).collect(),
            body: body.as_ref().map(|b| substitute(b)),
            auth_type: substitute(auth_type),
            auth_username: auth_username.as_ref().map(|v| substitute(v)),
            auth_password: auth_password.as_ref().map(|v| substitute(v)),
            auth_bearer_token: auth_bearer_token.as_ref().map(|v| substitute(v)),
            auth_api_key_name: auth_api_key_name.as_ref().map(|v| substitute(v)),
            auth_api_key_value: auth_api_key_value.as_ref().map(|v| substitute(v)),
            content_type: content_type.as_ref().map(|v| substitute(v)),
            body_type: body_type.as_ref().map(|v| substitute(v)),
            query_params: query_params.as_ref().map(|m| {
                m.iter().map(|(k, v)| (k.clone(), substitute(v))).collect()
            }),
            follow_redirects: *follow_redirects,
            timeout_seconds: *timeout_seconds,
        },
        ActionType::McpTool { server_id, tool_name, arguments } => ActionType::McpTool {
            server_id: server_id.clone(),
            tool_name: tool_name.clone(),
            arguments: arguments.clone(), // TODO: substitute in JSON values
        },
        ActionType::AiPrompt { prompt, system_prompt, model_settings } => ActionType::AiPrompt {
            prompt: substitute(prompt),
            system_prompt: system_prompt.as_ref().map(|s| substitute(s)),
            model_settings: model_settings.as_ref().map(|ms| ModelSettings {
                provider: substitute(&ms.provider),
                model: substitute(&ms.model),
                temperature: ms.temperature,
                max_tokens: ms.max_tokens,
                ollama_url: ms.ollama_url.clone(),
                openai_key: ms.openai_key.clone(),
                anthropic_key: ms.anthropic_key.clone(),
                custom_base_url: ms.custom_base_url.clone(),
                custom_api_key: ms.custom_api_key.clone(),
            }),
        },
        ActionType::SaveFile { path, content, append } => ActionType::SaveFile {
            path: substitute(path),
            content: substitute(content),
            append: *append,
        },
        ActionType::SendEmail { from, to, subject, body, smtp_host, smtp_port, use_tls, password } => ActionType::SendEmail {
            from: substitute(from),
            to: substitute(to),
            subject: substitute(subject),
            body: substitute(body),
            smtp_host: substitute(smtp_host),
            smtp_port: *smtp_port,
            use_tls: *use_tls,
            password: substitute(password),
        },
        ActionType::SendSlack { webhook_url, channel, message, username } => ActionType::SendSlack {
            webhook_url: substitute(webhook_url),
            channel: substitute(channel),
            message: substitute(message),
            username: username.clone(),
        },
        ActionType::SendDiscord { webhook_url, content, username, avatar_url } => ActionType::SendDiscord {
            webhook_url: substitute(webhook_url),
            content: substitute(content),
            username: username.clone(),
            avatar_url: avatar_url.clone(),
        },
    }
}

async fn execute_action(app: &AppHandle, action_type: &ActionType) -> Result<String, String> {
    match action_type {
        ActionType::CliCommand { command, args, cwd } => {
            execute_cli_command(command, args, cwd.as_deref()).await
        }
        ActionType::ApiCall {
            method, url, headers, body,
            auth_type, auth_username, auth_password, auth_bearer_token,
            auth_api_key_name, auth_api_key_value, content_type, body_type,
            query_params, follow_redirects, timeout_seconds,
        } => {
            execute_api_call(
                &method,
                &url,
                headers,
                body.as_deref(),
                &auth_type,
                auth_username.as_deref(), auth_password.as_deref(),
                auth_bearer_token.as_deref(),
                auth_api_key_name.as_deref(), auth_api_key_value.as_deref(),
                content_type.as_deref(), body_type.as_deref(),
                query_params.as_ref(),
                follow_redirects.unwrap_or(true), timeout_seconds.clone(),
            ).await
        }
        ActionType::McpTool { server_id, tool_name, arguments } => {
            execute_mcp_tool(app, server_id, tool_name, arguments).await
        }
        ActionType::AiPrompt { prompt, system_prompt, model_settings } => {
            execute_ai_prompt(app, prompt, system_prompt.as_deref(), model_settings.as_ref()).await
        }
        ActionType::SaveFile { path, content, append } => {
            execute_save_file(path, content, append.unwrap_or(false)).await
        }
        ActionType::SendEmail { from, to, subject, body, smtp_host, smtp_port, use_tls, password } => {
            execute_send_email(from, to, subject, body, smtp_host, *smtp_port, *use_tls, password).await
        }
        ActionType::SendSlack { webhook_url, channel, message, username } => {
            execute_send_slack(webhook_url, channel, message, username.as_deref()).await
        }
        ActionType::SendDiscord { webhook_url, content, username, avatar_url } => {
            execute_send_discord(webhook_url, content, username.as_deref(), avatar_url.as_deref()).await
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
    auth_type: &str,
    auth_username: Option<&str>,
    auth_password: Option<&str>,
    auth_bearer_token: Option<&str>,
    auth_api_key_name: Option<&str>,
    auth_api_key_value: Option<&str>,
    content_type: Option<&str>,
    body_type: Option<&str>,
    query_params: Option<&HashMap<String, String>>,
    follow_redirects: bool,
    timeout_seconds: Option<f64>,
) -> Result<String, String> {
    // Build the URL with query params
    let url = if let Some(params) = query_params {
        if params.is_empty() {
            url.to_string()
        } else {
            let mut url_parts = url.splitn(2, '?');
            let base = url_parts.next().unwrap_or(url);
            let existing_query = url_parts.next().unwrap_or("");
            let mut all_params: Vec<(String, String)> = Vec::new();

            // Parse existing query params
            if !existing_query.is_empty() {
                for pair in existing_query.split('&') {
                    if let Some((k, v)) = pair.split_once('=') {
                        all_params.push((
                            urlencoding::decode(k).unwrap_or_default().to_string(),
                            urlencoding::decode(v).unwrap_or_default().to_string(),
                        ));
                    }
                }
            }

            // Append action params
            all_params.extend(params.iter().map(|(k, v)| (k.clone(), v.clone())));

            let query_str: Vec<String> = all_params.iter()
                .map(|(k, v)| format!("{}={}", urlencoding::encode(&k), urlencoding::encode(&v)))
                .collect();

            if query_str.is_empty() {
                url.to_string()
            } else {
                format!("{}?{}", base, query_str.join("&"))
            }
        }
    } else {
        url.to_string()
    };

    let client_builder = reqwest::Client::builder()
        .redirect(if follow_redirects {
            reqwest::redirect::Policy::limited(10)
        } else {
            reqwest::redirect::Policy::none()
        });

    let client_builder = if let Some(seconds) = timeout_seconds {
        client_builder.timeout(std::time::Duration::from_secs_f64(seconds))
    } else {
        client_builder
    };

    let client = client_builder.build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut request = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH" => client.patch(&url),
        _ => return Err(format!("Unsupported HTTP method: {}", method)),
    };

    // Apply auth
    match auth_type {
        "basic" => {
            let username = auth_username.unwrap_or("");
            let password = auth_password.unwrap_or("");
            request = request.basic_auth(username, Some(password));
        }
        "bearer" => {
            let token = auth_bearer_token.ok_or("Bearer token is required")?;
            request = request.bearer_auth(token);
        }
        "api_key" => {
            let key_name = auth_api_key_name.ok_or("API key name is required")?.to_string();
            let key_value = auth_api_key_value.ok_or("API key value is required")?.to_string();
            request = request.header(key_name, key_value);
        }
        _ => {} // no auth
    }

    // Apply content type
    let ct = content_type.unwrap_or("application/json");
    request = request.header("Content-Type", ct);

    // Apply custom headers (auth-type headers above may override api_key auth)
    for (key, value) in headers {
        request = request.header(key, value);
    }

    // Apply body based on body_type
    if let Some(body) = body {
        let body = match body_type.unwrap_or("raw") {
            "json" => {
                // Validate and format as JSON
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(body) {
                    serde_json::to_string_pretty(&val).unwrap_or(body.to_string())
                } else {
                    body.to_string()
                }
            }
            "form_data" => {
                // Convert JSON or key=value to form urlencoded
                if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(body) {
                    let form: Vec<(String, String)> = map.iter()
                        .map(|(k, v)| (urlencoding::encode(k).to_string(), urlencoding::encode(v).to_string()))
                        .collect();
                    form.iter().map(|(k, v)| format!("{}={}", k, v)).collect::<Vec<_>>().join("&")
                } else {
                    body.to_string()
                }
            }
            _ => body.to_string(),
        };
        request = request.body(body);
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();

    if !status.is_success() {
        let text = response.text().await.map_err(|e| e.to_string())?;
        return Err(format!("HTTP {} - {}", status, text));
    }

    let text = response.text().await.map_err(|e| e.to_string())?;
    Ok(text)
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

async fn execute_ai_prompt(
    app: &AppHandle,
    prompt: &str,
    system_prompt: Option<&str>,
    model_settings: Option<&ModelSettings>,
) -> Result<String, String> {
    use crate::commands::settings::get_ai_settings_sync;

    let global = get_ai_settings_sync(app);

    // Merge action-level settings over global settings (action takes precedence)
    let model_settings = model_settings.cloned().unwrap_or_default();
    let provider = if !model_settings.provider.is_empty() { &model_settings.provider } else { &global.ai_provider };
    let model = if !model_settings.model.is_empty() { &model_settings.model } else { &global.model };
    let temperature = if model_settings.temperature != 0.0 { model_settings.temperature } else { global.temperature };
    let max_tokens = if model_settings.max_tokens != 0 { model_settings.max_tokens } else { global.max_tokens };
    let ollama_url = if let Some(ref url) = model_settings.ollama_url { url } else { &global.ollama_url };
    let openai_key = if let Some(ref key) = model_settings.openai_key { key } else { &global.openai_key };
    let anthropic_key = if let Some(ref key) = model_settings.anthropic_key { key } else { &global.anthropic_key };
    let custom_base_url = if let Some(ref url) = model_settings.custom_base_url { url } else { &global.custom_base_url };
    let custom_api_key = if let Some(ref key) = model_settings.custom_api_key { key } else { &global.custom_api_key };

    // Use a long timeout for AI generation - large models can take several minutes
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600)) // 10 minutes
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    println!("[scheduler] Executing AI prompt with provider '{}', model '{}'", provider, model);
    println!("[scheduler] Settings ollama_url: '{}'", ollama_url);
    if let Some(sys) = system_prompt {
        if !sys.trim().is_empty() {
            println!("[scheduler] System prompt ({}chars): {}...", sys.len(), &sys[..std::cmp::min(50, sys.len())]);
        }
    }
    println!("[scheduler] User prompt ({}chars): {}...", prompt.len(), &prompt[..std::cmp::min(50, prompt.len())]);

    match provider.as_str() {
        "ollama" => {
            let base_url = if ollama_url.is_empty() {
                "http://127.0.0.1:11434".to_string()
            } else {
                // Replace localhost with 127.0.0.1 to avoid DNS resolution issues in sandbox
                ollama_url.replace("localhost", "127.0.0.1")
            };
            println!("[scheduler] Using Ollama base URL: {}", base_url);

            // Build the effective system prompt (always include web access capabilities)
            let effective_sys = if let Some(sys) = system_prompt {
                if !sys.trim().is_empty() {
                    format!("{}\n\n---\n\n{}", sys, DEFAULT_AI_SYSTEM_PROMPT)
                } else {
                    DEFAULT_AI_SYSTEM_PROMPT.to_string()
                }
            } else {
                DEFAULT_AI_SYSTEM_PROMPT.to_string()
            };

            // Combine system prompt with user prompt for generate API
            // This is more reliable than the chat API across different Ollama versions
            let full_prompt = format!("{}\n\n---\n\n{}", effective_sys, prompt);
            
            let url = format!("{}/api/generate", base_url);
            println!("[scheduler] Full prompt length: {} chars", full_prompt.len());
            
            let payload = serde_json::json!({
                "model": model,
                "prompt": full_prompt,
                "stream": false,
                "options": {
                    "temperature": temperature
                }
            });
            
            println!("[scheduler] Sending request to: {}", url);
            println!("[scheduler] Payload size: {} bytes", serde_json::to_string(&payload).unwrap_or_default().len());
            
            let response = client
                .post(&url)
                .json(&payload)
                .send()
                .await
                .map_err(|e| {
                    println!("[scheduler] Request error details: {:?}", e);
                    if e.is_timeout() {
                        format!("Ollama request timed out. The model may need more time for complex prompts. Try a smaller model or shorter prompt.")
                    } else {
                        format!("Failed to connect to Ollama at {}. Make sure Ollama is running. Error: {}", base_url, e)
                    }
                })?;
            
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
            if openai_key.is_empty() {
                return Err("OpenAI API key not configured. Please set it in Settings.".to_string());
            }

            let effective_sys = if let Some(sys) = system_prompt {
                if !sys.trim().is_empty() {
                    format!("{}\n\n---\n\n{}", sys, DEFAULT_AI_SYSTEM_PROMPT)
                } else {
                    DEFAULT_AI_SYSTEM_PROMPT.to_string()
                }
            } else {
                DEFAULT_AI_SYSTEM_PROMPT.to_string()
            };

            let mut messages = Vec::new();
            messages.push(serde_json::json!({"role": "system", "content": effective_sys}));
            messages.push(serde_json::json!({"role": "user", "content": prompt}));
            
            let payload = serde_json::json!({
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens
            });
            
            let response = client
                .post("https://api.openai.com/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", openai_key))
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
            if anthropic_key.is_empty() {
                return Err("Anthropic API key not configured. Please set it in Settings.".to_string());
            }

            let effective_sys = if let Some(sys) = system_prompt {
                if !sys.trim().is_empty() {
                    format!("{}\n\n---\n\n{}", sys, DEFAULT_AI_SYSTEM_PROMPT)
                } else {
                    DEFAULT_AI_SYSTEM_PROMPT.to_string()
                }
            } else {
                DEFAULT_AI_SYSTEM_PROMPT.to_string()
            };

            let mut payload = serde_json::json!({
                "model": model,
                "max_tokens": max_tokens,
                "messages": [{"role": "user", "content": prompt}]
            });

            payload["system"] = serde_json::json!(effective_sys);
            
            let response = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", anthropic_key)
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
            if custom_base_url.is_empty() {
                return Err("Custom API base URL not configured. Please set it in Settings.".to_string());
            }
            
            let url = format!("{}/chat/completions", custom_base_url.trim_end_matches('/'));

            let effective_sys = if let Some(sys) = system_prompt {
                if !sys.trim().is_empty() {
                    format!("{}\n\n---\n\n{}", sys, DEFAULT_AI_SYSTEM_PROMPT)
                } else {
                    DEFAULT_AI_SYSTEM_PROMPT.to_string()
                }
            } else {
                DEFAULT_AI_SYSTEM_PROMPT.to_string()
            };

            let mut messages = Vec::new();
            messages.push(serde_json::json!({"role": "system", "content": effective_sys}));
            messages.push(serde_json::json!({"role": "user", "content": prompt}));
            
            let payload = serde_json::json!({
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens
            });
            
            let mut request = client
                .post(&url)
                .header("Content-Type", "application/json")
                .json(&payload)
                .timeout(std::time::Duration::from_secs(120));
            
            if !custom_api_key.is_empty() {
                request = request.header("Authorization", format!("Bearer {}", custom_api_key));
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

// ============= Notification Executors =============

async fn execute_send_email(
    from: &str,
    to: &str,
    subject: &str,
    body: &str,
    smtp_host: &str,
    smtp_port: u16,
    use_tls: bool,
    password: &str,
) -> Result<String, String> {
    use lettre::message::Message;
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{SmtpTransport, Transport};

    if smtp_host.is_empty() || password.is_empty() {
        return Err("SMTP host and password are required".to_string());
    }

    let email = Message::builder()
        .from(from.parse().map_err(|e| format!("Invalid 'from' address: {}", e))?)
        .to(to.parse().map_err(|e| format!("Invalid 'to' address: {}", e))?)
        .subject(subject)
        .body(body.to_string())
        .map_err(|e| format!("Failed to build email: {}", e))?;

    let credentials = Credentials::new(from.to_string(), password.to_string());

    let transport = if use_tls {
        SmtpTransport::starttls_relay(smtp_host)
            .map_err(|e| format!("Failed to configure SMTP relay: {}", e))?
            .port(smtp_port)
            .credentials(credentials)
            .build()
    } else {
        SmtpTransport::relay(smtp_host)
            .map_err(|e| format!("Failed to configure SMTP relay: {}", e))?
            .credentials(credentials)
            .build()
    };

    transport.send(&email).map_err(|e| format!("Failed to send email: {}", e))?;

    Ok(format!("Email sent to {} via {}", to, smtp_host))
}

async fn execute_send_slack(
    webhook_url: &str,
    channel: &str,
    message: &str,
    username: Option<&str>,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    let payload = if let Some(user) = username {
        serde_json::json!({
            "channel": channel,
            "username": user,
            "text": message
        })
    } else {
        serde_json::json!({
            "channel": channel,
            "text": message
        })
    };

    let response = client
        .post(webhook_url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Slack webhook request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Slack webhook error {}: {}", status, text));
    }

    Ok(format!("Slack message sent to channel: {}", channel))
}

async fn execute_send_discord(
    webhook_url: &str,
    content: &str,
    username: Option<&str>,
    avatar_url: Option<&str>,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    let mut payload = serde_json::json!({
        "content": content
    });

    if let Some(user) = username {
        payload["username"] = serde_json::json!(user);
    }
    if let Some(avatar) = avatar_url {
        payload["avatar_url"] = serde_json::json!(avatar);
    }

    let response = client
        .post(webhook_url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Discord webhook request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Discord webhook error {}: {}", status, text));
    }

    Ok("Discord message sent via webhook".to_string())
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

use std::collections::HashMap;
use std::path::PathBuf;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager};
use chrono::{Utc, Timelike, Datelike};
use uuid::Uuid;
use regex::Regex;

use crate::commands::web;
use crate::commands::usage;

// ============= Default AI System Prompt (with web access capabilities) =============

// Dynamic system prompt with current date - similar to Notes
fn get_ai_system_prompt() -> String {
    let now = chrono::Local::now();
    let today = now.format("%A, %B %d, %Y").to_string();
    let short_date = now.format("%b %d, %Y").to_string();
    
    format!(
r#"You are a helpful AI assistant with web access and real-time data capabilities.

CURRENT DATE: {today}

AVAILABLE TOOLS (use XML tags directly):

Search the web:
<search_web query="topic keywords {short_date}" />

Fetch content from a URL:
<fetch_url url="https://example.com/page" />

Get a stock quote:
<get_stock_quote symbol="TICKER" />

Get market movers:
<get_market_movers />

TOOL USAGE STRATEGY:
1. Search first with keywords + date to find relevant pages
2. Fetch the best URL from search results to get actual data
3. For rankings, ESPN and official sites have the best data

CRITICAL RULES:
1. ALWAYS use search_web first, then fetch_url to get actual data
2. NEVER make up data - use tools to get real information
3. Present data in clear table format with actual values
4. If search results only show links, use fetch_url on the most relevant URL
5. Be concise and direct"#,
        today = today,
        short_date = short_date
    )
}


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
#[serde(rename_all = "snake_case")]
pub enum CombineStrategy {
    Array,
    Named,
    MergeJson,
    FirstSuccess,
}

impl Default for CombineStrategy {
    fn default() -> Self {
        CombineStrategy::FirstSuccess
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStage {
    pub id: String,
    pub name: String,
    pub actions: Vec<Action>,
    pub combine_strategy: CombineStrategy,
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub trigger: TriggerType,
    // New: stage-based workflow (actions within stage run in parallel, stages run sequentially)
    #[serde(default)]
    pub stages: Vec<WorkflowStage>,
    // Legacy: flat actions array (for backward compatibility)
    #[serde(default)]
    pub actions: Vec<Action>,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl Agent {
    // Get effective stages - handles migration from legacy actions format
    pub fn get_stages(&self) -> Vec<WorkflowStage> {
        if !self.stages.is_empty() {
            return self.stages.clone();
        }
        
        // Migrate legacy actions: wrap each action in its own stage for sequential execution
        self.actions
            .iter()
            .enumerate()
            .map(|(idx, action)| WorkflowStage {
                id: format!("stage-{}", action.id),
                name: format!("Step {}", idx + 1),
                actions: vec![action.clone()],
                combine_strategy: CombineStrategy::FirstSuccess,
                order: idx as i32,
            })
            .collect()
    }
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
            
            // Try to parse stages first, fall back to actions for legacy data
            let stages: Vec<WorkflowStage> = serde_json::from_str(&actions_json).unwrap_or_default();
            let actions: Vec<Action> = if stages.is_empty() {
                serde_json::from_str(&actions_json).unwrap_or_default()
            } else {
                Vec::new()
            };
            
            Ok(Agent {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                trigger: serde_json::from_str(&trigger_json).unwrap_or(TriggerType::Manual),
                stages,
                actions,
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
    stages: Option<Vec<WorkflowStage>>,
) -> Result<Agent, String> {
    let conn = get_connection(&app).await?;
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    
    let trigger_json = serde_json::to_string(&trigger).map_err(|e| e.to_string())?;
    
    // If stages are provided, store them; otherwise store flat actions for backward compatibility
    let (final_stages, actions_json) = if let Some(ref s) = stages {
        if !s.is_empty() {
            // Store stages directly
            let stages_json = serde_json::to_string(s).map_err(|e| e.to_string())?;
            (s.clone(), stages_json)
        } else {
            // Empty stages, use actions
            let actions_json = serde_json::to_string(&actions).map_err(|e| e.to_string())?;
            let migrated_stages = actions
                .iter()
                .enumerate()
                .map(|(idx, action)| WorkflowStage {
                    id: format!("stage-{}", action.id),
                    name: format!("Step {}", idx + 1),
                    actions: vec![action.clone()],
                    combine_strategy: CombineStrategy::FirstSuccess,
                    order: idx as i32,
                })
                .collect();
            (migrated_stages, actions_json)
        }
    } else {
        // No stages provided, migrate from actions
        let actions_json = serde_json::to_string(&actions).map_err(|e| e.to_string())?;
        let migrated_stages = actions
            .iter()
            .enumerate()
            .map(|(idx, action)| WorkflowStage {
                id: format!("stage-{}", action.id),
                name: format!("Step {}", idx + 1),
                actions: vec![action.clone()],
                combine_strategy: CombineStrategy::FirstSuccess,
                order: idx as i32,
            })
            .collect();
        (migrated_stages, actions_json)
    };
    
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
        stages: final_stages,
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
    stages: Option<Vec<WorkflowStage>>,
    enabled: bool,
) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    let now = Utc::now().to_rfc3339();
    
    let trigger_json = serde_json::to_string(&trigger).map_err(|e| e.to_string())?;
    
    // If stages are provided, store them; otherwise store flat actions
    let actions_json = if let Some(ref s) = stages {
        if !s.is_empty() {
            serde_json::to_string(s).map_err(|e| e.to_string())?
        } else {
            serde_json::to_string(&actions).map_err(|e| e.to_string())?
        }
    } else {
        serde_json::to_string(&actions).map_err(|e| e.to_string())?
    };
    
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
                
                // Try to parse stages first, fall back to actions for legacy data
                let stages: Vec<WorkflowStage> = serde_json::from_str(&actions_json).unwrap_or_default();
                let actions: Vec<Action> = if stages.is_empty() {
                    serde_json::from_str(&actions_json).unwrap_or_default()
                } else {
                    Vec::new()
                };
                
                Ok(Agent {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    trigger: serde_json::from_str(&trigger_json).unwrap_or(TriggerType::Manual),
                    stages,
                    actions,
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
    
    // Context for variable substitution between stages/actions
    let mut context: HashMap<String, String> = HashMap::new();
    let mut previous_output = String::new();
    
    // Get effective stages (handles migration from legacy actions format)
    let stages = agent.get_stages();
    
    // Execute stages sequentially
    for (stage_index, stage) in stages.iter().enumerate() {
        output_parts.push(format!("=== Stage {}: {} ===", stage_index + 1, stage.name));
        
        // Execute all actions within the stage in parallel
        let action_futures: Vec<_> = stage.actions.iter().map(|action| {
            let app_clone = app.clone();
            let context_clone = context.clone();
            let previous_output_clone = previous_output.clone();
            let action_clone = action.clone();
            let execution_id_clone = execution_id.clone();
            
            async move {
                let action_log_id = Uuid::new_v4().to_string();
                let action_started = Utc::now().to_rfc3339();
                
                // Insert action log entry
                if let Ok(conn) = get_connection(&app_clone).await {
                    let _ = conn.execute(
                        "INSERT INTO action_logs (id, execution_id, action_id, action_name, started_at, status) VALUES (?1, ?2, ?3, ?4, ?5, 'running')",
                        params![&action_log_id, &execution_id_clone, &action_clone.id, &action_clone.name, &action_started],
                    );
                }
                
                // Substitute variables in action before execution
                let substituted_action = substitute_variables(&action_clone.action_type, &context_clone, &previous_output_clone);
                let result = execute_action(&app_clone, &substituted_action).await;
                
                let action_finished = Utc::now().to_rfc3339();
                
                // Update action log with result
                if let Ok(conn) = get_connection(&app_clone).await {
                    match &result {
                        Ok(output) => {
                            let _ = conn.execute(
                                "UPDATE action_logs SET finished_at = ?1, status = 'success', output = ?2 WHERE id = ?3",
                                params![&action_finished, &output, &action_log_id],
                            );
                        }
                        Err(err) => {
                            let _ = conn.execute(
                                "UPDATE action_logs SET finished_at = ?1, status = 'failed', error = ?2 WHERE id = ?3",
                                params![&action_finished, &err, &action_log_id],
                            );
                        }
                    }
                }
                
                (action_clone.name.clone(), result)
            }
        }).collect();
        
        // Wait for all actions in this stage to complete in parallel
        let results = futures::future::join_all(action_futures).await;
        
        // Process results and combine based on strategy
        let mut stage_outputs: Vec<(String, String)> = Vec::new();
        let mut stage_has_error = false;
        let mut should_stop = false;
        
        for (action_name, result) in &results {
            match result {
                Ok(output) => {
                    output_parts.push(format!("  [{}] Success: {}", action_name, output));
                    stage_outputs.push((action_name.clone(), output.clone()));
                    
                    // Store individual action output by name
                    context.insert(format!("{}_output", action_name), output.clone());
                    
                    // Also store by action ID for template compatibility
                    // Find the action ID from the stage actions
                    for action in &stage.actions {
                        if action.name == *action_name {
                            context.insert(format!("{}_output", action.id), output.clone());
                            // Also store with hyphens replaced by underscores for easier template use
                            context.insert(format!("{}_output", action.id.replace("-", "_")), output.clone());
                            break;
                        }
                    }
                }
                Err(err) => {
                    output_parts.push(format!("  [{}] Error: {}", action_name, err));
                    stage_has_error = true;
                    has_error = true;
                    error_msg = Some(err.clone());
                    
                    // Check if any action in this stage has on_error = "stop"
                    for action in &stage.actions {
                        if action.name == *action_name && action.on_error == "stop" {
                            should_stop = true;
                            break;
                        }
                    }
                }
            }
        }
        
        // Combine stage outputs based on combine strategy
        let combined_output = combine_stage_outputs(&stage.combine_strategy, &stage_outputs, &results);
        
        // Update context with stage output
        context.insert(format!("stage_{}_output", stage_index + 1), combined_output.clone());
        context.insert(format!("{}_output", stage.name), combined_output.clone());
        previous_output = combined_output;
        
        // Stop execution if any action with on_error="stop" failed
        if should_stop {
            output_parts.push(format!("  Stopping workflow due to error in stage {}", stage.name));
            break;
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
            execute_ai_prompt_with_tools(app, prompt, system_prompt.as_deref(), model_settings.as_ref()).await
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

// Combine outputs from parallel actions within a stage based on the combine strategy
fn combine_stage_outputs(
    strategy: &CombineStrategy,
    successful_outputs: &[(String, String)],
    all_results: &[(String, Result<String, String>)],
) -> String {
    match strategy {
        CombineStrategy::Array => {
            // All successful outputs as JSON array
            let outputs: Vec<&str> = successful_outputs.iter().map(|(_, o)| o.as_str()).collect();
            serde_json::to_string(&outputs).unwrap_or_else(|_| "[]".to_string())
        }
        CombineStrategy::Named => {
            // Each action's output as named JSON object
            let map: HashMap<&str, &str> = successful_outputs
                .iter()
                .map(|(name, output)| (name.as_str(), output.as_str()))
                .collect();
            serde_json::to_string(&map).unwrap_or_else(|_| "{}".to_string())
        }
        CombineStrategy::MergeJson => {
            // Merge all JSON outputs into one object
            let mut merged: HashMap<String, serde_json::Value> = HashMap::new();
            for (_, output) in successful_outputs {
                if let Ok(obj) = serde_json::from_str::<HashMap<String, serde_json::Value>>(output) {
                    merged.extend(obj);
                }
            }
            serde_json::to_string(&merged).unwrap_or_else(|_| "{}".to_string())
        }
        CombineStrategy::FirstSuccess => {
            // Use first successful result
            for (_, result) in all_results {
                if let Ok(output) = result {
                    return output.clone();
                }
            }
            String::new()
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

/// Record token usage for scheduler AI prompts
async fn record_scheduler_token_usage(app: &AppHandle, model: &str, provider: &str, prompt_content: &str, completion_content: &str) {
    let prompt_tokens = (prompt_content.len() as f64 / 4.0).ceil() as i64;
    let completion_tokens = (completion_content.len() as f64 / 4.0).ceil() as i64;
    
    println!("[scheduler] Recording token usage: model={}, provider={}, prompt={}, completion={}", 
             model, provider, prompt_tokens, completion_tokens);
    
    if let Err(e) = usage::record_token_usage(
        app.clone(),
        model.to_string(),
        provider.to_string(),
        prompt_tokens,
        completion_tokens,
    ).await {
        println!("[scheduler] Failed to record token usage: {}", e);
    }
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
    
    // Clone values needed for token usage recording
    let model_for_usage = model.clone();
    let provider_for_usage = provider.clone();
    let prompt_for_usage = prompt.to_string();
    let system_prompt_for_usage = system_prompt.map(|s| s.to_string()).unwrap_or_default();

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

            // Build the effective system prompt (always include web access capabilities with current date)
            let base_sys_prompt = get_ai_system_prompt();
            let effective_sys = if let Some(sys) = system_prompt {
                if !sys.trim().is_empty() {
                    format!("{}\n\n---\n\n{}", sys, base_sys_prompt)
                } else {
                    base_sys_prompt
                }
            } else {
                base_sys_prompt
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
            
            println!("[scheduler] Ollama raw response keys: {:?}", json.as_object().map(|o| o.keys().collect::<Vec<_>>()));
            
            let result = json.get("response")
                .and_then(|r| r.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| {
                    println!("[scheduler] Ollama response missing 'response' field. Full JSON: {}", 
                        serde_json::to_string_pretty(&json).unwrap_or_default());
                    "Invalid response format from Ollama".to_string()
                })?;
            
            println!("[scheduler] Ollama response length: {} chars", result.len());
            
            // Retry once if Ollama returns empty response (can happen with concurrent requests)
            if result.is_empty() {
                println!("[scheduler] Ollama returned empty response, retrying after delay...");
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                
                let retry_response = client
                    .post(&url)
                    .json(&payload)
                    .send()
                    .await
                    .map_err(|e| format!("Ollama retry failed: {}", e))?;
                
                if retry_response.status().is_success() {
                    let retry_json: serde_json::Value = retry_response.json().await
                        .map_err(|e| format!("Failed to parse Ollama retry response: {}", e))?;
                    
                    if let Some(retry_result) = retry_json.get("response").and_then(|r| r.as_str()) {
                        if !retry_result.is_empty() {
                            println!("[scheduler] Ollama retry succeeded with {} chars", retry_result.len());
                            let full_prompt_content = format!("{}\n{}", system_prompt_for_usage, prompt_for_usage);
                            record_scheduler_token_usage(app, &model_for_usage, &provider_for_usage, &full_prompt_content, retry_result).await;
                            return Ok(retry_result.to_string());
                        }
                    }
                }
                println!("[scheduler] Ollama retry also returned empty");
            }
            
            // Record token usage before returning
            let full_prompt_content = format!("{}\n{}", system_prompt_for_usage, prompt_for_usage);
            record_scheduler_token_usage(app, &model_for_usage, &provider_for_usage, &full_prompt_content, &result).await;
            
            Ok(result)
        }
        
        "openai" => {
            if openai_key.is_empty() {
                return Err("OpenAI API key not configured. Please set it in Settings.".to_string());
            }

            let base_sys_prompt = get_ai_system_prompt();
            let effective_sys = if let Some(sys) = system_prompt {
                if !sys.trim().is_empty() {
                    format!("{}\n\n---\n\n{}", sys, base_sys_prompt)
                } else {
                    base_sys_prompt
                }
            } else {
                base_sys_prompt
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
            
            let result = json.get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("message"))
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "Invalid response format from OpenAI".to_string())?;
            
            // Record token usage
            let full_prompt_content = format!("{}\n{}", system_prompt_for_usage, prompt_for_usage);
            record_scheduler_token_usage(app, &model_for_usage, &provider_for_usage, &full_prompt_content, &result).await;
            
            Ok(result)
        }
        
        "anthropic" => {
            if anthropic_key.is_empty() {
                return Err("Anthropic API key not configured. Please set it in Settings.".to_string());
            }

            let base_sys_prompt = get_ai_system_prompt();
            let effective_sys = if let Some(sys) = system_prompt {
                if !sys.trim().is_empty() {
                    format!("{}\n\n---\n\n{}", sys, base_sys_prompt)
                } else {
                    base_sys_prompt
                }
            } else {
                base_sys_prompt
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
            
            let result = json.get("content")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("text"))
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "Invalid response format from Anthropic".to_string())?;
            
            // Record token usage
            let full_prompt_content = format!("{}\n{}", system_prompt_for_usage, prompt_for_usage);
            record_scheduler_token_usage(app, &model_for_usage, &provider_for_usage, &full_prompt_content, &result).await;
            
            Ok(result)
        }
        
        "custom" => {
            if custom_base_url.is_empty() {
                return Err("Custom API base URL not configured. Please set it in Settings.".to_string());
            }
            
            let url = format!("{}/chat/completions", custom_base_url.trim_end_matches('/'));

            let base_sys_prompt = get_ai_system_prompt();
            let effective_sys = if let Some(sys) = system_prompt {
                if !sys.trim().is_empty() {
                    format!("{}\n\n---\n\n{}", sys, base_sys_prompt)
                } else {
                    base_sys_prompt
                }
            } else {
                base_sys_prompt
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
            
            let result = json.get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("message"))
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "Invalid response format from custom API".to_string())?;
            
            // Record token usage
            let full_prompt_content = format!("{}\n{}", system_prompt_for_usage, prompt_for_usage);
            record_scheduler_token_usage(app, &model_for_usage, &provider_for_usage, &full_prompt_content, &result).await;
            
            Ok(result)
        }
        
        _ => Err(format!("Unknown AI provider: {}. Please configure AI settings.", provider))
    }
}

// ============= Tool Execution for AI Prompts =============

// Wrapper for execute_ai_prompt that implements tool execution loop
// Similar to how OpenCodeNotes handles it - execute tools and feed results back to AI
async fn execute_ai_prompt_with_tools(
    app: &AppHandle,
    prompt: &str,
    system_prompt: Option<&str>,
    model_settings: Option<&ModelSettings>,
) -> Result<String, String> {
    const MAX_TOOL_ITERATIONS: usize = 5;
    
    let mut current_prompt = prompt.to_string();
    let mut iteration = 0;
    let mut final_response = String::new();
    
    loop {
        iteration += 1;
        println!("[scheduler::tools] Iteration {}/{}: Getting AI response for prompt ({} chars)...", 
            iteration, MAX_TOOL_ITERATIONS, current_prompt.len());
        
        // Get AI response
        let response = execute_ai_prompt(app, &current_prompt, system_prompt, model_settings).await?;
        
        println!("[scheduler::tools] AI response ({} chars): {}", 
            response.len(), 
            &response[..std::cmp::min(300, response.len())]);
        
        // Check if response contains tool calls
        let has_tools = response.contains("<search_web") 
            || response.contains("<fetch_url")
            || response.contains("<get_stock_quote")
            || response.contains("<get_market_movers");
        
        if !has_tools || iteration >= MAX_TOOL_ITERATIONS {
            if iteration >= MAX_TOOL_ITERATIONS && has_tools {
                println!("[scheduler::tools] Max iterations reached, returning response with unexecuted tools");
            } else {
                println!("[scheduler::tools] No tool calls detected, returning final response");
            }
            final_response = response;
            break;
        }
        
        println!("[scheduler::tools] AI response contains tool calls, executing and continuing...");
        
        // Execute tools and get results
        let (response_with_markers, tool_results) = execute_tools_in_response_with_results(&response).await;
        
        if tool_results.is_empty() {
            println!("[scheduler::tools] No tool results collected, returning response as-is");
            final_response = response;
            break;
        }
        
        // Build continuation prompt with tool results
        let tool_results_text = tool_results.join("\n\n");
        current_prompt = format!(
            r#"You previously requested to use tools. Here are the results:

{}

IMPORTANT: If the search results above only show links/titles but NOT the actual data you need (like specific player names, rankings, scores, numbers), you MUST use <fetch_url url="..." /> on the most relevant URL to get the actual content.

If you have the actual data you need, provide a complete answer with a well-formatted table showing the specific information requested (names, rankings, points, etc.)."#,
            tool_results_text
        );
        
        println!("[scheduler::tools] Built continuation prompt with {} tool results", tool_results.len());
    }
    
    Ok(final_response)
}

// Execute tools and return both the modified response and the collected tool results
async fn execute_tools_in_response_with_results(response: &str) -> (String, Vec<String>) {
    let mut result = response.to_string();
    let mut tool_results = Vec::new();
    
    println!("[scheduler::tools] Processing AI response ({} chars) for tool calls...", response.len());
    
    // Parse search_web calls - flexible patterns for different AI output formats
    let search_re = Regex::new(r#"<search_web\s+query\s*=\s*["']([^"']+)["']\s*/?>"#).unwrap();
    for cap in search_re.captures_iter(response) {
        let query = &cap[1];
        let full_match = cap.get(0).unwrap().as_str();
        
        println!("[scheduler::tools] Executing search_web: query=\"{}\"", query);
        match web::search_web(query.to_string(), Some(5)).await {
            Ok(results) => {
                println!("[scheduler::tools] search_web returned {} results", results.len());
                let formatted = results.iter()
                    .map(|r| format!("- **{}**\n  {}\n  URL: {}", r.title, r.snippet, r.url))
                    .collect::<Vec<_>>()
                    .join("\n\n");
                tool_results.push(format!("[Search results for \"{}\"]\n{}", query, formatted));
                result = result.replace(full_match, &format!("[Searched: \"{}\"]", query));
            }
            Err(e) => {
                println!("[scheduler::tools] search_web failed: {}", e);
                tool_results.push(format!("[Search failed for \"{}\"]: {}", query, e));
                result = result.replace(full_match, &format!("[Search failed: {}]", e));
            }
        }
    }
    
    // Parse fetch_url calls - flexible patterns
    let fetch_re = Regex::new(r#"<fetch_url\s+url\s*=\s*["']([^"']+)["']\s*/?>"#).unwrap();
    for cap in fetch_re.captures_iter(response) {
        let url = &cap[1];
        let full_match = cap.get(0).unwrap().as_str();
        
        println!("[scheduler::tools] Executing fetch_url: {}", url);
        
        // Try regular fetch first
        let fetch_result = web::fetch_url(url.to_string()).await;
        
        // If content is empty or very short, try rendered fetch (headless browser)
        // Each browser uses a unique profile so they can run in parallel
        let web_content = match &fetch_result {
            Ok(wc) if wc.content.len() < 100 => {
                println!("[scheduler::tools] Regular fetch returned {} chars, trying headless browser...", wc.content.len());
                match web::fetch_url_rendered(url.to_string()).await {
                    Ok(rendered) => Ok(rendered),
                    Err(e) => {
                        println!("[scheduler::tools] Headless fetch failed: {}", e);
                        fetch_result
                    }
                }
            }
            _ => fetch_result
        };
        
        match web_content {
            Ok(wc) => {
                let content = &wc.content;
                println!("[scheduler::tools] fetch_url got {} chars of content", content.len());
                let truncated = if content.len() > 4000 {
                    format!("{}... [truncated]", &content[..4000])
                } else {
                    content.clone()
                };
                tool_results.push(format!("[Fetched content from {}]\n{}", url, truncated));
                result = result.replace(full_match, &format!("[Fetched: {}]", url));
            }
            Err(e) => {
                println!("[scheduler::tools] fetch_url failed: {}", e);
                tool_results.push(format!("[Fetch failed for {}]: {}", url, e));
                result = result.replace(full_match, &format!("[Fetch failed: {}]", e));
            }
        }
    }
    
    // Parse get_stock_quote calls - flexible pattern
    let stock_re = Regex::new(r#"<get_stock_quote\s+symbol\s*=\s*["']([^"']+)["']\s*/?>"#).unwrap();
    for cap in stock_re.captures_iter(response) {
        let symbol = &cap[1];
        let full_match = cap.get(0).unwrap().as_str();

        println!("[scheduler::tools] Executing get_stock_quote: {}", symbol);
        match web::get_stock_quote(symbol.to_string()).await {
            Ok(quote) => {
                let formatted = format!(
                    "{} ({}): ${:.2} {} ({:.2}%)",
                    quote.symbol, quote.name, quote.price, 
                    if quote.change >= 0.0 { "▲" } else { "▼" },
                    quote.change_percent
                );
                tool_results.push(format!("[Stock quote for {}]\n{}", symbol, formatted));
                result = result.replace(full_match, &formatted);
            }
            Err(e) => {
                println!("[scheduler::tools] get_stock_quote failed: {}", e);
                tool_results.push(format!("[Stock quote failed for {}]: {}", symbol, e));
                result = result.replace(full_match, &format!("[Quote failed: {}]", e));
            }
        }
    }
    
    // Parse get_market_movers calls - flexible pattern
    let movers_re = Regex::new(r#"<get_market_movers\s*/?>"#).unwrap();
    for cap in movers_re.captures_iter(response) {
        let full_match = cap.get(0).unwrap().as_str();
        
        println!("[scheduler::tools] Executing get_market_movers");
        match web::get_market_movers().await {
            Ok(movers) => {
                // Collect all valid symbols for explicit listing
                let all_symbols: Vec<&str> = movers.gainers.iter()
                    .chain(movers.losers.iter())
                    .chain(movers.most_active.iter())
                    .map(|q| q.symbol.as_str())
                    .collect::<std::collections::HashSet<_>>()
                    .into_iter()
                    .collect();
                
                let formatted = format!(
                    "**VALID STOCK SYMBOLS (only these may appear in your report):** {}\n\n**Top Gainers ({} stocks):**\n{}\n\n**Top Losers ({} stocks):**\n{}\n\n**Most Active ({} stocks):**\n{}\n\n**REMINDER:** Only include stocks listed above. Do NOT add any other stocks.",
                    all_symbols.join(", "),
                    movers.gainers.len(),
                    if movers.gainers.is_empty() { "No data available".to_string() } else {
                        movers.gainers.iter().take(5)
                            .map(|q| format!("- {} ${:.2} ({:+.2}%)", q.symbol, q.price, q.change_percent))
                            .collect::<Vec<_>>().join("\n")
                    },
                    movers.losers.len(),
                    if movers.losers.is_empty() { "No data available".to_string() } else {
                        movers.losers.iter().take(5)
                            .map(|q| format!("- {} ${:.2} ({:+.2}%)", q.symbol, q.price, q.change_percent))
                            .collect::<Vec<_>>().join("\n")
                    },
                    movers.most_active.len(),
                    if movers.most_active.is_empty() { "No data available".to_string() } else {
                        movers.most_active.iter().take(5)
                            .map(|q| format!("- {} ${:.2} ({:+.2}%)", q.symbol, q.price, q.change_percent))
                            .collect::<Vec<_>>().join("\n")
                    }
                );
                tool_results.push(format!("[Market movers]\n{}", formatted));
                result = result.replace(full_match, &formatted);
            }
            Err(e) => {
                println!("[scheduler::tools] get_market_movers failed: {}", e);
                tool_results.push(format!("[Market movers failed - do not invent data]: {}", e));
                result = result.replace(full_match, &format!("[Market movers failed: {}]", e));
            }
        }
    }
    
    println!("[scheduler::tools] Collected {} tool results", tool_results.len());
    (result, tool_results)
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
    
    // Slack has a ~4000 character limit for text
    const SLACK_MAX_LENGTH: usize = 3900; // Leave buffer
    
    let messages: Vec<String> = if message.len() <= SLACK_MAX_LENGTH {
        vec![message.to_string()]
    } else {
        // Split long content into chunks
        let mut chunks = Vec::new();
        let mut remaining = message;
        
        while !remaining.is_empty() {
            if remaining.len() <= SLACK_MAX_LENGTH {
                chunks.push(remaining.to_string());
                break;
            }
            
            let chunk_end = remaining[..SLACK_MAX_LENGTH]
                .rfind('\n')
                .unwrap_or(SLACK_MAX_LENGTH);
            
            let (chunk, rest) = remaining.split_at(chunk_end);
            chunks.push(chunk.to_string());
            remaining = rest.trim_start_matches('\n');
        }
        
        let total = chunks.len();
        chunks.iter().enumerate().map(|(i, chunk)| {
            if total > 1 {
                format!("*[Part {}/{}]*\n{}", i + 1, total, chunk)
            } else {
                chunk.clone()
            }
        }).collect()
    };
    
    let mut sent_count = 0;
    for (i, msg_content) in messages.iter().enumerate() {
        let payload = if let Some(user) = username {
            serde_json::json!({
                "channel": channel,
                "username": user,
                "text": msg_content
            })
        } else {
            serde_json::json!({
                "channel": channel,
                "text": msg_content
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
        
        sent_count += 1;
        
        // Add delay between messages to avoid rate limiting
        if i < messages.len() - 1 {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
    }

    Ok(format!("Slack message sent to channel: {} ({} part{})", channel, sent_count, if sent_count > 1 { "s" } else { "" }))
}

// Format a table row for Discord
fn format_table_row_for_discord(cells: &[&str]) -> String {
    if cells.len() < 2 {
        return cells.join(" ");
    }
    
    // Try to identify column types and format accordingly
    // Common patterns: Ticker, Name/Company, Price, Change, % Change, Trend/Note
    let mut formatted_parts: Vec<String> = Vec::new();
    
    for (i, cell) in cells.iter().enumerate() {
        let cell = cell.trim();
        if cell.is_empty() {
            continue;
        }
        
        // First cell (usually ticker) - make it bold
        if i == 0 {
            formatted_parts.push(format!("**{}**", cell));
        }
        // Price cells (contain $)
        else if cell.contains('$') {
            formatted_parts.push(cell.to_string());
        }
        // Percentage cells
        else if cell.contains('%') {
            formatted_parts.push(format!("({})", cell));
        }
        // Trend indicators (arrows, up/down)
        else if cell == "▲" || cell == "▼" || cell.to_lowercase() == "up" || cell.to_lowercase() == "down" {
            formatted_parts.push(cell.to_string());
        }
        // Other cells (name, notes, etc.)
        else {
            formatted_parts.push(cell.to_string());
        }
    }
    
    formatted_parts.join(" ")
}

// Convert markdown to Discord-friendly format (tables, headers, etc.)
fn convert_markdown_for_discord(content: &str) -> String {
    let mut result = String::new();
    let mut in_pipe_table = false;
    let mut in_tab_table = false;
    let mut is_header_row = true;
    let mut consecutive_tab_lines = 0;
    
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;
    
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        
        // Convert markdown headers (# ## ### ####) to bold text
        if trimmed.starts_with('#') {
            let header_text = trimmed.trim_start_matches('#').trim();
            if !header_text.is_empty() {
                result.push_str(&format!("**{}**\n", header_text));
                i += 1;
                continue;
            }
        }
        
        // Check if this is a pipe-delimited table row (starts and ends with |)
        if trimmed.starts_with('|') && trimmed.ends_with('|') {
            // Check if it's a separator row (contains only |, -, :, and spaces)
            let is_separator = trimmed.chars().all(|c| c == '|' || c == '-' || c == ':' || c == ' ');
            
            if is_separator {
                in_pipe_table = true;
                is_header_row = false;
                i += 1;
                continue;
            }
            
            // Parse table cells
            let cells: Vec<&str> = trimmed
                .trim_matches('|')
                .split('|')
                .map(|s| s.trim())
                .collect();
            
            if !in_pipe_table || is_header_row {
                // This is the header row - skip it
                in_pipe_table = true;
                i += 1;
                continue;
            }
            
            // Format data row
            result.push_str(&format_table_row_for_discord(&cells));
            result.push('\n');
            i += 1;
            continue;
        }
        
        // Check if this is a tab-separated table row
        let tab_count = trimmed.matches('\t').count();
        if tab_count >= 2 {
            let cells: Vec<&str> = trimmed.split('\t').map(|s| s.trim()).collect();
            
            // First row with tabs is likely the header
            if !in_tab_table {
                in_tab_table = true;
                is_header_row = true;
                consecutive_tab_lines = 1;
                i += 1;
                continue;
            }
            
            consecutive_tab_lines += 1;
            
            // Format data row
            result.push_str(&format_table_row_for_discord(&cells));
            result.push('\n');
            i += 1;
            continue;
        }
        
        // Not a table row - reset table state
        if in_pipe_table || in_tab_table {
            in_pipe_table = false;
            in_tab_table = false;
            is_header_row = true;
            consecutive_tab_lines = 0;
        }
        
        result.push_str(line);
        result.push('\n');
        i += 1;
    }
    
    result
}

async fn execute_send_discord(
    webhook_url: &str,
    content: &str,
    username: Option<&str>,
    avatar_url: Option<&str>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    
    // Convert markdown to Discord-friendly format (headers, tables, etc.)
    let content = convert_markdown_for_discord(content);
    
    // Discord has a 2000 character limit for message content
    // For long messages, we'll split into multiple messages
    const DISCORD_MAX_LENGTH: usize = 1950; // Leave some buffer
    
    let messages: Vec<String> = if content.len() <= DISCORD_MAX_LENGTH {
        vec![content.clone()]
    } else {
        // Split long content into chunks, trying to break at newlines
        let mut chunks = Vec::new();
        let mut remaining = content.as_str();
        
        while !remaining.is_empty() {
            if remaining.len() <= DISCORD_MAX_LENGTH {
                chunks.push(remaining.to_string());
                break;
            }
            
            // Find a good break point (newline) near the limit
            let chunk_end = remaining[..DISCORD_MAX_LENGTH]
                .rfind('\n')
                .unwrap_or(DISCORD_MAX_LENGTH);
            
            let (chunk, rest) = remaining.split_at(chunk_end);
            chunks.push(chunk.to_string());
            remaining = rest.trim_start_matches('\n');
        }
        
        // Add part indicators
        let total = chunks.len();
        chunks.iter().enumerate().map(|(i, chunk)| {
            if total > 1 {
                format!("**[Part {}/{}]**\n{}", i + 1, total, chunk)
            } else {
                chunk.clone()
            }
        }).collect()
    };
    
    let mut sent_count = 0;
    for (i, msg_content) in messages.iter().enumerate() {
        let mut payload = serde_json::json!({
            "content": msg_content
        });

        // Only include username if it's not empty (Discord rejects empty usernames)
        if let Some(user) = username {
            let user = user.trim();
            if !user.is_empty() && user.len() <= 80 {
                payload["username"] = serde_json::json!(user);
            }
        }
        // Only include avatar_url if it's not empty
        if let Some(avatar) = avatar_url {
            let avatar = avatar.trim();
            if !avatar.is_empty() {
                payload["avatar_url"] = serde_json::json!(avatar);
            }
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
        
        sent_count += 1;
        
        // Add delay between messages to avoid rate limiting
        if i < messages.len() - 1 {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
    }

    Ok(format!("Discord message sent via webhook ({} part{})", sent_count, if sent_count > 1 { "s" } else { "" }))
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

// ============= Background Cron Scheduler =============

pub async fn start_cron_scheduler(app: AppHandle) {
    println!("[cron] Starting background cron scheduler...");
    
    // Track last run times to avoid duplicate executions within the same minute
    let mut last_runs: HashMap<String, chrono::DateTime<chrono::Local>> = HashMap::new();
    
    loop {
        // Check every 30 seconds
        tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
        
        let now = chrono::Local::now();
        println!("[cron] Checking scheduled agents at {}", now.format("%Y-%m-%d %H:%M:%S"));
        
        // Get all enabled agents with cron triggers
        let agents = match get_cron_agents(&app).await {
            Ok(agents) => agents,
            Err(e) => {
                println!("[cron] Error fetching agents: {}", e);
                continue;
            }
        };
        
        if agents.is_empty() {
            // Only log this occasionally to avoid spam
            if now.second() < 30 {
                println!("[cron] No enabled cron agents found");
            }
        } else {
            println!("[cron] Found {} cron agent(s)", agents.len());
        }
        
        for (agent_id, agent_name, cron_expression) in agents {
            // Check if current LOCAL time matches the cron expression
            // We do this manually because the cron crate interprets hours as UTC
            let matches = match cron_matches_local(&cron_expression, &now) {
                Ok(m) => m,
                Err(e) => {
                    println!("[cron] Invalid cron expression '{}' for agent '{}': {}", 
                        cron_expression, agent_name, e);
                    continue;
                }
            };
            
            // Calculate next scheduled time for logging (approximate)
            let next_scheduled = get_next_cron_time_local(&cron_expression, &now);
            let diff = if let Some(next) = &next_scheduled {
                (now - *next).num_seconds()
            } else {
                0
            };
            
            println!("[cron] Agent '{}' (cron: {}) - next scheduled: {}, diff: {}s, matches: {}", 
                agent_name, cron_expression, 
                next_scheduled.map(|n| n.format("%H:%M:%S").to_string()).unwrap_or_else(|| "unknown".to_string()),
                diff, matches);
            
            // Only trigger if current time matches the cron expression
            // Check within a small window (first 45 seconds of the minute)
            if matches && now.second() < 45 {
                // Use the current minute for deduplication
                // This prevents duplicate runs within the same minute
                let current_minute = now.format("%Y-%m-%d %H:%M").to_string();
                let last_run_key = format!("{}_{}", agent_id, current_minute);
                
                if last_runs.contains_key(&last_run_key) {
                    continue; // Already ran for this scheduled time
                }
                
                println!("[cron] Triggering agent '{}' (id: {}) - cron: {} (scheduled: {})", 
                    agent_name, agent_id, cron_expression, current_minute);
                
                // Mark as run for this scheduled time
                last_runs.insert(last_run_key, now);
                
                // Clean up old entries (keep only last 100)
                if last_runs.len() > 100 {
                    let oldest: Vec<String> = last_runs.keys()
                        .take(last_runs.len() - 100)
                        .cloned()
                        .collect();
                    for key in oldest {
                        last_runs.remove(&key);
                    }
                }
                
                // Execute the agent in a separate task
                let app_clone = app.clone();
                let agent_id_clone = agent_id.clone();
                let agent_name_clone = agent_name.clone();
                tokio::spawn(async move {
                    match execute_agent(app_clone, agent_id_clone.clone()).await {
                        Ok(execution) => {
                            println!("[cron] Agent '{}' execution completed with status: {}", 
                                agent_name_clone, execution.status);
                        }
                        Err(e) => {
                            println!("[cron] Agent '{}' execution failed: {}", agent_name_clone, e);
                        }
                    }
                });
            }
        }
    }
}

// Parse a cron field (e.g., "6-14", "0", "*", "1,2,3", "*/5")
fn parse_cron_field(field: &str, min: u32, max: u32) -> Result<Vec<u32>, String> {
    let mut values = Vec::new();
    
    for part in field.split(',') {
        let part = part.trim();
        
        if part == "*" {
            // All values
            values.extend(min..=max);
        } else if part.starts_with("*/") {
            // Step values (e.g., */5)
            let step: u32 = part[2..].parse().map_err(|_| format!("Invalid step: {}", part))?;
            if step == 0 {
                return Err("Step cannot be 0".to_string());
            }
            values.extend((min..=max).step_by(step as usize));
        } else if part.contains('-') {
            // Range (e.g., 6-14)
            let range_parts: Vec<&str> = part.split('-').collect();
            if range_parts.len() != 2 {
                return Err(format!("Invalid range: {}", part));
            }
            let start: u32 = range_parts[0].parse().map_err(|_| format!("Invalid range start: {}", part))?;
            let end: u32 = range_parts[1].parse().map_err(|_| format!("Invalid range end: {}", part))?;
            if start > end || start < min || end > max {
                return Err(format!("Range out of bounds: {}", part));
            }
            values.extend(start..=end);
        } else {
            // Single value
            let val: u32 = part.parse().map_err(|_| format!("Invalid value: {}", part))?;
            if val < min || val > max {
                return Err(format!("Value out of bounds: {}", part));
            }
            values.push(val);
        }
    }
    
    Ok(values)
}

// Check if a local DateTime matches a cron expression
// Cron format: "minute hour day month weekday"
fn cron_matches_local(cron_expr: &str, local_time: &chrono::DateTime<chrono::Local>) -> Result<bool, String> {
    let parts: Vec<&str> = cron_expr.split_whitespace().collect();
    if parts.len() != 5 {
        return Err(format!("Invalid cron expression (expected 5 fields): {}", cron_expr));
    }
    
    let minute = local_time.minute();
    let hour = local_time.hour();
    let day = local_time.day();
    let month = local_time.month();
    let weekday = local_time.weekday().num_days_from_sunday(); // 0 = Sunday, 6 = Saturday
    
    // Parse each field and check if current time matches
    let minutes = parse_cron_field(parts[0], 0, 59)?;
    let hours = parse_cron_field(parts[1], 0, 23)?;
    let days = parse_cron_field(parts[2], 1, 31)?;
    let months = parse_cron_field(parts[3], 1, 12)?;
    let weekdays = parse_cron_field(parts[4], 0, 7)?; // 0 and 7 both mean Sunday
    
    // Check if all fields match
    let minute_match = minutes.contains(&minute);
    let hour_match = hours.contains(&hour);
    let day_match = days.contains(&day);
    let month_match = months.contains(&month);
    // For weekday, both 0 and 7 mean Sunday
    let weekday_match = weekdays.contains(&weekday) || (weekday == 0 && weekdays.contains(&7));
    
    Ok(minute_match && hour_match && day_match && month_match && weekday_match)
}

// Get the next scheduled time for a cron expression in local time (approximate)
fn get_next_cron_time_local(cron_expr: &str, from: &chrono::DateTime<chrono::Local>) -> Option<chrono::DateTime<chrono::Local>> {
    let parts: Vec<&str> = cron_expr.split_whitespace().collect();
    if parts.len() != 5 {
        return None;
    }
    
    let minutes = parse_cron_field(parts[0], 0, 59).ok()?;
    let hours = parse_cron_field(parts[1], 0, 23).ok()?;
    
    // Find the next matching minute/hour combination
    let current_hour = from.hour();
    let current_minute = from.minute();
    
    // First, check if there's a match later today
    for &hour in &hours {
        for &minute in &minutes {
            if hour > current_hour || (hour == current_hour && minute > current_minute) {
                // Found a future time today
                return from
                    .with_hour(hour)
                    .and_then(|t| t.with_minute(minute))
                    .and_then(|t| t.with_second(0));
            }
        }
    }
    
    // Otherwise, it's the first matching time tomorrow
    if let (Some(&first_hour), Some(&first_minute)) = (hours.first(), minutes.first()) {
        let tomorrow = *from + chrono::Duration::days(1);
        return tomorrow
            .with_hour(first_hour)
            .and_then(|t| t.with_minute(first_minute))
            .and_then(|t| t.with_second(0));
    }
    
    None
}

async fn get_cron_agents(app: &AppHandle) -> Result<Vec<(String, String, String)>, String> {
    let conn = get_connection(app).await?;
    
    let mut stmt = conn
        .prepare("SELECT id, name, trigger_json FROM agents WHERE enabled = 1")
        .map_err(|e| e.to_string())?;
    
    let all_agents: Vec<(String, String, String)> = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let trigger_json: String = row.get(2)?;
            Ok((id, name, trigger_json))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    
    println!("[cron] Found {} enabled agents total", all_agents.len());
    
    let agents: Vec<(String, String, String)> = all_agents
        .into_iter()
        .filter_map(|(id, name, trigger_json)| {
            // Parse trigger and check if it's a cron trigger
            match serde_json::from_str::<TriggerType>(&trigger_json) {
                Ok(trigger) => {
                    match trigger {
                        TriggerType::Cron { expression } => {
                            println!("[cron] Agent '{}' has cron trigger: {}", name, expression);
                            Some((id, name, expression))
                        }
                        _ => {
                            println!("[cron] Agent '{}' has non-cron trigger: {:?}", name, trigger);
                            None
                        }
                    }
                }
                Err(e) => {
                    println!("[cron] Agent '{}' trigger parse error: {} (json: {})", name, e, trigger_json);
                    None
                }
            }
        })
        .collect();
    
    Ok(agents)
}

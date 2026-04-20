use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};

// Global state for managing active streams
lazy_static::lazy_static! {
    static ref ACTIVE_STREAMS: Arc<RwLock<HashMap<String, tokio::sync::broadcast::Sender<()>>>> = 
        Arc::new(RwLock::new(HashMap::new()));
}

const COPILOT_CLIENT_ID: &str = "Iv1.5a5b3b1dfb42b3b0";
const COPILOT_DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const COPILOT_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const COPILOT_SCOPE: &str = "read:user read:org";
const COPILOT_EXCHANGE_URL: &str = "https://api.github.com/copilot_internal/v2/token";
const COPILOT_CHAT_URL: &str = "https://api.githubcopilot.com/chat/completions";
const COPILOT_MODELS_URL: &str = "https://api.githubcopilot.com/models";
const COPILOT_USER_AGENT: &str = "GithubCopilot/1.312.0";
const COPILOT_EDITOR_VERSION: &str = "vscode/1.99.3";
const COPILOT_PLUGIN_VERSION: &str = "copilot-chat/0.26.3";
const COPILOT_INTEGRATION_ID: &str = "vscode-chat";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MessageAttachment {
    pub id: String,
    #[serde(rename = "type")]
    pub attachment_type: String,
    pub name: String,
    pub data: Option<String>, // base64 for images
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<MessageAttachment>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CopilotDeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub expires_in: i64,
    pub interval: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CopilotLoginStatus {
    pub logged_in: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CopilotBillingInfo {
    pub total: i64,
    pub added_this_cycle: i64,
    pub pending_cancellation: i64,
    pub pending_invitation: i64,
    pub active_this_cycle: i64,
    pub inactive_this_cycle: i64,
    pub seat_management_setting: Option<String>,
    pub plan_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CopilotBillingResponse {
    seat_breakdown: CopilotBillingInfo,
}

#[derive(Debug, Serialize, Deserialize)]
struct CopilotOrg {
    login: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct CopilotOrgMembership {
    role: String,
    organization: CopilotOrg,
}

#[derive(Debug, Serialize, Deserialize)]
struct CopilotStoredToken {
    access_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct CopilotAccessTokenResponse {
    access_token: Option<String>,
    token_type: Option<String>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CopilotApiTokenResponse {
    token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CopilotModel {
    id: Option<String>,
}

fn get_copilot_token_path() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("OpenCodeBrew");
    std::fs::create_dir_all(&path).ok();
    path.push("copilot-token.json");
    path
}

fn save_copilot_token(token: &str) -> Result<(), String> {
    let path = get_copilot_token_path();
    let data = CopilotStoredToken {
        access_token: token.to_string(),
    };
    let json = serde_json::to_string(&data).map_err(|e| format!("Failed to encode token: {}", e))?;
    std::fs::write(path, json).map_err(|e| format!("Failed to store token: {}", e))?;
    Ok(())
}

fn load_copilot_token() -> Result<String, String> {
    let path = get_copilot_token_path();
    let content = std::fs::read_to_string(path).map_err(|e| format!("Copilot token not found: {}", e))?;
    let data: CopilotStoredToken = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse token: {}", e))?;
    if data.access_token.trim().is_empty() {
        return Err("Copilot token is empty".to_string());
    }
    Ok(data.access_token)
}

fn delete_copilot_token() -> Result<(), String> {
    let path = get_copilot_token_path();
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("Failed to delete token: {}", e))?;
    }
    Ok(())
}

fn resolve_copilot_client_id(client_id: Option<String>) -> String {
    let provided = client_id.unwrap_or_default();
    let trimmed = provided.trim();
    if trimmed.is_empty() {
        COPILOT_CLIENT_ID.to_string()
    } else {
        trimmed.to_string()
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OllamaModel {
    pub name: String,
    pub size: Option<u64>,
    pub modified_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModel>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaChatMessage {
    role: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    images: Option<Vec<String>>, // base64 encoded images
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaChatRequest {
    model: String,
    messages: Vec<OllamaChatMessage>,
    stream: bool,
    options: Option<OllamaOptions>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaOptions {
    temperature: Option<f32>,
    num_predict: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaChatResponse {
    message: Option<OllamaMessage>,
    done: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaMessage {
    role: String,
    content: String,
    #[serde(default)]
    thinking: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum MessageContent {
    Text(String),
    ContentBlocks(Vec<ContentBlock>),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ContentBlock {
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: ImageUrl },
}

#[derive(Debug, Serialize, Deserialize)]
struct ImageUrl {
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIMessage {
    role: String,
    content: MessageContent,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    temperature: Option<f32>,
    max_tokens: Option<i32>,
    stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    pub content: String,
    pub done: bool,
}

#[command]
pub async fn check_ollama_status(base_url: Option<String>) -> Result<bool, String> {
    let url = base_url.unwrap_or_else(|| "http://localhost:11434".to_string());
    let client = Client::new();
    
    match client.get(format!("{}/api/tags", url)).send().await {
        Ok(response) => Ok(response.status().is_success()),
        Err(_) => Ok(false),
    }
}

#[command]
pub async fn list_ollama_models(base_url: Option<String>) -> Result<Vec<OllamaModel>, String> {
    let url = base_url.unwrap_or_else(|| "http://localhost:11434".to_string());
    let client = Client::new();
    
    let response = client
        .get(format!("{}/api/tags", url))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;
    
    let tags: OllamaTagsResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    Ok(tags.models)
}

#[command]
pub async fn copilot_device_login_start(client_id: Option<String>) -> Result<CopilotDeviceCode, String> {
    let client = Client::new();
    let client_id = resolve_copilot_client_id(client_id);

    let response = client
        .post(COPILOT_DEVICE_CODE_URL)
        .header("User-Agent", COPILOT_USER_AGENT)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id.as_str()),
            ("scope", COPILOT_SCOPE),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to request device code: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Device code request failed: {}", error_text));
    }

    response
        .json::<CopilotDeviceCode>()
        .await
        .map_err(|e| format!("Failed to parse device code response: {}", e))
}

#[command]
pub async fn copilot_device_login_poll(
    device_code: String,
    interval: Option<i64>,
    expires_in: Option<i64>,
    client_id: Option<String>,
) -> Result<bool, String> {
    let client = Client::new();
    let client_id = resolve_copilot_client_id(client_id);
    let mut poll_interval = interval.unwrap_or(5).max(1) as u64;
    let max_wait = Duration::from_secs(expires_in.unwrap_or(900).max(60) as u64);
    let start = Instant::now();

    loop {
        if start.elapsed() > max_wait {
            return Err("Device code expired. Please try again.".to_string());
        }

        let response = client
            .post(COPILOT_TOKEN_URL)
            .header("User-Agent", COPILOT_USER_AGENT)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", client_id.as_str()),
                ("device_code", device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|e| format!("Failed to poll device token: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Device login failed: {}", error_text));
        }

        let data: CopilotAccessTokenResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse device token response: {}", e))?;

        if let Some(token) = data.access_token {
            save_copilot_token(&token)?;
            return Ok(true);
        }

        if let Some(error) = data.error {
            match error.as_str() {
                "authorization_pending" => {
                    sleep(Duration::from_secs(poll_interval)).await;
                }
                "slow_down" => {
                    poll_interval = (poll_interval + 5).min(60);
                    sleep(Duration::from_secs(poll_interval)).await;
                }
                "expired_token" => {
                    return Err("Device code expired. Please try again.".to_string());
                }
                "access_denied" => {
                    return Err("Copilot authorization was denied.".to_string());
                }
                _ => {
                    let description = data.error_description.unwrap_or_else(|| error.clone());
                    return Err(format!("Device login error: {}", description));
                }
            }
        } else {
            return Err("Unexpected device login response.".to_string());
        }
    }
}

#[command]
pub async fn copilot_device_login_status() -> Result<CopilotLoginStatus, String> {
    let logged_in = load_copilot_token().map(|t| !t.is_empty()).unwrap_or(false);
    Ok(CopilotLoginStatus { logged_in })
}

#[command]
pub async fn copilot_device_logout() -> Result<(), String> {
    delete_copilot_token()
}

async fn fetch_copilot_api_token(client: &Client, github_token: &str) -> Result<String, String> {
    let response = client
        .get(COPILOT_EXCHANGE_URL)
        .header("Authorization", format!("token {}", github_token))
        .header("Accept", "application/json")
        .header("User-Agent", COPILOT_USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Failed to exchange Copilot token: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Copilot token exchange failed: {}", error_text));
    }

    let data: CopilotApiTokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Copilot token response: {}", e))?;

    data.token
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "Copilot token response missing token".to_string())
}

fn extract_models_from_data(data: &serde_json::Value) -> Vec<(String, bool)> {
    // Returns vec of (model_id, supports_vision)
    let mut models: Vec<(String, bool)> = Vec::new();

    let items_opt = data.get("data").and_then(|v| v.as_array())
        .or_else(|| data.get("models").and_then(|v| v.as_array()));

    if let Some(items) = items_opt {
        for item in items {
            let id = item.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());
            if let Some(id) = id {
                let capabilities = item.get("capabilities");

                // Vision capability is stored under capabilities.limits.vision (not supports.vision)
                let supports_vision = capabilities
                    .and_then(|c| c.get("limits"))
                    .and_then(|l| l.get("vision"))
                    .map(|v| !v.is_null())
                    .unwrap_or(false);
                
                println!("[ai.rs] Model: {} vision={}", id, supports_vision);
                models.push((id, supports_vision));
            }
        }
    }

    models
}

#[command]
pub async fn list_copilot_models() -> Result<Vec<String>, String> {
    let github_token = load_copilot_token()?;
    let client = Client::new();
    let copilot_token = fetch_copilot_api_token(&client, &github_token).await?;

    let response = client
        .get(COPILOT_MODELS_URL)
        .header("Authorization", format!("Bearer {}", copilot_token))
        .header("Accept", "application/json")
        .header("User-Agent", COPILOT_USER_AGENT)
        .header("Editor-Version", COPILOT_EDITOR_VERSION)
        .header("Editor-Plugin-Version", COPILOT_PLUGIN_VERSION)
        .header("Copilot-Integration-Id", COPILOT_INTEGRATION_ID)
        .header("OpenAI-Intent", "model-list")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Copilot models: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Copilot models request failed: {}", error_text));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Copilot models: {}", e))?;

    let model_entries = extract_models_from_data(&data);
    let mut models: Vec<String> = model_entries.into_iter().map(|(id, _)| id).collect();

    let mut seen = HashSet::new();
    models.retain(|model| seen.insert(model.clone()));
    models.sort();

    Ok(models)
}

#[command]
pub async fn list_copilot_vision_models() -> Result<Vec<String>, String> {
    let github_token = load_copilot_token()?;
    let client = Client::new();
    let copilot_token = fetch_copilot_api_token(&client, &github_token).await?;

    let response = client
        .get(COPILOT_MODELS_URL)
        .header("Authorization", format!("Bearer {}", copilot_token))
        .header("Accept", "application/json")
        .header("User-Agent", COPILOT_USER_AGENT)
        .header("Editor-Version", COPILOT_EDITOR_VERSION)
        .header("Editor-Plugin-Version", COPILOT_PLUGIN_VERSION)
        .header("Copilot-Integration-Id", COPILOT_INTEGRATION_ID)
        .header("OpenAI-Intent", "model-list")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Copilot models: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Copilot models request failed: {}", error_text));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Copilot models: {}", e))?;

    let model_entries = extract_models_from_data(&data);
    let mut vision_models: Vec<String> = model_entries
        .into_iter()
        .filter(|(_, supports_vision)| *supports_vision)
        .map(|(id, _)| id)
        .collect();

    let mut seen = HashSet::new();
    vision_models.retain(|m| seen.insert(m.clone()));
    vision_models.sort();

    println!("[ai.rs] Vision-capable models: {:?}", vision_models);
    Ok(vision_models)
}

#[command]
pub async fn copilot_list_orgs() -> Result<Vec<String>, String> {
    let github_token = load_copilot_token()?;
    let client = Client::new();
    let response = client
        .get("https://api.github.com/user/memberships/orgs?per_page=100")
        .header("Authorization", format!("Bearer {}", github_token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", COPILOT_USER_AGENT)
        .header("X-GitHub-Api-Version", "2026-03-10")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch organizations: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Organization request failed: {}", error_text));
    }

    let data: Vec<CopilotOrgMembership> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse organizations: {}", e))?;

    let mut orgs: Vec<String> = data
        .into_iter()
        .filter(|membership| membership.role == "admin")
        .map(|membership| membership.organization.login)
        .collect();
    orgs.sort();
    orgs.dedup();
    Ok(orgs)
}

#[command]
pub async fn copilot_billing_info(org: String) -> Result<CopilotBillingInfo, String> {
    let org = org.trim();
    if org.is_empty() {
        return Err("Organization name is required.".to_string());
    }
    let github_token = load_copilot_token()?;
    let client = Client::new();
    let response = client
        .get(format!("https://api.github.com/orgs/{}/copilot/billing", org))
        .header("Authorization", format!("Bearer {}", github_token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", COPILOT_USER_AGENT)
        .header("X-GitHub-Api-Version", "2026-03-10")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Copilot billing: {}", e))?;

    if !response.status().is_success() {
        if response.status().as_u16() == 404 {
            return Err("Copilot billing not available for this organization. Ensure the org has Copilot Business/Enterprise and your account is an owner.".to_string());
        }
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Copilot billing request failed: {}", error_text));
    }

    let data: CopilotBillingResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Copilot billing response: {}", e))?;

    Ok(data.seat_breakdown)
}

#[command(rename_all = "camelCase")]
pub async fn chat_ollama(
    app: AppHandle,
    base_url: Option<String>,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: Option<f32>,
    max_tokens: Option<i32>,
    conversation_id: String,
) -> Result<String, String> {
    use std::time::Duration;
    
    println!("[ai.rs] chat_ollama called with conversation_id: {}", conversation_id);
    let raw_url = base_url.unwrap_or_else(|| "http://localhost:11434".to_string());
    // Replace localhost with 127.0.0.1 to avoid DNS resolution issues
    let url = raw_url.replace("localhost", "127.0.0.1");
    println!("[ai.rs] Using Ollama URL: {}", url);
    
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    // Create cancellation channel for this conversation
    let (cancel_tx, mut cancel_rx) = tokio::sync::broadcast::channel(1);
    
    // Store the cancellation sender
    {
        let mut streams = ACTIVE_STREAMS.write().await;
        streams.insert(conversation_id.clone(), cancel_tx);
    }
    
    // Convert messages to Ollama format, extracting images from attachments
    let ollama_messages: Vec<OllamaChatMessage> = messages
        .into_iter()
        .map(|msg| {
            let images = msg.attachments.as_ref().and_then(|attachments| {
                let image_data: Vec<String> = attachments
                    .iter()
                    .filter(|att| att.attachment_type == "image" && att.data.is_some())
                    .map(|att| {
                        let data = att.data.clone().unwrap_or_default();
                        if let Some((_, base64)) = data.split_once("base64,") {
                            base64.to_string()
                        } else {
                            data
                        }
                    })
                    .collect();
                
                if image_data.is_empty() {
                    None
                } else {
                    Some(image_data)
                }
            });
            
            OllamaChatMessage {
                role: msg.role,
                content: msg.content,
                images,
            }
        })
        .collect();
    
    let request = OllamaChatRequest {
        model,
        messages: ollama_messages,
        stream: true,
        options: Some(OllamaOptions {
            temperature,
            num_predict: max_tokens,
        }),
    };
    
    println!("[ai.rs] Sending request to Ollama: model={}, messages={}", request.model, request.messages.len());
    println!("[ai.rs] Request URL: {}/api/chat", url);
    
    // Debug: serialize the request to see what we're sending
    if let Ok(json) = serde_json::to_string(&request) {
        println!("[ai.rs] Request body length: {} bytes", json.len());
    }
    
    let response = client
        .post(format!("{}/api/chat", url))
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            println!("[ai.rs] Request failed with error: {:?}", e);
            format!("Failed to send request: {}", e)
        })?;
    
    println!("[ai.rs] Got response status: {}", response.status());
    
    if !response.status().is_success() {
        return Err(format!("Ollama error: {}", response.status()));
    }
    
    let mut stream = response.bytes_stream();
    let mut full_content = String::new();
    println!("[ai.rs] Starting to process stream...");
    
    loop {
        tokio::select! {
            // Check for cancellation
            _ = cancel_rx.recv() => {
                println!("Stream cancelled for conversation: {}", conversation_id);
                // Clean up
                let mut streams = ACTIVE_STREAMS.write().await;
                streams.remove(&conversation_id);
                return Err("Stream cancelled by user".to_string());
            }
            // Process stream chunks
            chunk_result = stream.next() => {
                match chunk_result {
                    Some(Ok(chunk)) => {
                        let text = String::from_utf8_lossy(&chunk);
                        
                        for line in text.lines() {
                            if line.is_empty() {
                                continue;
                            }
                            
                            if let Ok(response) = serde_json::from_str::<OllamaChatResponse>(line) {
                                if let Some(message) = response.message {
                                    // Handle both content and thinking (for models like gemma4)
                                    let event_name = format!("ai-stream-{}", conversation_id);
                                    
                                    // If there's thinking content, emit it with a thinking indicator
                                    if let Some(thinking) = &message.thinking {
                                        if !thinking.is_empty() {
                                            if full_content.is_empty() {
                                                println!("[ai.rs] Emitting thinking to '{}'", event_name);
                                            }
                                            // Emit thinking content (frontend can style it differently)
                                            let _ = app.emit(&event_name, StreamChunk {
                                                content: thinking.clone(),
                                                done: false,
                                            });
                                        }
                                    }
                                    
                                    // Emit regular content
                                    if !message.content.is_empty() {
                                        full_content.push_str(&message.content);
                                        if full_content.len() < 50 {
                                            println!("[ai.rs] Emitting content to '{}': len={}", event_name, message.content.len());
                                        }
                                        let _ = app.emit(&event_name, StreamChunk {
                                            content: message.content,
                                            done: response.done,
                                        });
                                    } else if response.done {
                                        // Emit done signal even if content is empty
                                        let _ = app.emit(&event_name, StreamChunk {
                                            content: String::new(),
                                            done: true,
                                        });
                                    }
                                }
                                
                                if response.done {
                                    // Clean up on completion
                                    let mut streams = ACTIVE_STREAMS.write().await;
                                    streams.remove(&conversation_id);
                                    return Ok(full_content);
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        return Err(format!("Stream error: {}", e));
                    }
                    None => {
                        // Stream ended
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        break;
                    }
                }
            }
        }
    }
    
    Ok(full_content)
}

#[command(rename_all = "camelCase")]
pub async fn chat_openai(
    app: AppHandle,
    base_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: Option<f32>,
    max_tokens: Option<i32>,
    conversation_id: String,
) -> Result<String, String> {
    let client = Client::new();
    
    // Create cancellation channel for this conversation
    let (cancel_tx, mut cancel_rx) = tokio::sync::broadcast::channel(1);
    
    // Store the cancellation sender
    {
        let mut streams = ACTIVE_STREAMS.write().await;
        streams.insert(conversation_id.clone(), cancel_tx);
    }
    
    // Convert messages to OpenAI format, using content blocks when images are present
    let openai_messages: Vec<OpenAIMessage> = messages
        .into_iter()
        .map(|msg| {
            let content = if let Some(attachments) = &msg.attachments {
                let has_images = attachments.iter().any(|att| att.attachment_type == "image");
                
                if has_images {
                    // Use content blocks format
                    let mut blocks: Vec<ContentBlock> = vec![ContentBlock::Text {
                        text: msg.content.clone(),
                    }];
                    
                    for att in attachments {
                        if att.attachment_type == "image" {
                            if let Some(data) = &att.data {
                                let mime_type = att.mime_type.as_deref().unwrap_or("image/png");
                                let data_url = if data.starts_with("data:") {
                                    data.clone()
                                } else {
                                    format!("data:{};base64,{}", mime_type, data)
                                };
                                blocks.push(ContentBlock::ImageUrl {
                                    image_url: ImageUrl { 
                                        url: data_url,
                                        detail: None,
                                    },
                                });
                            }
                        }
                    }
                    
                    MessageContent::ContentBlocks(blocks)
                } else {
                    MessageContent::Text(msg.content)
                }
            } else {
                MessageContent::Text(msg.content)
            };
            
            OpenAIMessage {
                role: msg.role,
                content,
            }
        })
        .collect();
    
    let request = OpenAIRequest {
        model,
        messages: openai_messages,
        temperature,
        max_tokens: max_tokens,
        stream: true,
    };
    
    let response = client
        .post(format!("{}/chat/completions", base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API error: {}", error_text));
    }
    
    let mut stream = response.bytes_stream();
    let mut full_content = String::new();
    
    loop {
        tokio::select! {
            // Check for cancellation
            _ = cancel_rx.recv() => {
                println!("Stream cancelled for conversation: {}", conversation_id);
                // Clean up
                let mut streams = ACTIVE_STREAMS.write().await;
                streams.remove(&conversation_id);
                return Err("Stream cancelled by user".to_string());
            }
            // Process stream chunks
            chunk_result = stream.next() => {
                match chunk_result {
                    Some(Ok(chunk)) => {
                        let text = String::from_utf8_lossy(&chunk);
                        
                        for line in text.lines() {
                            if !line.starts_with("data: ") {
                                continue;
                            }
                            
                            let json_str = &line[6..];
                            if json_str == "[DONE]" {
                                let _ = app.emit(&format!("ai-stream-{}", conversation_id), StreamChunk {
                                    content: String::new(),
                                    done: true,
                                });
                                // Clean up on completion
                                let mut streams = ACTIVE_STREAMS.write().await;
                                streams.remove(&conversation_id);
                                return Ok(full_content);
                            }
                            
                            if let Ok(data) = serde_json::from_str::<serde_json::Value>(json_str) {
                                if let Some(content) = data["choices"][0]["delta"]["content"].as_str() {
                                    full_content.push_str(content);
                                    
                                    let _ = app.emit(&format!("ai-stream-{}", conversation_id), StreamChunk {
                                        content: content.to_string(),
                                        done: false,
                                    });
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        return Err(format!("Stream error: {}", e));
                    }
                    None => {
                        // Stream ended
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        break;
                    }
                }
            }
        }
    }
    
    Ok(full_content)
}

#[command(rename_all = "camelCase")]
pub async fn chat_copilot(
    app: AppHandle,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: Option<f32>,
    max_tokens: Option<i32>,
    conversation_id: String,
) -> Result<String, String> {
    let client = Client::new();
    let github_token = load_copilot_token()?;
    let copilot_token = fetch_copilot_api_token(&client, &github_token).await?;
    // Create cancellation channel for this conversation
    let (cancel_tx, mut cancel_rx) = tokio::sync::broadcast::channel(1);

    // Store the cancellation sender
    {
        let mut streams = ACTIVE_STREAMS.write().await;
        streams.insert(conversation_id.clone(), cancel_tx);
    }

    // Convert messages to OpenAI format
    // For Copilot vision: images must be sent as separate user messages (like VSCode does)
    let mut openai_messages: Vec<OpenAIMessage> = Vec::new();
    
    for msg in messages {
        if let Some(attachments) = &msg.attachments {
            let image_attachments: Vec<_> = attachments
                .iter()
                .filter(|att| att.attachment_type == "image" && att.data.is_some())
                .collect();

            if !image_attachments.is_empty() {
                // Combine images and text in a single user message (standard OpenAI vision format)
                let mut blocks: Vec<ContentBlock> = Vec::new();
                
                for att in &image_attachments {
                    if let Some(data) = &att.data {
                        let mime_type = att.mime_type.as_deref().unwrap_or("image/png");
                        let data_url = if data.starts_with("data:") {
                            data.clone()
                        } else {
                            format!("data:{};base64,{}", mime_type, data)
                        };
                        
                        blocks.push(ContentBlock::ImageUrl {
                            image_url: ImageUrl { 
                                url: data_url,
                                detail: None,
                            },
                        });
                    }
                }
                
                // Append text block (required by Copilot - cannot send image-only messages)
                let text = if msg.content.is_empty() { "What is in this image?".to_string() } else { msg.content.clone() };
                blocks.push(ContentBlock::Text { text });
                
                openai_messages.push(OpenAIMessage {
                    role: msg.role.clone(),
                    content: MessageContent::ContentBlocks(blocks),
                });
            } else {
                // No images, just text
                openai_messages.push(OpenAIMessage {
                    role: msg.role,
                    content: MessageContent::Text(msg.content),
                });
            }
        } else {
            // No attachments
            openai_messages.push(OpenAIMessage {
                role: msg.role,
                content: MessageContent::Text(msg.content),
            });
        }
    }

    let request = OpenAIRequest {
        model,
        messages: openai_messages,
        temperature,
        max_tokens: max_tokens,
        stream: true,
    };

    // Debug: log the request structure and full JSON
    let has_vision = request.messages.iter().any(|m| matches!(&m.content, MessageContent::ContentBlocks(blocks) if blocks.iter().any(|b| matches!(b, ContentBlock::ImageUrl { .. }))));
    println!("[ai.rs] Sending Copilot request: model={}, messages={}, has_vision={}", request.model, request.messages.len(), has_vision);
    for (i, msg) in request.messages.iter().enumerate() {
        match &msg.content {
            MessageContent::Text(t) => println!("[ai.rs]   msg[{}] role={} text_len={}", i, msg.role, t.len()),
            MessageContent::ContentBlocks(blocks) => println!("[ai.rs]   msg[{}] role={} blocks={:?}", i, msg.role, blocks.iter().map(|b| match b { ContentBlock::Text { .. } => "text", ContentBlock::ImageUrl { .. } => "image_url" }).collect::<Vec<_>>()),
        }
    }
    if let Ok(json_str) = serde_json::to_string(&request) {
        let truncated = if json_str.len() > 500 { format!("{}...[truncated, total={}]", &json_str[..500], json_str.len()) } else { json_str };
        println!("[ai.rs] Request JSON (truncated): {}", truncated);
    }

    let mut req_builder = client
        .post(COPILOT_CHAT_URL)
        .header("Authorization", format!("Bearer {}", copilot_token))
        .header("Content-Type", "application/json")
        .header("User-Agent", COPILOT_USER_AGENT)
        .header("Editor-Version", COPILOT_EDITOR_VERSION)
        .header("Editor-Plugin-Version", COPILOT_PLUGIN_VERSION)
        .header("Copilot-Integration-Id", COPILOT_INTEGRATION_ID)
        .header("OpenAI-Intent", "conversation-panel");

    if has_vision {
        req_builder = req_builder.header("Copilot-Vision-Request", "true");
        println!("[ai.rs] Adding Copilot-Vision-Request: true header");
    }

    let response = req_builder
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Copilot error: {}", error_text));
    }

    let mut stream = response.bytes_stream();
    let mut full_content = String::new();

    loop {
        tokio::select! {
            // Check for cancellation
            _ = cancel_rx.recv() => {
                println!("Stream cancelled for conversation: {}", conversation_id);
                // Clean up
                let mut streams = ACTIVE_STREAMS.write().await;
                streams.remove(&conversation_id);
                return Err("Stream cancelled by user".to_string());
            }
            // Process stream chunks
            chunk_result = stream.next() => {
                match chunk_result {
                    Some(Ok(chunk)) => {
                        let text = String::from_utf8_lossy(&chunk);

                        for line in text.lines() {
                            if !line.starts_with("data: ") {
                                continue;
                            }

                            let json_str = &line[6..];
                            if json_str == "[DONE]" {
                                let _ = app.emit(&format!("ai-stream-{}", conversation_id), StreamChunk {
                                    content: String::new(),
                                    done: true,
                                });
                                // Clean up on completion
                                let mut streams = ACTIVE_STREAMS.write().await;
                                streams.remove(&conversation_id);
                                return Ok(full_content);
                            }

                            if let Ok(data) = serde_json::from_str::<serde_json::Value>(json_str) {
                                if let Some(content) = data["choices"][0]["delta"]["content"].as_str() {
                                    full_content.push_str(content);

                                    let _ = app.emit(&format!("ai-stream-{}", conversation_id), StreamChunk {
                                        content: content.to_string(),
                                        done: false,
                                    });
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        return Err(format!("Stream error: {}", e));
                    }
                    None => {
                        // Stream ended
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        break;
                    }
                }
            }
        }
    }

    Ok(full_content)
}

#[command]
pub async fn stop_ai_stream() -> Result<(), String> {
    println!("Stopping all active AI streams...");
    
    // Get all active streams and signal cancellation
    let streams = ACTIVE_STREAMS.write().await;
    let count = streams.len();
    
    for (conversation_id, sender) in streams.iter() {
        println!("Cancelling stream for conversation: {}", conversation_id);
        let _ = sender.send(()); // Send cancellation signal
    }
    
    drop(streams); // Release lock before clearing
    
    // Clear all streams
    let mut streams = ACTIVE_STREAMS.write().await;
    streams.clear();
    
    println!("Cancelled {} active stream(s)", count);
    Ok(())
}

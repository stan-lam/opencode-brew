use futures::StreamExt;
use reqwest::{Client, StatusCode};
use reqwest::header::CONTENT_TYPE;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use chrono::Utc;
use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};
use url::Url;
use walkdir::WalkDir;
use uuid::Uuid;

// Global state for managing active streams
lazy_static::lazy_static! {
    static ref ACTIVE_STREAMS: Arc<RwLock<HashMap<String, tokio::sync::broadcast::Sender<()>>>> = 
        Arc::new(RwLock::new(HashMap::new()));
}

const COPILOT_CLIENT_ID: &str = "Ov23ctDVkRmgkPke0Mmm";
const COPILOT_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const COPILOT_OAUTH_AUTHORIZE_URL: &str = "https://github.com/login/oauth/authorize";
const COPILOT_OAUTH_REDIRECT_URI: &str = "http://127.0.0.1:1717/callback";
const COPILOT_SCOPE: &str = "read:user copilot";
const COPILOT_EXCHANGE_URL: &str = "https://api.github.com/copilot_internal/v2/token";
const COPILOT_CHAT_URL: &str = "https://api.githubcopilot.com/chat/completions";
const COPILOT_CHAT_INDIVIDUAL_URL: &str = "https://api.individual.githubcopilot.com/chat/completions";
const COPILOT_CHAT_BUSINESS_URL: &str = "https://api.business.githubcopilot.com/chat/completions";
// Anthropic Messages API endpoints for Claude models
const COPILOT_MESSAGES_URL: &str = "https://api.githubcopilot.com/v1/messages";
const COPILOT_MESSAGES_INDIVIDUAL_URL: &str = "https://api.individual.githubcopilot.com/v1/messages";
const COPILOT_MESSAGES_BUSINESS_URL: &str = "https://api.business.githubcopilot.com/v1/messages";
const COPILOT_RESPONSES_URL: &str = "https://api.githubcopilot.com/responses";
const COPILOT_RESPONSES_INDIVIDUAL_URL: &str = "https://api.individual.githubcopilot.com/responses";
const COPILOT_RESPONSES_BUSINESS_URL: &str = "https://api.business.githubcopilot.com/responses";
const COPILOT_MODELS_URL: &str = "https://api.githubcopilot.com/models";
const COPILOT_MODELS_V1_URL: &str = "https://api.githubcopilot.com/v1/models";
const COPILOT_MODELS_INDIVIDUAL_URL: &str = "https://api.individual.githubcopilot.com/models";
const COPILOT_MODELS_BUSINESS_URL: &str = "https://api.business.githubcopilot.com/models";
const COPILOT_MODELS_PROXY_URL: &str = "https://proxy.individual.githubcopilot.com/models";
const COPILOT_USER_AGENT: &str = "GithubCopilot/1.312.0";
const COPILOT_EDITOR_VERSION: &str = "vscode/1.99.3";
const COPILOT_PLUGIN_VERSION: &str = "copilot-chat/0.26.3";
const COPILOT_INTEGRATION_ID: &str = "vscode-chat";
const COPILOT_MODELS_INTEGRATION_ID: &str = "vscode";

// Global cache for model endpoint capabilities
lazy_static::lazy_static! {
    static ref MODEL_ENDPOINTS: Arc<RwLock<HashMap<String, Vec<String>>>> = 
        Arc::new(RwLock::new(HashMap::new()));
}

#[derive(Debug, Clone)]
struct CopilotOAuthPending {
    state: String,
    code: Option<String>,
    error: Option<String>,
}

lazy_static::lazy_static! {
    static ref COPILOT_OAUTH_PENDING: Arc<RwLock<Option<CopilotOAuthPending>>> =
        Arc::new(RwLock::new(None));
}

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
pub struct CopilotOAuthStartResponse {
    pub authorize_url: String,
    pub state: String,
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
    expires_at: Option<i64>,
    endpoints: Option<CopilotTokenEndpoints>,
    sku: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CopilotTokenEndpoints {
    api: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
enum CopilotPlanType {
    Individual,
    Business,
    Enterprise,
}

#[derive(Debug, Clone)]
struct CopilotTokenInfo {
    token: String,
    plan_type: CopilotPlanType,
}

#[derive(Debug, Deserialize)]
struct CopilotUserInfo {
    copilot_plan: Option<String>,
    endpoints: Option<CopilotEndpoints>,
}

#[derive(Debug, Deserialize)]
struct CopilotEndpoints {
    api: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubUser {
    login: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CopilotCachedAccount {
    host: String,
    username: String,
    token: String,
    source: String,
    last_used: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CopilotCachedAccountSummary {
    host: String,
    username: String,
    source: String,
    last_used: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct CopilotAccount {
    pub host: String,
    pub user: String,
    pub source: String,
    pub display_name: Option<String>,
    pub display_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CopilotCachedModelEntry {
    id: String,
    supports_vision: bool,
    supported_endpoints: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CopilotCachedModels {
    host: String,
    updated_at: String,
    models: Vec<CopilotCachedModelEntry>,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
struct CopilotAccountInternal {
    account: CopilotAccount,
    token: Option<String>,
    keychain_service: Option<String>,
}

#[allow(dead_code)]
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
    // First try to find a ghu_ token from hosts.json files (VS Code/IntelliJ tokens)
    // These can be exchanged for bearer tokens and work with Business API
    if let Some(ghu_token) = find_ghu_token_from_hosts() {
        println!("[copilot] Using ghu_ token from hosts.json");
        return Ok(ghu_token);
    }
    
    // Fall back to our stored token
    let path = get_copilot_token_path();
    let content = std::fs::read_to_string(path).map_err(|e| format!("Copilot token not found: {}", e))?;
    let data: CopilotStoredToken = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse token: {}", e))?;
    if data.access_token.trim().is_empty() {
        return Err("Copilot token is empty".to_string());
    }
    
    let prefix = if data.access_token.len() > 4 { &data.access_token[..4] } else { "" };
    println!("[copilot] Using {} token from copilot-token.json", prefix);
    Ok(data.access_token)
}

fn find_ghu_token_from_hosts() -> Option<String> {
    // Search for ghu_ tokens (from VS Code/IntelliJ)
    // These can be exchanged for bearer tokens and work with Business API
    // Token files can be named hosts.json OR apps.json
    let mut paths = Vec::new();
    
    // macOS: ~/Library/Application Support/
    if let Some(config_dir) = dirs::config_dir() {
        paths.push(config_dir.join("github-copilot").join("hosts.json"));
        paths.push(config_dir.join("github-copilot").join("apps.json"));
        paths.push(config_dir.join("GitHub Copilot").join("hosts.json"));
        paths.push(config_dir.join("GitHub Copilot").join("apps.json"));
    }
    
    // Linux/macOS: ~/.config/
    if let Some(home_dir) = dirs::home_dir() {
        paths.push(home_dir.join(".config").join("github-copilot").join("hosts.json"));
        paths.push(home_dir.join(".config").join("github-copilot").join("apps.json"));
        paths.push(home_dir.join(".config").join("GitHub Copilot").join("hosts.json"));
        paths.push(home_dir.join(".config").join("GitHub Copilot").join("apps.json"));
    }
    
    println!("[copilot] Searching for ghu_ token in paths: {:?}", paths);
    
    for path in &paths {
        if !path.exists() {
            continue;
        }
        println!("[copilot] Checking path: {:?}", path);
        if let Ok(content) = std::fs::read_to_string(&path) {
            println!("[copilot] Read {:?}, length={}", path.file_name(), content.len());
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let serde_json::Value::Object(hosts) = json {
                    for (host_key, value) in hosts {
                        if let serde_json::Value::Object(entry) = value {
                            if let Some(token) = entry.get("oauth_token").and_then(|v| v.as_str()) {
                                let prefix = if token.len() > 10 { &token[..10] } else { token };
                                println!("[copilot] Found token in {}: prefix={}", host_key, prefix);
                                // Prioritize ghu_ tokens (can be exchanged for bearer)
                                if token.starts_with("ghu_") {
                                    println!("[copilot] Using ghu_ token from {:?}", path);
                                    return Some(token.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    println!("[copilot] No ghu_ token found");
    None
}

fn delete_copilot_token() -> Result<(), String> {
    let path = get_copilot_token_path();
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("Failed to delete token: {}", e))?;
    }
    Ok(())
}

fn normalize_copilot_host(host: &str) -> String {
    let mut normalized = host
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string();
    if normalized.ends_with(":443") {
        normalized = normalized.trim_end_matches(":443").to_string();
    }
    if normalized.ends_with(":80") {
        normalized = normalized.trim_end_matches(":80").to_string();
    }
    if normalized.eq_ignore_ascii_case("api.github.com") {
        normalized = "github.com".to_string();
    }
    normalized
}

fn normalize_copilot_auth_host(host: Option<String>) -> String {
    let raw = host.unwrap_or_else(|| "github.com".to_string());
    let normalized = raw
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string();
    if normalized.is_empty() {
        "github.com".to_string()
    } else {
        normalized
    }
}

#[derive(Debug)]
enum DeviceCodeError {
    Request(String),
    Response { status: StatusCode, body: String },
}

async fn request_device_code(
    client: &Client,
    url: &str,
    client_id: &str,
) -> Result<CopilotDeviceCode, DeviceCodeError> {
    let response = client
        .post(url)
        .header("User-Agent", COPILOT_USER_AGENT)
        .header("Accept", "application/json")
        .form(&[("client_id", client_id), ("scope", COPILOT_SCOPE)])
        .send()
        .await
        .map_err(|e| DeviceCodeError::Request(format!("Failed to request device code: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(DeviceCodeError::Response { status, body });
    }

    response
        .json::<CopilotDeviceCode>()
        .await
        .map_err(|e| DeviceCodeError::Request(format!("Failed to parse device code response: {}", e)))
}

fn copilot_device_code_url(host: &str) -> String {
    format!("https://{}/login/device/code", host)
}

fn copilot_token_url(host: &str) -> String {
    format!("https://{}/login/oauth/access_token", host)
}

fn copilot_user_url(host: &str) -> String {
    if host.eq_ignore_ascii_case("github.com") {
        "https://api.github.com/user".to_string()
    } else {
        format!("https://{}/api/v3/user", host)
    }
}

fn resolve_device_flow_client_id(host: &str, client_id: Option<String>) -> Result<String, String> {
    let trimmed = client_id.unwrap_or_default().trim().to_string();
    if trimmed.is_empty() {
        Ok(resolve_copilot_client_id(None))
    } else if host.eq_ignore_ascii_case("github.com") {
        Ok(resolve_copilot_client_id(Some(trimmed)))
    } else {
        Ok(trimmed)
    }
}

fn get_copilot_accounts_path() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("OpenCodeBrew");
    path.push("copilot-accounts.json");
    path
}

fn get_copilot_models_cache_path() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("OpenCodeBrew");
    path.push("copilot-models.json");
    path
}

fn load_copilot_models_cache() -> Vec<CopilotCachedModels> {
    let path = get_copilot_models_cache_path();
    if !path.exists() {
        return Vec::new();
    }
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_copilot_models_cache(entries: &[CopilotCachedModels]) -> Result<(), String> {
    let path = get_copilot_models_cache_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create copilot models cache dir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(entries)
        .map_err(|e| format!("Failed to encode copilot model cache: {}", e))?;
    std::fs::write(path, json).map_err(|e| format!("Failed to store copilot model cache: {}", e))?;
    Ok(())
}

fn load_copilot_cached_accounts() -> Vec<CopilotCachedAccount> {
    let path = get_copilot_accounts_path();
    if !path.exists() {
        return Vec::new();
    }
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_copilot_cached_accounts(accounts: &[CopilotCachedAccount]) -> Result<(), String> {
    let path = get_copilot_accounts_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create accounts dir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(accounts)
        .map_err(|e| format!("Failed to encode copilot accounts: {}", e))?;
    std::fs::write(path, json).map_err(|e| format!("Failed to store copilot accounts: {}", e))?;
    Ok(())
}

fn cache_copilot_account(host: &str, username: &str, token: &str, source: &str) -> Result<(), String> {
    let mut accounts = load_copilot_cached_accounts();
    let now = Utc::now().to_rfc3339();
    if let Some(entry) = accounts.iter_mut().find(|entry| {
        entry.host.eq_ignore_ascii_case(host) && entry.username.eq_ignore_ascii_case(username)
    }) {
        entry.token = token.to_string();
        entry.source = source.to_string();
        entry.last_used = Some(now);
    } else {
        accounts.push(CopilotCachedAccount {
            host: host.to_string(),
            username: username.to_string(),
            token: token.to_string(),
            source: source.to_string(),
            last_used: Some(now),
        });
    }
    save_copilot_cached_accounts(&accounts)
}

fn cache_copilot_models(
    host: &str,
    model_entries: &[(String, bool, Vec<String>)],
) -> Result<(), String> {
    let mut cache_entries = load_copilot_models_cache();
    let now = Utc::now().to_rfc3339();
    let models = model_entries
        .iter()
        .map(|(id, supports_vision, endpoints)| CopilotCachedModelEntry {
            id: id.clone(),
            supports_vision: *supports_vision,
            supported_endpoints: endpoints.clone(),
        })
        .collect();
    if let Some(entry) = cache_entries
        .iter_mut()
        .find(|entry| entry.host.eq_ignore_ascii_case(host))
    {
        entry.updated_at = now;
        entry.models = models;
    } else {
        cache_entries.push(CopilotCachedModels {
            host: host.to_string(),
            updated_at: now,
            models,
        });
    }
    save_copilot_models_cache(&cache_entries)
}

fn load_cached_model_entries(host: &str) -> Option<Vec<(String, bool, Vec<String>)>> {
    let cache_entries = load_copilot_models_cache();
    let entry = cache_entries
        .into_iter()
        .find(|entry| entry.host.eq_ignore_ascii_case(host))?;
    let entries = entry
        .models
        .into_iter()
        .map(|model| (model.id, model.supports_vision, model.supported_endpoints))
        .collect::<Vec<_>>();
    if entries.is_empty() {
        None
    } else {
        Some(entries)
    }
}

fn models_from_entries(entries: &[(String, bool, Vec<String>)]) -> Vec<String> {
    let mut models: Vec<String> = entries.iter().map(|(id, _, _)| id.clone()).collect();
    let mut seen = HashSet::new();
    models.retain(|model| seen.insert(model.clone()));
    models.sort();
    models
}

fn vision_models_from_entries(entries: &[(String, bool, Vec<String>)]) -> Vec<String> {
    let mut models: Vec<String> = entries
        .iter()
        .filter(|(_, supports_vision, _)| *supports_vision)
        .map(|(id, _, _)| id.clone())
        .collect();
    let mut seen = HashSet::new();
    models.retain(|model| seen.insert(model.clone()));
    models.sort();
    models
}

fn error_is_forbidden(error: &str) -> bool {
    let lowered = error.to_lowercase();
    lowered.contains("403") || lowered.contains("forbidden")
}

#[allow(dead_code)]
fn copilot_hosts_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();

    let mut push_path = |path: PathBuf| {
        let key = path.to_string_lossy().to_string();
        if seen.insert(key) {
            paths.push(path);
        }
    };

    if let Some(config_dir) = dirs::config_dir() {
        push_path(config_dir.join("github-copilot").join("hosts.json"));
        push_path(config_dir.join("GitHub Copilot").join("hosts.json"));
        push_path(config_dir.join("JetBrains").join("github-copilot").join("hosts.json"));
        push_path(config_dir.join("JetBrains").join("GitHub Copilot").join("hosts.json"));
        push_path(config_dir.join("JetBrains"));
    }
    if let Some(data_dir) = dirs::data_dir() {
        push_path(data_dir.join("github-copilot").join("hosts.json"));
        push_path(data_dir.join("GitHub Copilot").join("hosts.json"));
        push_path(data_dir.join("JetBrains").join("github-copilot").join("hosts.json"));
        push_path(data_dir.join("JetBrains").join("GitHub Copilot").join("hosts.json"));
        push_path(data_dir.join("JetBrains"));
    }
    if let Some(data_local_dir) = dirs::data_local_dir() {
        push_path(data_local_dir.join("github-copilot").join("hosts.json"));
        push_path(data_local_dir.join("GitHub Copilot").join("hosts.json"));
        push_path(data_local_dir.join("JetBrains").join("github-copilot").join("hosts.json"));
        push_path(data_local_dir.join("JetBrains").join("GitHub Copilot").join("hosts.json"));
        push_path(data_local_dir.join("JetBrains"));
    }
    if let Some(home_dir) = dirs::home_dir() {
        push_path(home_dir.join(".config").join("github-copilot").join("hosts.json"));
        push_path(home_dir.join(".config").join("GitHub Copilot").join("hosts.json"));
        push_path(home_dir.join(".config").join("JetBrains"));
    }

    let mut expanded_paths = Vec::new();
    for path in paths {
        if path.is_dir() {
            expanded_paths.extend(find_copilot_hosts_in_dir(&path));
        } else {
            expanded_paths.push(path);
        }
    }

    expanded_paths
}

#[allow(dead_code)]
fn find_copilot_hosts_in_dir(root: &PathBuf) -> Vec<PathBuf> {
    let mut matches = Vec::new();
    if !root.exists() {
        return matches;
    }
    for entry in WalkDir::new(root).max_depth(8).follow_links(false) {
        let Ok(entry) = entry else {
            continue;
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_lowercase();
        if !(file_name.ends_with(".json") || file_name == "hosts.json") {
            continue;
        }
        let path = entry.path();
        let has_copilot_dir = path
            .components()
            .any(|comp| comp.as_os_str().to_string_lossy().to_lowercase().contains("copilot"));
        if !has_copilot_dir {
            continue;
        }
        let Ok(contents) = std::fs::read_to_string(path) else {
            continue;
        };
        if !(contents.contains("\"oauth_token\"")
            || contents.contains("\"access_token\"")
            || contents.contains("\"token\"")) {
            continue;
        }
        matches.push(path.to_path_buf());
    }
    matches
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
fn parse_keychain_value(line: &str) -> Option<String> {
    let start = line.find("=\"")?;
    let rest = &line[start + 2..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
fn parse_keychain_dump(dump: &str, accounts: &mut Vec<CopilotAccountInternal>) {
    let mut current_service: Option<String> = None;
    let mut current_account: Option<String> = None;
    let mut pushed = false;

    for line in dump.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("keychain:") || trimmed.starts_with("class:") {
            current_service = None;
            current_account = None;
            pushed = false;
            continue;
        }
        if trimmed.starts_with("\"svce\"") {
            current_service = parse_keychain_value(trimmed);
        } else if trimmed.starts_with("\"acct\"") {
            current_account = parse_keychain_value(trimmed);
        }

        if !pushed {
            if let (Some(service), Some(account)) = (&current_service, &current_account) {
                let service_lower = service.to_lowercase();
                if service_lower.contains("copilot") {
                    println!(
                        "[copilot][keychain] found service={} account={}",
                        service, account
                    );
                    accounts.push(CopilotAccountInternal {
                        account: CopilotAccount {
                            host: "github.com".to_string(),
                            user: account.clone(),
                            source: format!("Keychain ({})", service),
                            display_name: None,
                            display_error: None,
                        },
                        token: None,
                        keychain_service: Some(service.clone()),
                    });
                    pushed = true;
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
fn collect_keychain_accounts() -> Vec<CopilotAccountInternal> {
    let mut accounts = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut dumps: Vec<String> = Vec::new();

    if let Ok(output) = Command::new("security").arg("dump-keychain").output() {
        if output.status.success() {
            println!(
                "[copilot][keychain] dump-keychain bytes={}",
                output.stdout.len()
            );
            dumps.push(String::from_utf8_lossy(&output.stdout).to_string());
        }
    }

    if let Some(home_dir) = dirs::home_dir() {
        let login_keychain = home_dir.join("Library/Keychains/login.keychain-db");
        if login_keychain.exists() {
            if let Ok(output) = Command::new("security")
                .arg("dump-keychain")
                .arg(login_keychain.to_string_lossy().to_string())
                .output()
            {
                if output.status.success() {
                    println!(
                        "[copilot][keychain] dump-keychain login.keychain-db bytes={}",
                        output.stdout.len()
                    );
                    dumps.push(String::from_utf8_lossy(&output.stdout).to_string());
                }
            }
        }
    }

    for dump in dumps {
        parse_keychain_dump(&dump, &mut accounts);
    }

    accounts.retain(|account| {
        let key = format!(
            "{}:{}",
            account
                .keychain_service
                .clone()
                .unwrap_or_else(|| "unknown".to_string()),
            account.account.user
        );
        seen.insert(key)
    });

    println!("[copilot][keychain] total matches={}", accounts.len());
    accounts
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn collect_keychain_accounts() -> Vec<CopilotAccountInternal> {
    Vec::new()
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
fn fetch_keychain_token(service: &str, account: &str) -> Result<String, String> {
    println!(
        "[copilot][keychain] reading token for service={} account={}",
        service, account
    );
    let output = Command::new("security")
        .args(["find-generic-password", "-s", service, "-a", account, "-w"])
        .output()
        .map_err(|e| format!("Failed to read Keychain item: {}", e))?;
    if !output.status.success() {
        println!(
            "[copilot][keychain] token read failed: status={}",
            output.status
        );
        return Err("Keychain access denied or item not found.".to_string());
    }
    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() {
        return Err("Keychain token is empty.".to_string());
    }
    Ok(token)
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn fetch_keychain_token(_service: &str, _account: &str) -> Result<String, String> {
    Err("Keychain access is only supported on macOS.".to_string())
}

#[allow(dead_code)]
fn extract_copilot_token(entry: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    entry
        .get("oauth_token")
        .and_then(|v| v.as_str())
        .or_else(|| entry.get("access_token").and_then(|v| v.as_str()))
        .or_else(|| entry.get("token").and_then(|v| v.as_str()))
        .map(|token| token.to_string())
}

#[allow(dead_code)]
fn parse_copilot_hosts_value(
    host: &str,
    value: &serde_json::Value,
    source: &str,
    accounts: &mut Vec<CopilotAccountInternal>,
) {
    match value {
        serde_json::Value::Object(map) => {
            let user = map.get("user").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let token = extract_copilot_token(map).unwrap_or_default();
            if !user.is_empty() && !token.is_empty() {
                accounts.push(CopilotAccountInternal {
                    account: CopilotAccount {
                        host: host.to_string(),
                        user,
                        source: source.to_string(),
                            display_name: None,
                            display_error: None,
                    },
                    token: Some(token),
                    keychain_service: None,
                });
            }
        }
        serde_json::Value::Array(entries) => {
            for entry in entries {
                if let serde_json::Value::Object(map) = entry {
                    let user = map.get("user").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let token = extract_copilot_token(map).unwrap_or_default();
                    if !user.is_empty() && !token.is_empty() {
                        accounts.push(CopilotAccountInternal {
                            account: CopilotAccount {
                                host: host.to_string(),
                                user,
                                source: source.to_string(),
                                display_name: None,
                                display_error: None,
                            },
                            token: Some(token),
                            keychain_service: None,
                        });
                    }
                }
            }
        }
        _ => {}
    }
}

#[allow(dead_code)]
fn collect_copilot_accounts() -> Result<Vec<CopilotAccountInternal>, String> {
    let mut accounts: Vec<CopilotAccountInternal> = Vec::new();

    for path in copilot_hosts_paths() {
        if !path.exists() {
            continue;
        }
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read Copilot hosts file: {}", e))?;
        let json: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse Copilot hosts file: {}", e))?;
        let source = "GitHub Copilot".to_string();

        match json {
            serde_json::Value::Object(hosts) => {
                for (host_key, value) in hosts {
                    let host = normalize_copilot_host(&host_key);
                    parse_copilot_hosts_value(&host, &value, &source, &mut accounts);
                }
            }
            serde_json::Value::Array(entries) => {
                for entry in entries {
                    if let serde_json::Value::Object(map) = entry {
                        let host = map
                            .get("host")
                            .and_then(|v| v.as_str())
                            .map(normalize_copilot_host)
                            .unwrap_or_else(|| "github.com".to_string());
                        parse_copilot_hosts_value(&host, &serde_json::Value::Object(map), &source, &mut accounts);
                    }
                }
            }
            _ => {}
        }
    }

    accounts.extend(collect_keychain_accounts());

    Ok(accounts)
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

fn build_copilot_authorize_url(client_id: &str, state: &str) -> Result<String, String> {
    let mut url = Url::parse(COPILOT_OAUTH_AUTHORIZE_URL)
        .map_err(|e| format!("Failed to build authorize URL: {}", e))?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", COPILOT_OAUTH_REDIRECT_URI)
        .append_pair("scope", COPILOT_SCOPE)
        .append_pair("state", state);
    Ok(url.to_string())
}

async fn respond_oauth_browser(mut socket: tokio::net::TcpStream, success: bool, detail: Option<&str>) {
    let title = if success { "Authentication Successful" } else { "Authentication Failed" };
    let message = if success {
        "You can now return to OpenCodeBrew and continue using GitHub Copilot."
    } else {
        "The authentication flow did not complete. You can return to OpenCodeBrew and try again."
    };
    let extra = detail.unwrap_or("");
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{}</title></head>\
         <body style=\"font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; \
         background: #0d1117; color: #c9d1d9; text-align: center; padding: 48px;\">\
         <h1 style=\"color:#3fb950;\">{}</h1><p>{}</p><p style=\"color:#8b949e;\">{}</p></body></html>",
        title, title, message, extra
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = socket.write_all(response.as_bytes()).await;
    let _ = socket.flush().await;
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

// ========== Responses API Structures ==========

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum ResponsesInputContent {
    Text(String),
    Items(Vec<ResponsesInputItem>),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ResponsesInputItem {
    #[serde(rename = "message")]
    Message {
        role: String,
        content: ResponsesMessageContent,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum ResponsesMessageContent {
    Text(String),
    ContentList(Vec<ResponsesContentItem>),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ResponsesContentItem {
    #[serde(rename = "input_text")]
    InputText { text: String },
    #[serde(rename = "input_image")]
    InputImage {
        image_url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
}

#[derive(Debug, Serialize, Deserialize)]
struct ResponsesApiRequest {
    model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    instructions: Option<String>,
    input: ResponsesInputContent,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_output_tokens: Option<i32>,
    stream: bool,
    store: bool,
}

// ========== End Responses API Structures ==========

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    pub content: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsageEvent {
    pub model: String,
    pub provider: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_read_tokens: i64,
    pub estimated_cost_usd: f64,
}

/// Estimate token count from text (approximately 4 characters per token)
fn estimate_tokens(text: &str) -> i64 {
    (text.len() as f64 / 4.0).ceil() as i64
}

/// Emit token usage event for tracking (basic version for simple providers)
fn emit_token_usage(app: &AppHandle, model: &str, provider: &str, prompt_content: &str, completion_content: &str) {
    emit_token_usage_detailed(app, model, provider, prompt_content, completion_content, 0, 0);
}

/// Emit detailed token usage event with cache and cost tracking
fn emit_token_usage_detailed(
    app: &AppHandle, 
    model: &str, 
    provider: &str, 
    prompt_content: &str, 
    completion_content: &str,
    cache_creation_tokens: i64,
    cache_read_tokens: i64,
) {
    let prompt_tokens = estimate_tokens(prompt_content);
    let completion_tokens = estimate_tokens(completion_content);
    let total_tokens = prompt_tokens + completion_tokens;
    
    // Calculate cost using pricing module
    let estimated_cost_usd = if let Some(pricing) = super::pricing::get_model_pricing(model, provider) {
        pricing.calculate_cost(prompt_tokens, completion_tokens, cache_creation_tokens, cache_read_tokens)
    } else {
        0.0
    };
    
    let usage = TokenUsageEvent {
        model: model.to_string(),
        provider: provider.to_string(),
        prompt_tokens,
        completion_tokens,
        total_tokens,
        cache_creation_tokens,
        cache_read_tokens,
        estimated_cost_usd,
    };
    
    println!("[ai.rs] Token usage: model={}, provider={}, prompt={}, completion={}, total={}, cache_create={}, cache_read={}, cost=${:.6}", 
             model, provider, prompt_tokens, completion_tokens, total_tokens, cache_creation_tokens, cache_read_tokens, estimated_cost_usd);
    
    let _ = app.emit("token-usage", usage);
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
pub async fn copilot_device_login_start(
    host: Option<String>,
    client_id: Option<String>,
) -> Result<CopilotDeviceCode, String> {
    let client = Client::new();
    let host = normalize_copilot_auth_host(host);
    let client_id = resolve_device_flow_client_id(&host, client_id)?;
    let device_code_url = copilot_device_code_url(&host);

    match request_device_code(&client, &device_code_url, &client_id).await {
        Ok(code) => Ok(code),
        Err(DeviceCodeError::Response { status, body }) if status == StatusCode::NOT_FOUND => {
            let fallback_url = format!("https://{}/login/oauth/device/code", host);
            match request_device_code(&client, &fallback_url, &client_id).await {
                Ok(code) => Ok(code),
                Err(DeviceCodeError::Response { status, .. }) if status == StatusCode::NOT_FOUND => {
                    Err(format!(
                        "Device flow is not supported on {}. Use OAuth client ID + secret.",
                        host
                    ))
                }
                Err(err) => {
                    let message = match err {
                        DeviceCodeError::Request(detail) => detail,
                        DeviceCodeError::Response { status, body } => {
                            format!("Device code request failed ({}) {}", status, body)
                        }
                    };
                    Err(format!(
                        "Device code request failed at {} and {}: {}",
                        device_code_url, fallback_url, message
                    ))
                }
            }
        }
        Err(DeviceCodeError::Request(detail)) => Err(detail),
        Err(DeviceCodeError::Response { status, body }) => Err(format!(
            "Device code request failed ({}) {}",
            status, body
        )),
    }
}

#[command]
pub async fn copilot_oauth_start(client_id: String) -> Result<CopilotOAuthStartResponse, String> {
    let trimmed_client_id = client_id.trim().to_string();
    if trimmed_client_id.is_empty() {
        return Err("GitHub OAuth client ID is required.".to_string());
    }

    let state = Uuid::new_v4().to_string();
    let authorize_url = build_copilot_authorize_url(&trimmed_client_id, &state)?;

    {
        let mut pending = COPILOT_OAUTH_PENDING.write().await;
        if pending.is_some() {
            return Err("Copilot OAuth flow already in progress.".to_string());
        }
        *pending = Some(CopilotOAuthPending {
            state: state.clone(),
            code: None,
            error: None,
        });
    }

    let listener = match TcpListener::bind(("127.0.0.1", 1717)).await {
        Ok(listener) => listener,
        Err(err) => {
            let mut pending = COPILOT_OAUTH_PENDING.write().await;
            *pending = None;
            return Err(format!("Port 1717 is in use. Close other apps and try again. ({})", err));
        }
    };

    tokio::spawn(async move {
        if let Ok((mut socket, _)) = listener.accept().await {
            let mut buffer = [0u8; 4096];
            let bytes_read = match socket.read(&mut buffer).await {
                Ok(0) => return,
                Ok(n) => n,
                Err(_) => return,
            };

            let request = String::from_utf8_lossy(&buffer[..bytes_read]);
            let request_line = request.lines().next().unwrap_or_default();
            let path = request_line.split_whitespace().nth(1).unwrap_or("/");
            let url = Url::parse(&format!("http://localhost{}", path));

            let mut success = false;
            let mut detail: Option<String> = None;

            match url {
                Ok(url) => {
                    let params: HashMap<String, String> = url.query_pairs().into_owned().collect();
                    let code = params.get("code").cloned();
                    let state_param = params.get("state").cloned();
                    let error_param = params.get("error").cloned();

                    let mut pending = COPILOT_OAUTH_PENDING.write().await;
                    if let Some(pending_state) = pending.as_mut() {
                        if state_param.as_deref() != Some(pending_state.state.as_str()) {
                            let message = "OAuth state mismatch. Please try again.".to_string();
                            pending_state.error = Some(message.clone());
                            detail = Some(message);
                        } else if let Some(err) = error_param {
                            let message = format!("GitHub OAuth error: {}", err);
                            pending_state.error = Some(message.clone());
                            detail = Some(message);
                        } else if let Some(code) = code {
                            pending_state.code = Some(code);
                            success = true;
                        } else {
                            let message = "OAuth callback missing authorization code.".to_string();
                            pending_state.error = Some(message.clone());
                            detail = Some(message);
                        }
                    } else {
                        detail = Some("No active OAuth login found.".to_string());
                    }
                }
                Err(_) => {
                    detail = Some("Invalid OAuth callback request.".to_string());
                }
            }

            respond_oauth_browser(socket, success, detail.as_deref()).await;
        }
    });

    Ok(CopilotOAuthStartResponse { authorize_url, state })
}

#[command]
pub async fn copilot_oauth_poll(
    state: String,
    client_id: String,
    client_secret: String,
) -> Result<bool, String> {
    if client_id.trim().is_empty() {
        return Err("GitHub OAuth client ID is required.".to_string());
    }
    if client_secret.trim().is_empty() {
        return Err("GitHub OAuth client secret is required.".to_string());
    }

    let start = Instant::now();
    let max_wait = Duration::from_secs(300);

    loop {
        if start.elapsed() > max_wait {
            let mut pending = COPILOT_OAUTH_PENDING.write().await;
            if pending.as_ref().map(|p| p.state == state).unwrap_or(false) {
                *pending = None;
            }
            return Err("Timed out waiting for OAuth callback. Please try again.".to_string());
        }

        let (code, error, state_mismatch) = {
            let pending = COPILOT_OAUTH_PENDING.read().await;
            match pending.as_ref() {
                Some(pending_state) => (
                    pending_state.code.clone(),
                    pending_state.error.clone(),
                    pending_state.state != state,
                ),
                None => {
                    return Err("No active OAuth login found.".to_string());
                }
            }
        };

        if state_mismatch {
            let mut pending = COPILOT_OAUTH_PENDING.write().await;
            *pending = None;
            return Err("OAuth state mismatch. Please try again.".to_string());
        }

        if let Some(error) = error {
            let mut pending = COPILOT_OAUTH_PENDING.write().await;
            *pending = None;
            return Err(error);
        }

        if let Some(code) = code {
            let client = Client::new();
            let response = client
                .post(COPILOT_TOKEN_URL)
                .header("User-Agent", COPILOT_USER_AGENT)
                .header("Accept", "application/json")
                .form(&[
                    ("client_id", client_id.as_str()),
                    ("client_secret", client_secret.as_str()),
                    ("code", code.as_str()),
                    ("redirect_uri", COPILOT_OAUTH_REDIRECT_URI),
                ])
                .send()
                .await
                .map_err(|e| format!("Failed to exchange OAuth token: {}", e))?;

            if !response.status().is_success() {
                let error_text = response.text().await.unwrap_or_default();
                let mut pending = COPILOT_OAUTH_PENDING.write().await;
                *pending = None;
                return Err(format!("OAuth token exchange failed: {}", error_text));
            }

            let data: CopilotAccessTokenResponse = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse OAuth token response: {}", e))?;

            if let Some(token) = data.access_token {
                save_copilot_token(&token)?;
                let mut pending = COPILOT_OAUTH_PENDING.write().await;
                *pending = None;
                return Ok(true);
            }

            let mut pending = COPILOT_OAUTH_PENDING.write().await;
            *pending = None;

            if let Some(error) = data.error {
                let description = data.error_description.unwrap_or_else(|| error.clone());
                return Err(format!("OAuth token error: {}", description));
            }

            return Err("OAuth token response missing access token.".to_string());
        }

        sleep(Duration::from_millis(400)).await;
    }
}

#[command]
pub async fn copilot_device_login_poll(
    device_code: String,
    interval: Option<i64>,
    expires_in: Option<i64>,
    host: Option<String>,
    client_id: Option<String>,
) -> Result<bool, String> {
    let client = Client::new();
    let host = normalize_copilot_auth_host(host);
    let client_id = resolve_device_flow_client_id(&host, client_id)?;
    let token_url = copilot_token_url(&host);
    let mut poll_interval = interval.unwrap_or(5).max(1) as u64;
    let max_wait = Duration::from_secs(expires_in.unwrap_or(900).max(60) as u64);
    let start = Instant::now();

    loop {
        if start.elapsed() > max_wait {
            return Err("Device code expired. Please try again.".to_string());
        }

        let response = client
            .post(&token_url)
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
            let username = fetch_github_login(&client, &token, &host).await?;
            cache_copilot_account(&host, &username, &token, "device-flow")?;
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
pub async fn copilot_list_accounts(
    resolve_display_names: Option<bool>,
    host: Option<String>,
) -> Result<Vec<CopilotAccount>, String> {
    let _ = resolve_display_names;
    let _ = host;
    println!("[copilot][account] local account discovery disabled");
    Ok(Vec::new())
}

#[command]
pub async fn copilot_cached_accounts_list(
    host: Option<String>,
) -> Result<Vec<CopilotCachedAccountSummary>, String> {
    let host = host.map(|value| normalize_copilot_auth_host(Some(value)));
    let mut accounts: Vec<CopilotCachedAccountSummary> = load_copilot_cached_accounts()
        .into_iter()
        .filter(|account| {
            host.as_ref()
                .map(|filter_host| account.host.eq_ignore_ascii_case(filter_host))
                .unwrap_or(true)
        })
        .map(|account| CopilotCachedAccountSummary {
            host: account.host,
            username: account.username,
            source: account.source,
            last_used: account.last_used,
        })
        .collect();
    accounts.sort_by(|a, b| a.username.cmp(&b.username));
    Ok(accounts)
}

#[command]
pub async fn copilot_cached_account_import(host: String, username: String) -> Result<bool, String> {
    let host = normalize_copilot_auth_host(Some(host));
    let mut accounts = load_copilot_cached_accounts();
    let entry = accounts
        .iter_mut()
        .find(|account| account.host.eq_ignore_ascii_case(&host) && account.username.eq_ignore_ascii_case(&username))
        .ok_or_else(|| "Cached Copilot account not found.".to_string())?;
    save_copilot_token(&entry.token)?;
    entry.last_used = Some(Utc::now().to_rfc3339());
    save_copilot_cached_accounts(&accounts)?;
    Ok(true)
}

#[command]
pub async fn copilot_cached_accounts_clear(host: Option<String>) -> Result<bool, String> {
    let host = host.map(|value| normalize_copilot_auth_host(Some(value)));
    let mut accounts = load_copilot_cached_accounts();
    if let Some(filter_host) = host {
        accounts.retain(|account| !account.host.eq_ignore_ascii_case(&filter_host));
    } else {
        accounts.clear();
    }
    save_copilot_cached_accounts(&accounts)?;
    Ok(true)
}

#[command]
pub async fn copilot_cached_models_list(host: Option<String>) -> Result<Vec<String>, String> {
    let host = normalize_copilot_auth_host(host);
    let entries = load_cached_model_entries(&host).unwrap_or_default();
    update_model_endpoints_cache(&entries).await;
    Ok(models_from_entries(&entries))
}

#[command]
pub async fn copilot_import_account(host: String, user: String) -> Result<bool, String> {
    let _ = host;
    let _ = user;
    Err("Local Copilot account reuse is disabled.".to_string())
}

#[command]
pub async fn copilot_device_logout() -> Result<(), String> {
    delete_copilot_token()
}

fn copilot_exchange_url(host: &str, enterprise_type: Option<&str>) -> String {
    if host.eq_ignore_ascii_case("github.com") || host.eq_ignore_ascii_case("api.github.com") {
        return COPILOT_EXCHANGE_URL.to_string();
    }
    let base_host = host.strip_prefix("api.").unwrap_or(host);
    let is_ghe = enterprise_type == Some("ghe")
        || base_host.eq_ignore_ascii_case("ghe.com")
        || base_host.ends_with(".ghe.com");
    if is_ghe {
        if host.eq_ignore_ascii_case(base_host) {
            format!("https://api.{}/copilot_internal/v2/token", base_host)
        } else {
            format!("https://{}/copilot_internal/v2/token", host)
        }
    } else {
        format!("https://{}/api/v3/copilot_internal/v2/token", host)
    }
}

struct CopilotModelsUrls {
    primary: String,
    fallback: Option<String>,
    legacy: Option<String>,
}

fn copilot_models_urls(host: &str) -> CopilotModelsUrls {
    if host.eq_ignore_ascii_case("github.com") || host.eq_ignore_ascii_case("api.github.com") {
        CopilotModelsUrls {
            primary: COPILOT_MODELS_INDIVIDUAL_URL.to_string(),
            fallback: Some(COPILOT_MODELS_PROXY_URL.to_string()),
            legacy: Some(COPILOT_MODELS_V1_URL.to_string()),
        }
    } else {
        CopilotModelsUrls {
            primary: COPILOT_MODELS_URL.to_string(),
            fallback: None,
            legacy: Some(COPILOT_MODELS_V1_URL.to_string()),
        }
    }
}

async fn send_copilot_token_exchange(
    client: &Client,
    github_token: &str,
    exchange_url: &str,
    auth_scheme: &str,
    integration_id: &str,
    api_version: Option<&str>,
) -> Result<reqwest::Response, String> {
    let mut request = client
        .get(exchange_url)
        .header("Authorization", format!("{} {}", auth_scheme, github_token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", COPILOT_USER_AGENT)
        .header("Editor-Version", COPILOT_EDITOR_VERSION)
        .header("Editor-Plugin-Version", COPILOT_PLUGIN_VERSION)
        .header("Copilot-Integration-Id", integration_id);
    if let Some(version) = api_version {
        request = request.header("X-GitHub-Api-Version", version);
    }
    request
        .send()
        .await
        .map_err(|e| format!("Failed to exchange Copilot token: {}", e))
}

async fn fetch_copilot_api_token(
    client: &Client,
    github_token: &str,
    exchange_url: &str,
) -> Result<String, String> {
    let info = resolve_copilot_token(client, github_token, exchange_url).await?;
    Ok(info.token)
}

async fn fetch_copilot_user_info(
    client: &Client,
    github_token: &str,
) -> Option<CopilotUserInfo> {
    let response = client
        .get("https://api.github.com/copilot_internal/user")
        .header("Authorization", format!("Bearer {}", github_token))
        .header("Accept", "application/json")
        .header("User-Agent", COPILOT_USER_AGENT)
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .ok()?;
    
    if !response.status().is_success() {
        println!("[copilot] User info request failed: {}", response.status());
        return None;
    }
    
    response.json::<CopilotUserInfo>().await.ok()
}

async fn resolve_copilot_token(
    client: &Client,
    github_token: &str,
    exchange_url: &str,
) -> Result<CopilotTokenInfo, String> {
    // Try different combinations of auth scheme, integration ID, and API version
    // Order: most likely to work first, then fallbacks
    let attempts: &[(&str, &str, Option<&str>)] = &[
        ("Bearer", COPILOT_MODELS_INTEGRATION_ID, None),
        ("Bearer", COPILOT_INTEGRATION_ID, None),
        ("token", COPILOT_MODELS_INTEGRATION_ID, None),
        ("token", COPILOT_INTEGRATION_ID, None),
        ("Bearer", COPILOT_MODELS_INTEGRATION_ID, Some("2022-11-28")),
        ("token", COPILOT_INTEGRATION_ID, Some("2022-11-28")),
    ];

    let mut last_status: Option<StatusCode> = None;
    let mut should_try_raw_token = false;

    // Log token prefix to help debug
    let token_prefix = if github_token.len() > 10 {
        &github_token[..10]
    } else {
        github_token
    };
    println!("[copilot] Token exchange: token_prefix={}, exchange_url={}", token_prefix, exchange_url);
    
    for (auth_scheme, integration_id, api_version) in attempts {
        let response = send_copilot_token_exchange(
            client,
            github_token,
            exchange_url,
            auth_scheme,
            integration_id,
            *api_version,
        )
        .await?;

        let status = response.status();
        last_status = Some(status);
        
        println!("[copilot] Token exchange attempt: auth={}, integration={}, version={:?}, status={}", 
                 auth_scheme, integration_id, api_version, status);
        
        if status.is_success() {
            let body = response.text().await.unwrap_or_default();
            println!("[copilot] Token exchange success, response body length: {}", body.len());
            
            let data: CopilotApiTokenResponse = serde_json::from_str(&body)
                .map_err(|e| format!("Failed to parse Copilot token response: {}", e))?;
            
            // Log the response details
            println!("[copilot] Token exchange response: sku={:?}, endpoints={:?}, has_token={}", 
                     data.sku, data.endpoints.as_ref().map(|e| &e.api), data.token.is_some());
            
            if let Some(token) = data.token.filter(|t| !t.is_empty()) {
                // Determine plan type from SKU or endpoints
                let plan_type = if let Some(sku) = &data.sku {
                    if sku.contains("business") {
                        CopilotPlanType::Business
                    } else if sku.contains("individual") {
                        CopilotPlanType::Individual
                    } else {
                        CopilotPlanType::Enterprise
                    }
                } else {
                    CopilotPlanType::Enterprise
                };
                
                println!("[copilot] Token exchange succeeded, plan_type={:?}", plan_type);
                return Ok(CopilotTokenInfo {
                    token,
                    plan_type,
                });
            }
            // Token was empty, try next attempt
            continue;
        }

        // Track 404/403 - these indicate we should try fallback to raw OAuth token
        // 404 = endpoint doesn't exist (non-Enterprise accounts)
        // 403 = forbidden (could be rate limit, or account doesn't have Enterprise token exchange)
        if status == StatusCode::NOT_FOUND || status == StatusCode::FORBIDDEN {
            should_try_raw_token = true;
        }

        // If not a retryable error, stop trying
        if !matches!(
            status,
            StatusCode::NOT_FOUND | StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
        ) {
            let error_text = truncate_error_body(response.text().await.unwrap_or_default());
            return Err(format!(
                "Copilot token exchange failed ({}): {}",
                status, error_text
            ));
        }
    }

    // If token exchange failed with 404 or 403, try using raw OAuth token with user's plan
    // 404 = endpoint doesn't exist (non-Enterprise accounts)
    // 403 = forbidden (could be rate limit, or account doesn't have Enterprise token exchange)
    // For Business/Individual accounts, the raw OAuth token should work directly
    if should_try_raw_token {
        println!("[copilot] Token exchange failed (last status: {:?}), trying raw OAuth token fallback", last_status);
        
        // Fetch user info to determine plan type
        if let Some(user_info) = fetch_copilot_user_info(client, github_token).await {
            let plan = user_info.copilot_plan.as_deref().unwrap_or("unknown");
            println!("[copilot] User plan: {}", plan);
            
            let plan_type = match plan {
                "individual" => CopilotPlanType::Individual,
                "business" | "copilot_for_business_seat_quota" => CopilotPlanType::Business,
                _ => CopilotPlanType::Enterprise,
            };
            
            println!("[copilot] Using {:?} API with raw OAuth token", plan_type);
            return Ok(CopilotTokenInfo {
                token: github_token.to_string(),
                plan_type,
            });
        }
        
        // Couldn't determine plan, try Individual as fallback
        println!("[copilot] Could not determine plan, falling back to Individual API");
        return Ok(CopilotTokenInfo {
            token: github_token.to_string(),
            plan_type: CopilotPlanType::Individual,
        });
    }
    
    // For 401, the OAuth token is truly invalid
    Err(format!(
        "Copilot token exchange failed ({}): account may not have Copilot access or token is invalid",
        last_status.map(|s| s.to_string()).unwrap_or_else(|| "unknown".to_string())
    ))
}

fn truncate_error_body(body: String) -> String {
    let trimmed = body.trim();
    if trimmed.len() > 400 {
        format!("{}…", &trimmed[..400])
    } else {
        trimmed.to_string()
    }
}

fn response_is_json(response: &reqwest::Response) -> bool {
    response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.contains("application/json"))
        .unwrap_or(false)
}

async fn update_model_endpoints_cache(model_entries: &[(String, bool, Vec<String>)]) {
    let mut endpoints_cache = MODEL_ENDPOINTS.write().await;
    for (id, _, endpoints) in model_entries {
        endpoints_cache.insert(id.clone(), endpoints.clone());
    }
}

async fn load_cached_models_with_endpoints(
    host: &str,
    reason: &str,
) -> Option<Vec<(String, bool, Vec<String>)>> {
    let entries = load_cached_model_entries(host)?;
    println!("[copilot][models] {}: using cached models for {}", reason, host);
    update_model_endpoints_cache(&entries).await;
    Some(entries)
}

async fn fetch_copilot_models_response(
    client: &Client,
    copilot_token: &str,
    url: &str,
) -> Result<(reqwest::Response, bool), String> {
    let response = send_copilot_models_request(
        client,
        copilot_token,
        COPILOT_MODELS_INTEGRATION_ID,
        url,
    )
    .await?;
    let is_json = response_is_json(&response);
    if response.status().is_success() && is_json {
        return Ok((response, true));
    }

    let retry = send_copilot_models_request(
        client,
        copilot_token,
        COPILOT_INTEGRATION_ID,
        url,
    )
    .await?;
    let retry_is_json = response_is_json(&retry);
    if retry.status().is_success() && retry_is_json {
        return Ok((retry, true));
    }

    Ok((retry, retry_is_json))
}

async fn send_copilot_models_request(
    client: &Client,
    copilot_token: &str,
    integration_id: &str,
    url: &str,
) -> Result<reqwest::Response, String> {
    // Use headers that match VSCode/IntelliJ Copilot extensions
    client
        .get(url)
        .header("Authorization", format!("Bearer {}", copilot_token))
        .header("Accept", "application/json")
        .header("User-Agent", "GitHubCopilotChat/0.26.3")
        .header("Editor-Version", "vscode/1.99.3")
        .header("Editor-Plugin-Version", "copilot-chat/0.26.3")
        .header("Editor-Plugin-Name", "copilot.vscode")
        .header("Copilot-Integration-Id", integration_id)
        .header("OpenAI-Intent", "model-list")
        .header("X-GitHub-Api-Version", "2025-04-01")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Copilot models: {}", e))
}

async fn fetch_github_login(client: &Client, github_token: &str, host: &str) -> Result<String, String> {
    let user_url = copilot_user_url(host);
    let response = client
        .get(&user_url)
        .header("User-Agent", COPILOT_USER_AGENT)
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(github_token)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch GitHub user: {}", e))?;

    let response = if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        client
            .get(&user_url)
            .header("User-Agent", COPILOT_USER_AGENT)
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", format!("token {}", github_token))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch GitHub user: {}", e))?
    } else {
        response
    };

    if !response.status().is_success() {
        println!(
            "[copilot][account] GitHub user lookup failed: {}",
            response.status()
        );
        return Err(format!(
            "GitHub user lookup failed with status: {}",
            response.status()
        ));
    }

    let user = response
        .json::<GitHubUser>()
        .await
        .map_err(|e| format!("Failed to parse GitHub user response: {}", e))?;
    if user.login.trim().is_empty() {
        return Err("GitHub user login is empty.".to_string());
    }
    Ok(user.login)
}

fn extract_models_from_data(data: &serde_json::Value) -> Vec<(String, bool, Vec<String>)> {
    // Returns vec of (model_id, supports_vision, supported_endpoints)
    let mut models: Vec<(String, bool, Vec<String>)> = Vec::new();

    let items_opt = data.get("data").and_then(|v| v.as_array())
        .or_else(|| data.get("models").and_then(|v| v.as_array()));

    if let Some(items) = items_opt {
        for item in items {
            // Prefer 'id' field, fall back to 'name' if needed
            let id = item.get("id")
                .and_then(|v| v.as_str())
                .or_else(|| item.get("name").and_then(|v| v.as_str()))
                .map(|s| s.to_string());
            
            // Also get display name if available (for logging)
            let display_name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
            
            if let Some(id) = id {
                println!("[ai.rs] Parsing model: id={}, name={}", id, display_name);
                // Check if model is enabled for picker
                let picker_enabled = item.get("model_picker_enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);

                // Get supported endpoints
                let supported_endpoints: Vec<String> = item.get("supported_endpoints")
                    .and_then(|v| v.as_array())
                    .map(|endpoints| {
                        endpoints.iter()
                            .filter_map(|e| e.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();

                // Check if model supports /chat/completions or /responses endpoint
                // If no endpoints specified, assume /chat/completions is supported (business API doesn't always include this)
                let supports_chat = supported_endpoints.is_empty() || 
                    supported_endpoints.iter().any(|e| e == "/chat/completions");
                let supports_responses = supported_endpoints.iter().any(|e| e == "/responses");

                // Skip embedding models and internal models
                let is_embedding = id.contains("embedding");
                let is_trajectory = id.contains("trajectory"); // internal model
                
                // Skip embedding models and internal models only
                // Note: Business API returns picker_enabled=false for all models, but they still work
                // So we ignore the picker_enabled flag entirely
                if is_embedding || is_trajectory {
                    println!("[ai.rs] Skipping model: {} (is_embedding={}, is_trajectory={})", 
                             id, is_embedding, is_trajectory);
                    continue;
                }

                let capabilities = item.get("capabilities");

                // Vision capability is stored under capabilities.limits.vision (not supports.vision)
                let supports_vision = capabilities
                    .and_then(|c| c.get("limits"))
                    .and_then(|l| l.get("vision"))
                    .map(|v| !v.is_null())
                    .unwrap_or(false);
                
                println!("[ai.rs] Model: {} vision={} endpoints={:?}", id, supports_vision, supported_endpoints);
                models.push((id, supports_vision, supported_endpoints));
            }
        }
    }

    models
}

#[command]
pub async fn list_copilot_models(
    host: Option<String>,
    enterprise_type: Option<String>,
) -> Result<Vec<String>, String> {
    let github_token = load_copilot_token()?;
    let client = Client::new();
    let normalized_host = normalize_copilot_auth_host(host);
    let exchange_url = copilot_exchange_url(&normalized_host, enterprise_type.as_deref());
    let token_info = match resolve_copilot_token(&client, &github_token, &exchange_url).await {
        Ok(info) => info,
        Err(error) => {
            if error_is_forbidden(&error) {
                if let Some(entries) =
                    load_cached_models_with_endpoints(&normalized_host, "token exchange forbidden").await
                {
                    return Ok(models_from_entries(&entries));
                }
            }
            return Err(error);
        }
    };
    let copilot_token = &token_info.token;
    
    // Select models endpoint based on plan type
    let models_urls = match token_info.plan_type {
        CopilotPlanType::Individual => CopilotModelsUrls {
            primary: COPILOT_MODELS_INDIVIDUAL_URL.to_string(),
            fallback: Some(COPILOT_MODELS_PROXY_URL.to_string()),
            legacy: None,
        },
        CopilotPlanType::Business => CopilotModelsUrls {
            primary: COPILOT_MODELS_BUSINESS_URL.to_string(),
            fallback: Some(COPILOT_MODELS_URL.to_string()),
            legacy: None,
        },
        CopilotPlanType::Enterprise => copilot_models_urls(&normalized_host),
    };
    println!("[copilot] Using models URL: {}", models_urls.primary);

    let (mut response, mut is_json) =
        fetch_copilot_models_response(&client, &copilot_token, &models_urls.primary).await?;

    if (!response.status().is_success() || !is_json) && models_urls.fallback.is_some() {
        if let Some(fallback_url) = models_urls.fallback.as_deref() {
            let (fallback_response, fallback_is_json) =
                fetch_copilot_models_response(&client, &copilot_token, fallback_url).await?;
            response = fallback_response;
            is_json = fallback_is_json;
        }
    }

    if (!response.status().is_success() || !is_json) && models_urls.legacy.is_some() {
        if let Some(legacy_url) = models_urls.legacy.as_deref() {
            let (legacy_response, legacy_is_json) =
                fetch_copilot_models_response(&client, &copilot_token, legacy_url).await?;
            response = legacy_response;
            is_json = legacy_is_json;
        }
    }

    if !response.status().is_success() {
        if response.status() == StatusCode::FORBIDDEN {
            if let Some(entries) =
                load_cached_models_with_endpoints(&normalized_host, "models request forbidden").await
            {
                return Ok(models_from_entries(&entries));
            }
        }
        let status = response.status();
        let error_text = truncate_error_body(response.text().await.unwrap_or_default());
        return Err(format!(
            "Copilot models request failed (status {}): {}",
            status,
            error_text
        ));
    }

    if !is_json {
        let status = response.status();
        let error_text = truncate_error_body(response.text().await.unwrap_or_default());
        return Err(format!(
            "Copilot models response was not JSON (status {}): {}",
            status,
            error_text
        ));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Copilot models: {}", e))?;

    let mut model_entries = extract_models_from_data(&data);
    
    // Log what models the API returned
    let model_ids: Vec<_> = model_entries.iter().map(|(id, _, _)| id.as_str()).collect();
    println!("[copilot] Models API returned {} models: {:?}", model_entries.len(), model_ids);
    
    // Add Claude models - they work via Copilot but may not be returned by /models API
    // Claude models use the Anthropic Messages API endpoint (/v1/messages)
    let known_claude_models = vec![
        ("claude-opus-4.5".to_string(), true, vec!["/v1/messages".to_string()]),
        ("claude-sonnet-4.6".to_string(), true, vec!["/v1/messages".to_string()]),
        ("claude-sonnet-4".to_string(), true, vec!["/v1/messages".to_string()]),
        ("claude-haiku-4.5".to_string(), true, vec!["/v1/messages".to_string()]),
        ("claude-opus-4.6".to_string(), true, vec!["/v1/messages".to_string()]),
        ("claude-opus-4".to_string(), true, vec!["/v1/messages".to_string()]),
    ];
    
    for claude_model in known_claude_models {
        if !model_entries.iter().any(|(id, _, _)| id == &claude_model.0) {
            println!("[copilot] Adding Claude model: {}", claude_model.0);
            model_entries.push(claude_model);
        }
    }
    
    // Also add "auto" model for automatic model selection
    if !model_entries.iter().any(|(id, _, _)| id == "auto") {
        model_entries.insert(0, ("auto".to_string(), false, vec!["/chat/completions".to_string()]));
    }

    update_model_endpoints_cache(&model_entries).await;
    if let Err(error) = cache_copilot_models(&normalized_host, &model_entries) {
        println!("[copilot][models] Failed to cache models: {}", error);
    }

    Ok(models_from_entries(&model_entries))
}

#[command]
pub async fn list_copilot_vision_models(
    host: Option<String>,
    enterprise_type: Option<String>,
) -> Result<Vec<String>, String> {
    let github_token = load_copilot_token()?;
    let client = Client::new();
    let normalized_host = normalize_copilot_auth_host(host);
    let exchange_url = copilot_exchange_url(&normalized_host, enterprise_type.as_deref());
    let token_info = match resolve_copilot_token(&client, &github_token, &exchange_url).await {
        Ok(info) => info,
        Err(error) => {
            if error_is_forbidden(&error) {
                if let Some(entries) =
                    load_cached_models_with_endpoints(&normalized_host, "token exchange forbidden").await
                {
                    return Ok(vision_models_from_entries(&entries));
                }
            }
            return Err(error);
        }
    };
    let copilot_token = &token_info.token;
    
    // Select models endpoint based on plan type
    let models_urls = match token_info.plan_type {
        CopilotPlanType::Individual => CopilotModelsUrls {
            primary: COPILOT_MODELS_INDIVIDUAL_URL.to_string(),
            fallback: Some(COPILOT_MODELS_PROXY_URL.to_string()),
            legacy: None,
        },
        CopilotPlanType::Business => CopilotModelsUrls {
            primary: COPILOT_MODELS_BUSINESS_URL.to_string(),
            fallback: Some(COPILOT_MODELS_URL.to_string()),
            legacy: None,
        },
        CopilotPlanType::Enterprise => copilot_models_urls(&normalized_host),
    };

    let (mut response, mut is_json) =
        fetch_copilot_models_response(&client, &copilot_token, &models_urls.primary).await?;

    if (!response.status().is_success() || !is_json) && models_urls.fallback.is_some() {
        if let Some(fallback_url) = models_urls.fallback.as_deref() {
            let (fallback_response, fallback_is_json) =
                fetch_copilot_models_response(&client, &copilot_token, fallback_url).await?;
            response = fallback_response;
            is_json = fallback_is_json;
        }
    }

    if (!response.status().is_success() || !is_json) && models_urls.legacy.is_some() {
        if let Some(legacy_url) = models_urls.legacy.as_deref() {
            let (legacy_response, legacy_is_json) =
                fetch_copilot_models_response(&client, &copilot_token, legacy_url).await?;
            response = legacy_response;
            is_json = legacy_is_json;
        }
    }

    if !response.status().is_success() {
        if response.status() == StatusCode::FORBIDDEN {
            if let Some(entries) =
                load_cached_models_with_endpoints(&normalized_host, "models request forbidden").await
            {
                return Ok(vision_models_from_entries(&entries));
            }
        }
        let status = response.status();
        let error_text = truncate_error_body(response.text().await.unwrap_or_default());
        return Err(format!(
            "Copilot models request failed (status {}): {}",
            status,
            error_text
        ));
    }

    if !is_json {
        let status = response.status();
        let error_text = truncate_error_body(response.text().await.unwrap_or_default());
        return Err(format!(
            "Copilot models response was not JSON (status {}): {}",
            status,
            error_text
        ));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Copilot models: {}", e))?;

    let model_entries = extract_models_from_data(&data);

    update_model_endpoints_cache(&model_entries).await;
    if let Err(error) = cache_copilot_models(&normalized_host, &model_entries) {
        println!("[copilot][models] Failed to cache models: {}", error);
    }

    let mut vision_models = vision_models_from_entries(&model_entries);
    
    // Add Claude vision models
    for model in ["claude-opus-4.5", "claude-sonnet-4.6", "claude-sonnet-4", "claude-haiku-4.5", "claude-opus-4.6", "claude-opus-4"] {
        if !vision_models.contains(&model.to_string()) {
            vision_models.push(model.to_string());
        }
    }
    
    println!("[ai.rs] Vision-capable models: {:?}", vision_models);
    Ok(vision_models)
}

/// Determine which endpoint to use for a model
async fn get_model_endpoint(model: &str) -> &'static str {
    let endpoints_cache = MODEL_ENDPOINTS.read().await;
    if let Some(endpoints) = endpoints_cache.get(model) {
        // Check supported endpoints in priority order:
        // 1. /v1/messages - Anthropic Messages API (for Claude models)
        // 2. /chat/completions - OpenAI Chat Completions API (for GPT models)
        // 3. /responses - OpenAI Responses API
        if endpoints.iter().any(|e| e == "/v1/messages") && !endpoints.iter().any(|e| e == "/responses") {
            "/v1/messages"
        } else if endpoints.iter().any(|e| e == "/chat/completions") {
            "/chat/completions"
        } else if endpoints.iter().any(|e| e == "/responses") {
            "/responses"
        } else {
            "/chat/completions" // fallback
        }
    } else {
        // For unknown models, check if it's a Claude model
        if model.to_lowercase().contains("claude") {
            "/v1/messages"
        } else {
            "/chat/completions" // default for GPT models
        }
    }
}

/// Find a fallback model that supports /chat/completions for agent mode tasks
async fn find_agent_fallback_model() -> String {
    let endpoints_cache = MODEL_ENDPOINTS.read().await;
    
    // Priority order for agent mode fallback models
    let preferred_models = [
        "claude-sonnet-4",
        "claude-sonnet-4.5",
        "gpt-4.1",
        "gpt-4o",
        "gpt-4.5",
        "o3",
        "o3-mini",
    ];
    
    // First try preferred models
    for preferred in &preferred_models {
        for (model_name, endpoints) in endpoints_cache.iter() {
            if model_name.contains(preferred) && endpoints.iter().any(|e| e == "/chat/completions") {
                return model_name.clone();
            }
        }
    }
    
    // Otherwise return any model that supports /chat/completions
    for (model_name, endpoints) in endpoints_cache.iter() {
        if endpoints.iter().any(|e| e == "/chat/completions") {
            return model_name.clone();
        }
    }
    
    // Hardcoded fallback if cache is empty (this model is widely available)
    "gpt-4.1".to_string()
}

/// Convert ChatMessage to Responses API input format
fn convert_to_responses_input(messages: &[ChatMessage]) -> (Option<String>, ResponsesInputContent) {
    let mut instructions: Option<String> = None;
    let mut input_items: Vec<ResponsesInputItem> = Vec::new();
    
    for msg in messages {
        if msg.role == "system" {
            // System messages become instructions
            if instructions.is_none() {
                instructions = Some(msg.content.clone());
            } else {
                // Append to existing instructions
                if let Some(ref mut inst) = instructions {
                    inst.push_str("\n\n");
                    inst.push_str(&msg.content);
                }
            }
        } else {
            // User/assistant messages become input items
            let has_images = msg.attachments.as_ref()
                .map(|atts| atts.iter().any(|a| a.attachment_type == "image" && a.data.is_some()))
                .unwrap_or(false);
            
            if has_images {
                // Build content list with images and text
                let mut content_items: Vec<ResponsesContentItem> = Vec::new();
                
                if let Some(attachments) = &msg.attachments {
                    for att in attachments {
                        if att.attachment_type == "image" {
                            if let Some(data) = &att.data {
                                let mime_type = att.mime_type.as_deref().unwrap_or("image/png");
                                let image_url = if data.starts_with("data:") {
                                    data.clone()
                                } else {
                                    format!("data:{};base64,{}", mime_type, data)
                                };
                                content_items.push(ResponsesContentItem::InputImage {
                                    image_url,
                                    detail: Some("auto".to_string()),
                                });
                            }
                        }
                    }
                }
                
                // Add text content
                let text = if msg.content.is_empty() {
                    "What is in this image?".to_string()
                } else {
                    msg.content.clone()
                };
                content_items.push(ResponsesContentItem::InputText { text });
                
                input_items.push(ResponsesInputItem::Message {
                    role: msg.role.clone(),
                    content: ResponsesMessageContent::ContentList(content_items),
                });
            } else {
                // Text-only message
                input_items.push(ResponsesInputItem::Message {
                    role: msg.role.clone(),
                    content: ResponsesMessageContent::Text(msg.content.clone()),
                });
            }
        }
    }
    
    (instructions, ResponsesInputContent::Items(input_items))
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
        .header("X-GitHub-Api-Version", "2022-11-28")
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
        .header("X-GitHub-Api-Version", "2022-11-28")
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
    
    // Calculate prompt content for token usage tracking (before messages are consumed)
    let prompt_content: String = messages.iter().map(|m| m.content.as_str()).collect::<Vec<_>>().join(" ");
    let model_clone = model.clone();
    
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
    
    let mut cancel_active = true;
    loop {
        tokio::select! {
            // Check for cancellation
            cancel_result = cancel_rx.recv(), if cancel_active => {
                match cancel_result {
                    Ok(_) => {
                        println!("Stream cancelled for conversation: {}", conversation_id);
                        // Clean up
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        return Err("Stream cancelled by user".to_string());
                    }
                    Err(_) => {
                        // Sender was dropped; keep streaming but disable future cancel checks
                        println!("[ai.rs] Cancel channel closed; continuing stream.");
                        cancel_active = false;
                    }
                }
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
                                    // Emit token usage event
                                    emit_token_usage(&app, &model_clone, "ollama", &prompt_content, &full_content);
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
                        let event_name = format!("ai-stream-{}", conversation_id);
                        let _ = app.emit(&event_name, StreamChunk {
                            content: String::new(),
                            done: true,
                        });
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        break;
                    }
                }
            }
        }
    }
    
    // Emit token usage event
    emit_token_usage(&app, &model_clone, "ollama", &prompt_content, &full_content);
    
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
    
    // Calculate prompt content for token usage tracking (before messages are consumed)
    let prompt_content: String = messages.iter().map(|m| m.content.as_str()).collect::<Vec<_>>().join(" ");
    let model_clone = model.clone();
    
    // Determine provider based on base_url
    let provider = if base_url.contains("anthropic") {
        "anthropic"
    } else if base_url.contains("openai") {
        "openai"
    } else {
        "custom"
    };
    
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
    
    let mut cancel_active = true;
    loop {
        tokio::select! {
            // Check for cancellation
            cancel_result = cancel_rx.recv(), if cancel_active => {
                match cancel_result {
                    Ok(_) => {
                        println!("Stream cancelled for conversation: {}", conversation_id);
                        // Clean up
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        return Err("Stream cancelled by user".to_string());
                    }
                    Err(_) => {
                        println!("[ai.rs] Cancel channel closed; continuing stream.");
                        cancel_active = false;
                    }
                }
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
                                // Emit token usage event
                                emit_token_usage(&app, &model_clone, provider, &prompt_content, &full_content);
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
                        let event_name = format!("ai-stream-{}", conversation_id);
                        let _ = app.emit(&event_name, StreamChunk {
                            content: String::new(),
                            done: true,
                        });
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        break;
                    }
                }
            }
        }
    }
    
    // Emit token usage event
    emit_token_usage(&app, &model_clone, provider, &prompt_content, &full_content);
    
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
    agent_mode: Option<String>,
) -> Result<String, String> {
    let mode = agent_mode.as_deref().unwrap_or("chat");
    let is_agentic = mode == "agent" || mode == "plan";
    
    // Determine which endpoint to use based on model capabilities
    let endpoint = get_model_endpoint(&model).await;
    
    // For agentic tasks, ensure we use a model that supports /chat/completions
    // since /responses endpoint doesn't support tool calling well
    let (final_model, final_endpoint) = if is_agentic && endpoint == "/responses" {
        // Current model only supports /responses, need to find a fallback
        let fallback = find_agent_fallback_model().await;
        println!("[ai.rs] chat_copilot: Agent mode with {}, auto-routing to {} (supports /chat/completions)", model, fallback);
        (fallback, "/chat/completions")
    } else {
        (model, endpoint)
    };
    
    // Claude models use the Anthropic Messages API format (/v1/messages)
    // GPT models use OpenAI Chat Completions format (/chat/completions)
    let is_claude = final_model.to_lowercase().contains("claude");
    
    println!("[ai.rs] chat_copilot: model={}, mode={}, using endpoint={}, is_claude={}", 
             final_model, mode, final_endpoint, is_claude);
    
    if final_endpoint == "/responses" {
        chat_copilot_responses(app, final_model, messages, temperature, max_tokens, conversation_id).await
    } else if is_claude {
        // Claude models use Anthropic Messages API format
        chat_copilot_messages(app, final_model, messages, temperature, max_tokens, conversation_id).await
    } else {
        // GPT models use OpenAI Chat Completions format
        chat_copilot_chat_completions(app, final_model, messages, temperature, max_tokens, conversation_id).await
    }
}

/// Handle Copilot chat using the /v1/messages endpoint (Anthropic Messages API format for Claude models)
async fn chat_copilot_messages(
    app: AppHandle,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: Option<f32>,
    max_tokens: Option<i32>,
    conversation_id: String,
) -> Result<String, String> {
    let client = Client::new();
    let github_token = load_copilot_token()?;
    let token_info =
        resolve_copilot_token(&client, &github_token, COPILOT_EXCHANGE_URL).await?;
    let copilot_token = &token_info.token;
    let messages_url = match token_info.plan_type {
        CopilotPlanType::Individual => COPILOT_MESSAGES_INDIVIDUAL_URL,
        CopilotPlanType::Business => COPILOT_MESSAGES_BUSINESS_URL,
        CopilotPlanType::Enterprise => COPILOT_MESSAGES_URL,
    };
    println!("[copilot] Using Anthropic Messages URL: {}", messages_url);
    
    // Calculate prompt content for token usage tracking
    let prompt_content: String = messages.iter().map(|m| m.content.as_str()).collect::<Vec<_>>().join(" ");
    let model_clone = model.clone();
    
    // Create cancellation channel for this conversation
    let (cancel_tx, mut cancel_rx) = tokio::sync::broadcast::channel(1);

    // Store the cancellation sender
    {
        let mut streams = ACTIVE_STREAMS.write().await;
        streams.insert(conversation_id.clone(), cancel_tx);
    }

    // Convert messages to Anthropic Messages API format
    // Anthropic uses "user" and "assistant" roles, with "system" as a separate parameter
    let mut system_prompt: Option<String> = None;
    let mut anthropic_messages: Vec<serde_json::Value> = Vec::new();
    
    for msg in &messages {
        if msg.role == "system" {
            // Anthropic handles system as a separate parameter
            system_prompt = Some(msg.content.clone());
            continue;
        }
        
        let role = if msg.role == "user" { "user" } else { "assistant" };
        
        if let Some(attachments) = &msg.attachments {
            let image_attachments: Vec<_> = attachments
                .iter()
                .filter(|att| att.attachment_type == "image" && att.data.is_some())
                .collect();

            if !image_attachments.is_empty() {
                let mut content_blocks: Vec<serde_json::Value> = Vec::new();
                
                for att in &image_attachments {
                    if let Some(data) = &att.data {
                        let mime_type = att.mime_type.as_deref().unwrap_or("image/png");
                        // Strip data URL prefix if present
                        let base64_data = if data.starts_with("data:") {
                            data.split(',').nth(1).unwrap_or(data).to_string()
                        } else {
                            data.clone()
                        };
                        
                        content_blocks.push(serde_json::json!({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime_type,
                                "data": base64_data
                            }
                        }));
                    }
                }
                
                let text = if msg.content.is_empty() { "What is in this image?".to_string() } else { msg.content.clone() };
                content_blocks.push(serde_json::json!({
                    "type": "text",
                    "text": text
                }));
                
                anthropic_messages.push(serde_json::json!({
                    "role": role,
                    "content": content_blocks
                }));
            } else {
                anthropic_messages.push(serde_json::json!({
                    "role": role,
                    "content": msg.content.clone()
                }));
            }
        } else {
            anthropic_messages.push(serde_json::json!({
                "role": role,
                "content": msg.content.clone()
            }));
        }
    }

    // Build request body - Anthropic Messages API format
    let mut request_body = serde_json::json!({
        "model": model,
        "messages": anthropic_messages,
        "max_tokens": max_tokens.unwrap_or(4096),
        "stream": true
    });
    
    if let Some(temp) = temperature {
        request_body["temperature"] = serde_json::json!(temp);
    }
    if let Some(system) = system_prompt {
        request_body["system"] = serde_json::json!(system);
    }

    let has_vision = messages.iter().any(|m| {
        m.attachments.as_ref().map_or(false, |atts| {
            atts.iter().any(|a| a.attachment_type == "image" && a.data.is_some())
        })
    });
    
    // Log the full request body for debugging
    println!("[ai.rs] Sending Copilot /v1/messages request: model={}, messages={}, has_vision={}", 
             model, anthropic_messages.len(), has_vision);
    println!("[ai.rs] Request body: {}", serde_json::to_string_pretty(&request_body).unwrap_or_default());

    // Generate a request ID like IntelliJ does
    let request_id = uuid::Uuid::new_v4().to_string();
    
    // Use headers matching the integration ID used during token exchange
    // The bearer token is tied to the integration ID - must match!
    let mut req_builder = client
        .post(messages_url)
        .header("Authorization", format!("Bearer {}", copilot_token))
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .header("User-Agent", COPILOT_USER_AGENT)
        .header("Editor-Version", COPILOT_EDITOR_VERSION)
        .header("Editor-Plugin-Version", COPILOT_PLUGIN_VERSION)
        .header("Copilot-Integration-Id", COPILOT_INTEGRATION_ID)
        .header("X-Request-Id", &request_id);

    if has_vision {
        req_builder = req_builder.header("Copilot-Vision-Request", "true");
    }

    let response = req_builder
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        println!("[ai.rs] Messages API error: status={}, body={}", status, error_text);
        return Err(format!("Copilot error (Messages API): {}", error_text));
    }
    println!("[ai.rs] Messages API response status: {}", status);

    let mut stream = response.bytes_stream();
    let mut full_content = String::new();
    let mut line_buffer = String::new();

    let mut cancel_active = true;
    loop {
        tokio::select! {
            cancel_result = cancel_rx.recv(), if cancel_active => {
                match cancel_result {
                    Ok(_) => {
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        return Err("Stream cancelled by user".to_string());
                    }
                    Err(_) => {
                        cancel_active = false;
                    }
                }
            }
            chunk_result = stream.next() => {
                match chunk_result {
                    Some(Ok(chunk)) => {
                        line_buffer.push_str(&String::from_utf8_lossy(&chunk));
                        
                        // Process complete lines from buffer
                        while let Some(newline_pos) = line_buffer.find('\n') {
                            let line = line_buffer[..newline_pos].trim().to_string();
                            line_buffer = line_buffer[newline_pos + 1..].to_string();
                            
                            if line.is_empty() {
                                continue;
                            }
                            
                            // Anthropic SSE format: "event: xxx" followed by "data: {...}"
                            if line.starts_with("event:") {
                                // Event type line - we'll process the data on the next line
                                continue;
                            }
                            
                            if !line.starts_with("data: ") {
                                continue;
                            }

                            let json_str = &line[6..];
                            
                            if let Ok(data) = serde_json::from_str::<serde_json::Value>(json_str) {
                                let event_type = data["type"].as_str().unwrap_or("");
                                
                                match event_type {
                                    "content_block_delta" => {
                                        // Text delta: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "..."}}
                                        if let Some(text) = data["delta"]["text"].as_str() {
                                            full_content.push_str(text);
                                            let _ = app.emit(&format!("ai-stream-{}", conversation_id), StreamChunk {
                                                content: text.to_string(),
                                                done: false,
                                            });
                                        }
                                    }
                                    "message_stop" => {
                                        // End of message
                                        let _ = app.emit(&format!("ai-stream-{}", conversation_id), StreamChunk {
                                            content: String::new(),
                                            done: true,
                                        });
                                        emit_token_usage(&app, &model_clone, "copilot", &prompt_content, &full_content);
                                        let mut streams = ACTIVE_STREAMS.write().await;
                                        streams.remove(&conversation_id);
                                        return Ok(full_content);
                                    }
                                    "error" => {
                                        let error_msg = data["error"]["message"].as_str().unwrap_or("Unknown error");
                                        let mut streams = ACTIVE_STREAMS.write().await;
                                        streams.remove(&conversation_id);
                                        return Err(format!("Anthropic API error: {}", error_msg));
                                    }
                                    _ => {
                                        // Ignore other event types (message_start, content_block_start, etc.)
                                    }
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        println!("[ai.rs] chat_copilot_messages: Stream error for {}: {}", conversation_id, e);
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        return Err(format!("Stream error: {}", e));
                    }
                    None => {
                        println!("[ai.rs] chat_copilot_messages: Stream ended for conversation: {}", conversation_id);
                        let _ = app.emit(&format!("ai-stream-{}", conversation_id), StreamChunk {
                            content: String::new(),
                            done: true,
                        });
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        break;
                    }
                }
            }
        }
    }

    emit_token_usage(&app, &model_clone, "copilot", &prompt_content, &full_content);
    Ok(full_content)
}

/// Handle Copilot chat using the /chat/completions endpoint (traditional OpenAI format)
async fn chat_copilot_chat_completions(
    app: AppHandle,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: Option<f32>,
    max_tokens: Option<i32>,
    conversation_id: String,
) -> Result<String, String> {
    let client = Client::new();
    let github_token = load_copilot_token()?;
    let token_info =
        resolve_copilot_token(&client, &github_token, COPILOT_EXCHANGE_URL).await?;
    let copilot_token = &token_info.token;
    let chat_url = match token_info.plan_type {
        CopilotPlanType::Individual => COPILOT_CHAT_INDIVIDUAL_URL,
        CopilotPlanType::Business => COPILOT_CHAT_BUSINESS_URL,
        CopilotPlanType::Enterprise => COPILOT_CHAT_URL,
    };
    println!("[copilot] Using chat URL: {}", chat_url);
    
    // Calculate prompt content for token usage tracking (before messages are consumed)
    let prompt_content: String = messages.iter().map(|m| m.content.as_str()).collect::<Vec<_>>().join(" ");
    let model_clone = model.clone();
    
    // Create cancellation channel for this conversation
    let (cancel_tx, mut cancel_rx) = tokio::sync::broadcast::channel(1);

    // Store the cancellation sender
    {
        let mut streams = ACTIVE_STREAMS.write().await;
        streams.insert(conversation_id.clone(), cancel_tx);
    }

    // Convert messages to OpenAI format
    let mut openai_messages: Vec<OpenAIMessage> = Vec::new();
    
    for msg in messages {
        if let Some(attachments) = &msg.attachments {
            let image_attachments: Vec<_> = attachments
                .iter()
                .filter(|att| att.attachment_type == "image" && att.data.is_some())
                .collect();

            if !image_attachments.is_empty() {
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
                
                let text = if msg.content.is_empty() { "What is in this image?".to_string() } else { msg.content.clone() };
                blocks.push(ContentBlock::Text { text });
                
                openai_messages.push(OpenAIMessage {
                    role: msg.role.clone(),
                    content: MessageContent::ContentBlocks(blocks),
                });
            } else {
                openai_messages.push(OpenAIMessage {
                    role: msg.role,
                    content: MessageContent::Text(msg.content),
                });
            }
        } else {
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

    let has_vision = request.messages.iter().any(|m| matches!(&m.content, MessageContent::ContentBlocks(blocks) if blocks.iter().any(|b| matches!(b, ContentBlock::ImageUrl { .. }))));
    println!("[ai.rs] Sending Copilot /chat/completions request: model={}, messages={}, has_vision={}", request.model, request.messages.len(), has_vision);

    // Generate a request ID for tracing
    let request_id = uuid::Uuid::new_v4().to_string();
    
    // Use headers that match IntelliJ Copilot plugin
    let mut req_builder = client
        .post(chat_url)
        .header("Authorization", format!("Bearer {}", copilot_token))
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .header("User-Agent", COPILOT_USER_AGENT)
        .header("Editor-Version", COPILOT_EDITOR_VERSION)
        .header("Editor-Plugin-Version", COPILOT_PLUGIN_VERSION)
        .header("Copilot-Integration-Id", COPILOT_INTEGRATION_ID)
        .header("OpenAI-Intent", "conversation-agent")
        .header("X-Request-Id", &request_id);

    if has_vision {
        req_builder = req_builder.header("Copilot-Vision-Request", "true");
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
    let mut line_buffer = String::new(); // Buffer for incomplete lines

    let mut cancel_active = true;
    loop {
        tokio::select! {
            cancel_result = cancel_rx.recv(), if cancel_active => {
                match cancel_result {
                    Ok(_) => {
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        return Err("Stream cancelled by user".to_string());
                    }
                    Err(_) => {
                        cancel_active = false;
                    }
                }
            }
            chunk_result = stream.next() => {
                match chunk_result {
                    Some(Ok(chunk)) => {
                        // Append chunk to buffer
                        line_buffer.push_str(&String::from_utf8_lossy(&chunk));
                        
                        // Process complete lines from buffer
                        while let Some(newline_pos) = line_buffer.find('\n') {
                            let line = line_buffer[..newline_pos].trim().to_string();
                            line_buffer = line_buffer[newline_pos + 1..].to_string();
                            
                            if line.is_empty() || !line.starts_with("data: ") {
                                continue;
                            }

                            let json_str = &line[6..];
                            if json_str == "[DONE]" {
                                let _ = app.emit(&format!("ai-stream-{}", conversation_id), StreamChunk {
                                    content: String::new(),
                                    done: true,
                                });
                                emit_token_usage(&app, &model_clone, "copilot", &prompt_content, &full_content);
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
                        println!("[ai.rs] chat_copilot_chat_completions: Stream error for {}: {}", conversation_id, e);
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        return Err(format!("Stream error: {}", e));
                    }
                    None => {
                        // Stream ended without [DONE] marker - this may indicate truncation
                        println!("[ai.rs] chat_copilot_chat_completions: Stream ended (None) for conversation: {}", conversation_id);
                        println!("[ai.rs] Final content length: {}, ends with: {:?}", 
                            full_content.len(),
                            full_content.chars().rev().take(50).collect::<String>().chars().rev().collect::<String>());
                        let _ = app.emit(&format!("ai-stream-{}", conversation_id), StreamChunk {
                            content: String::new(),
                            done: true,
                        });
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        break;
                    }
                }
            }
        }
    }

    emit_token_usage(&app, &model_clone, "copilot", &prompt_content, &full_content);
    Ok(full_content)
}

/// Handle Copilot chat using the /responses endpoint (newer OpenAI Responses API format)
async fn chat_copilot_responses(
    app: AppHandle,
    model: String,
    messages: Vec<ChatMessage>,
    _temperature: Option<f32>, // Not supported by Codex models
    max_tokens: Option<i32>,
    conversation_id: String,
) -> Result<String, String> {
    let client = Client::new();
    let github_token = load_copilot_token()?;
    let token_info =
        resolve_copilot_token(&client, &github_token, COPILOT_EXCHANGE_URL).await?;
    let copilot_token = &token_info.token;
    let responses_url = match token_info.plan_type {
        CopilotPlanType::Individual => COPILOT_RESPONSES_INDIVIDUAL_URL,
        CopilotPlanType::Business => COPILOT_RESPONSES_BUSINESS_URL,
        CopilotPlanType::Enterprise => COPILOT_RESPONSES_URL,
    };
    println!("[copilot] Using responses URL: {}", responses_url);
    
    let prompt_content: String = messages.iter().map(|m| m.content.as_str()).collect::<Vec<_>>().join(" ");
    let model_clone = model.clone();
    
    let (cancel_tx, mut cancel_rx) = tokio::sync::broadcast::channel(1);
    {
        let mut streams = ACTIVE_STREAMS.write().await;
        streams.insert(conversation_id.clone(), cancel_tx);
    }

    // Convert messages to Responses API format
    let (mut instructions, input) = convert_to_responses_input(&messages);
    
    // Prepend model identity to instructions so the model knows what it is
    let model_identity = format!("You are {}, an AI assistant by OpenAI accessed through GitHub Copilot. When asked about your identity, respond in plain text without markdown formatting.", model);
    instructions = Some(match instructions {
        Some(existing) => format!("{}\n\n{}", model_identity, existing),
        None => model_identity,
    });
    
    // Note: Codex models don't support temperature parameter
    let request = ResponsesApiRequest {
        model,
        instructions,
        input,
        temperature: None, // Not supported by Codex models
        max_output_tokens: max_tokens,
        stream: true,
        store: false, // Don't store responses on server
    };

    println!("[ai.rs] Sending Copilot /responses request: model={}", request.model);
    if let Ok(json_str) = serde_json::to_string(&request) {
        let truncated = if json_str.len() > 500 { format!("{}...[truncated, total={}]", &json_str[..500], json_str.len()) } else { json_str };
        println!("[ai.rs] Request JSON: {}", truncated);
    }

    let response = client
        .post(responses_url)
        .header("Authorization", format!("Bearer {}", copilot_token))
        .header("Content-Type", "application/json")
        .header("User-Agent", COPILOT_USER_AGENT)
        .header("Editor-Version", COPILOT_EDITOR_VERSION)
        .header("Editor-Plugin-Version", COPILOT_PLUGIN_VERSION)
        .header("Copilot-Integration-Id", COPILOT_INTEGRATION_ID)
        .header("OpenAI-Intent", "conversation-panel")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Copilot /responses error: {}", error_text));
    }

    let mut stream = response.bytes_stream();
    let mut full_content = String::new();
    let mut buffer = String::new();

    let mut cancel_active = true;
    loop {
        tokio::select! {
            cancel_result = cancel_rx.recv(), if cancel_active => {
                match cancel_result {
                    Ok(_) => {
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        return Err("Stream cancelled by user".to_string());
                    }
                    Err(_) => {
                        cancel_active = false;
                    }
                }
            }
            chunk_result = stream.next() => {
                match chunk_result {
                    Some(Ok(chunk)) => {
                        buffer.push_str(&String::from_utf8_lossy(&chunk));
                        
                        // Process complete lines from buffer
                        while let Some(newline_pos) = buffer.find('\n') {
                            let line = buffer[..newline_pos].to_string();
                            buffer = buffer[newline_pos + 1..].to_string();
                            
                            if line.is_empty() || !line.starts_with("data: ") {
                                continue;
                            }

                            let json_str = &line[6..];
                            if json_str == "[DONE]" {
                                let _ = app.emit(&format!("ai-stream-{}", conversation_id), StreamChunk {
                                    content: String::new(),
                                    done: true,
                                });
                                emit_token_usage(&app, &model_clone, "copilot", &prompt_content, &full_content);
                                let mut streams = ACTIVE_STREAMS.write().await;
                                streams.remove(&conversation_id);
                                return Ok(full_content);
                            }

                            // Parse Responses API streaming format
                            if let Ok(data) = serde_json::from_str::<serde_json::Value>(json_str) {
                                // Responses API uses different event types
                                // Look for output_text delta events
                                let event_type = data.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                
                                // Handle different event types
                                if event_type == "response.output_text.delta" {
                                    if let Some(delta) = data.get("delta").and_then(|d| d.as_str()) {
                                        full_content.push_str(delta);
                                        let _ = app.emit(&format!("ai-stream-{}", conversation_id), StreamChunk {
                                            content: delta.to_string(),
                                            done: false,
                                        });
                                    }
                                } else if event_type == "response.output_text.done" || event_type == "response.done" {
                                    // Stream complete
                                    let _ = app.emit(&format!("ai-stream-{}", conversation_id), StreamChunk {
                                        content: String::new(),
                                        done: true,
                                    });
                                    emit_token_usage(&app, &model_clone, "copilot", &prompt_content, &full_content);
                                    let mut streams = ACTIVE_STREAMS.write().await;
                                    streams.remove(&conversation_id);
                                    return Ok(full_content);
                                } else if event_type.starts_with("response.content_part") {
                                    // Handle content part deltas (alternative format)
                                    if let Some(delta) = data.get("delta").and_then(|d| d.get("text")).and_then(|t| t.as_str()) {
                                        full_content.push_str(delta);
                                        let _ = app.emit(&format!("ai-stream-{}", conversation_id), StreamChunk {
                                            content: delta.to_string(),
                                            done: false,
                                        });
                                    }
                                }
                                // Also try the output array format for non-streaming portions
                                else if let Some(output) = data.get("output") {
                                    if let Some(items) = output.as_array() {
                                        for item in items {
                                            if item.get("type").and_then(|t| t.as_str()) == Some("message") {
                                                if let Some(content_arr) = item.get("content").and_then(|c| c.as_array()) {
                                                    for content_item in content_arr {
                                                        if content_item.get("type").and_then(|t| t.as_str()) == Some("output_text") {
                                                            if let Some(text) = content_item.get("text").and_then(|t| t.as_str()) {
                                                                if !text.is_empty() && !full_content.contains(text) {
                                                                    full_content.push_str(text);
                                                                    let _ = app.emit(&format!("ai-stream-{}", conversation_id), StreamChunk {
                                                                        content: text.to_string(),
                                                                        done: false,
                                                                    });
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
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
                        let _ = app.emit(&format!("ai-stream-{}", conversation_id), StreamChunk {
                            content: String::new(),
                            done: true,
                        });
                        let mut streams = ACTIVE_STREAMS.write().await;
                        streams.remove(&conversation_id);
                        break;
                    }
                }
            }
        }
    }

    emit_token_usage(&app, &model_clone, "copilot", &prompt_content, &full_content);
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

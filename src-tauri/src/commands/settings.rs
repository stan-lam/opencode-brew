use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AISettings {
    #[serde(rename = "aiProvider")]
    pub ai_provider: String,
    pub model: String,
    #[serde(rename = "ollamaUrl")]
    pub ollama_url: String,
    #[serde(rename = "openaiKey")]
    pub openai_key: String,
    #[serde(rename = "anthropicKey")]
    pub anthropic_key: String,
    #[serde(rename = "copilotClientId")]
    #[serde(default)]
    pub copilot_client_id: String,
    #[serde(rename = "copilotClientSecret")]
    #[serde(default)]
    pub copilot_client_secret: String,
    #[serde(rename = "copilotAuthHost")]
    #[serde(default)]
    pub copilot_auth_host: String,
    #[serde(rename = "copilotAuthMode")]
    #[serde(default)]
    pub copilot_auth_mode: String,
    #[serde(rename = "copilotEnterpriseType")]
    #[serde(default)]
    pub copilot_enterprise_type: String,
    #[serde(rename = "customBaseUrl")]
    pub custom_base_url: String,
    #[serde(rename = "customApiKey")]
    pub custom_api_key: String,
    pub temperature: f32,
    #[serde(rename = "maxTokens")]
    pub max_tokens: i32,
}

impl Default for AISettings {
    fn default() -> Self {
        Self {
            ai_provider: "ollama".to_string(),
            model: "llama3.2".to_string(),
            ollama_url: "http://localhost:11434".to_string(),
            openai_key: String::new(),
            anthropic_key: String::new(),
            copilot_client_id: String::new(),
            copilot_client_secret: String::new(),
            copilot_auth_host: "github.com".to_string(),
            copilot_auth_mode: "github".to_string(),
            copilot_enterprise_type: "ghes".to_string(),
            custom_base_url: String::new(),
            custom_api_key: String::new(),
            temperature: 0.7,
            max_tokens: 4096,
        }
    }
}

fn get_settings_path(app: &AppHandle) -> PathBuf {
    let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
    app_data_dir.join("ai-settings.json")
}

#[command]
pub async fn save_ai_settings(app: AppHandle, settings: AISettings) -> Result<(), String> {
    let path = get_settings_path(&app);
    
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    
    println!("[settings] Saved AI settings to {:?}", path);
    Ok(())
}

#[command]
pub async fn load_ai_settings(app: AppHandle) -> Result<AISettings, String> {
    let path = get_settings_path(&app);
    
    if !path.exists() {
        println!("[settings] No saved settings, using defaults");
        return Ok(AISettings::default());
    }
    
    let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let settings: AISettings = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    
    println!("[settings] Loaded AI settings: provider={}, model={}", settings.ai_provider, settings.model);
    Ok(settings)
}

pub fn get_ai_settings_sync(app: &AppHandle) -> AISettings {
    let path = get_settings_path(app);
    
    if !path.exists() {
        return AISettings::default();
    }
    
    match fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(_) => AISettings::default(),
    }
}

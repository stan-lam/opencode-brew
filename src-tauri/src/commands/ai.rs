use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter};
use std::sync::Arc;
use tokio::sync::RwLock;
use std::collections::HashMap;

// Global state for managing active streams
lazy_static::lazy_static! {
    static ref ACTIVE_STREAMS: Arc<RwLock<HashMap<String, tokio::sync::broadcast::Sender<()>>>> = 
        Arc::new(RwLock::new(HashMap::new()));
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
    url: String, // data:image/png;base64,... format
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
pub async fn chat_ollama(
    app: AppHandle,
    base_url: Option<String>,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: Option<f32>,
    max_tokens: Option<i32>,
    conversation_id: String,
) -> Result<String, String> {
    let url = base_url.unwrap_or_else(|| "http://localhost:11434".to_string());
    let client = Client::new();
    
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
                    .map(|att| att.data.clone().unwrap())
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
    
    let response = client
        .post(format!("{}/api/chat", url))
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Ollama error: {}", response.status()));
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
                            if line.is_empty() {
                                continue;
                            }
                            
                            if let Ok(response) = serde_json::from_str::<OllamaChatResponse>(line) {
                                if let Some(message) = response.message {
                                    full_content.push_str(&message.content);
                                    
                                    let _ = app.emit(&format!("ai-stream-{}", conversation_id), StreamChunk {
                                        content: message.content,
                                        done: response.done,
                                    });
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

#[command]
pub async fn chat_openai_compatible(
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
                                let data_url = format!("data:{};base64,{}", mime_type, data);
                                blocks.push(ContentBlock::ImageUrl {
                                    image_url: ImageUrl { url: data_url },
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
        max_tokens,
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

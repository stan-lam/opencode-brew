use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPServerConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPTool {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPToolResult {
    pub content: Vec<MCPContent>,
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: Option<String>,
}

struct MCPConnection {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    request_id: u64,
}

impl MCPConnection {
    async fn send_request(&mut self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
        self.request_id += 1;
        let request = json!({
            "jsonrpc": "2.0",
            "id": self.request_id,
            "method": method,
            "params": params
        });
        
        let request_str = serde_json::to_string(&request)
            .map_err(|e| format!("Failed to serialize request: {}", e))?;
        
        println!("[mcp] Sending: {}", request_str);
        
        self.stdin.write_all(request_str.as_bytes()).await
            .map_err(|e| format!("Failed to write to stdin: {}", e))?;
        self.stdin.write_all(b"\n").await
            .map_err(|e| format!("Failed to write newline: {}", e))?;
        self.stdin.flush().await
            .map_err(|e| format!("Failed to flush stdin: {}", e))?;
        
        let mut response_line = String::new();
        
        let read_result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            self.stdout.read_line(&mut response_line)
        ).await;
        
        match read_result {
            Ok(Ok(0)) => return Err("MCP server closed connection".to_string()),
            Ok(Ok(_)) => {},
            Ok(Err(e)) => return Err(format!("Failed to read response: {}", e)),
            Err(_) => return Err("Timeout waiting for MCP response".to_string()),
        }
        
        println!("[mcp] Received: {}", response_line.trim());
        
        if response_line.trim().is_empty() {
            return Err("Empty response from MCP server".to_string());
        }
        
        let response: serde_json::Value = serde_json::from_str(&response_line)
            .map_err(|e| format!("Failed to parse response '{}': {}", response_line.trim(), e))?;
        
        if let Some(error) = response.get("error") {
            return Err(format!("MCP error: {}", error));
        }
        
        Ok(response.get("result").cloned().unwrap_or(json!(null)))
    }
}

lazy_static::lazy_static! {
    static ref MCP_CONNECTIONS: Arc<Mutex<HashMap<String, MCPConnection>>> = 
        Arc::new(Mutex::new(HashMap::new()));
}

#[command]
pub async fn mcp_start_server(config: MCPServerConfig) -> Result<Vec<MCPTool>, String> {
    println!("[mcp] Starting server: {} ({})", config.name, config.command);
    
    let mut cmd = Command::new(&config.command);
    cmd.args(&config.args);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    
    for (key, value) in &config.env {
        cmd.env(key, value);
    }
    
    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to spawn MCP server: {}", e))?;
    
    let stdin = child.stdin.take()
        .ok_or("Failed to get stdin from child process")?;
    let stdout = child.stdout.take()
        .ok_or("Failed to get stdout from child process")?;
    let stderr = child.stderr.take();
    
    // Spawn a task to read stderr and log it
    if let Some(stderr) = stderr {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break,
                    Ok(_) => println!("[mcp stderr] {}", line.trim()),
                    Err(e) => {
                        println!("[mcp stderr error] {}", e);
                        break;
                    }
                }
            }
        });
    }
    
    let mut connection = MCPConnection {
        child,
        stdin: BufWriter::new(stdin),
        stdout: BufReader::new(stdout),
        request_id: 0,
    };
    
    println!("[mcp] Server spawned, sending initialize...");
    
    // Give the server a moment to start up
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    
    let init_result = connection.send_request("initialize", json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {
            "name": "OpenCodeBrew",
            "version": "0.1.0"
        }
    })).await.map_err(|e| {
        println!("[mcp] Initialize failed: {}", e);
        e
    })?;
    
    println!("[mcp] Initialize result: {:?}", init_result);
    
    let _ = connection.send_request("notifications/initialized", json!({})).await;
    
    let tools_result = connection.send_request("tools/list", json!({})).await?;
    
    let tools_array = tools_result.get("tools")
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();
    
    let mcp_tools: Vec<MCPTool> = tools_array
        .into_iter()
        .filter_map(|t| {
            Some(MCPTool {
                name: t.get("name")?.as_str()?.to_string(),
                description: t.get("description").and_then(|d| d.as_str()).map(|s| s.to_string()),
                input_schema: t.get("inputSchema").cloned(),
            })
        })
        .collect();
    
    println!("[mcp] Server {} started with {} tools", config.id, mcp_tools.len());
    
    let mut connections = MCP_CONNECTIONS.lock().await;
    connections.insert(config.id.clone(), connection);
    
    Ok(mcp_tools)
}

#[command]
pub async fn mcp_stop_server(server_id: String) -> Result<(), String> {
    println!("[mcp] Stopping server: {}", server_id);
    
    let mut connections = MCP_CONNECTIONS.lock().await;
    if let Some(mut connection) = connections.remove(&server_id) {
        let _ = connection.child.kill().await;
        println!("[mcp] Server {} stopped", server_id);
        Ok(())
    } else {
        Err(format!("Server {} not found", server_id))
    }
}

#[command]
pub async fn mcp_list_tools(server_id: String) -> Result<Vec<MCPTool>, String> {
    let mut connections = MCP_CONNECTIONS.lock().await;
    let connection = connections
        .get_mut(&server_id)
        .ok_or_else(|| format!("Server {} not connected", server_id))?;
    
    let tools_result = connection.send_request("tools/list", json!({})).await?;
    
    let tools_array = tools_result.get("tools")
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();
    
    let mcp_tools: Vec<MCPTool> = tools_array
        .into_iter()
        .filter_map(|t| {
            Some(MCPTool {
                name: t.get("name")?.as_str()?.to_string(),
                description: t.get("description").and_then(|d| d.as_str()).map(|s| s.to_string()),
                input_schema: t.get("inputSchema").cloned(),
            })
        })
        .collect();
    
    Ok(mcp_tools)
}

#[command]
pub async fn mcp_call_tool(
    server_id: String,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<MCPToolResult, String> {
    println!("[mcp] Calling tool {} on server {}", tool_name, server_id);
    
    let mut connections = MCP_CONNECTIONS.lock().await;
    let connection = connections
        .get_mut(&server_id)
        .ok_or_else(|| format!("Server {} not connected", server_id))?;
    
    let result = connection.send_request("tools/call", json!({
        "name": tool_name,
        "arguments": arguments
    })).await?;
    
    let content_array = result.get("content")
        .and_then(|c| c.as_array())
        .cloned()
        .unwrap_or_default();
    
    let content: Vec<MCPContent> = content_array
        .into_iter()
        .map(|c| {
            MCPContent {
                content_type: c.get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("text")
                    .to_string(),
                text: c.get("text")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string()),
            }
        })
        .collect();
    
    let is_error = result.get("isError")
        .and_then(|e| e.as_bool())
        .unwrap_or(false);
    
    println!("[mcp] Tool {} returned {} content items", tool_name, content.len());
    
    Ok(MCPToolResult {
        content,
        is_error,
    })
}

#[command]
pub async fn mcp_get_running_servers() -> Result<Vec<String>, String> {
    let connections = MCP_CONNECTIONS.lock().await;
    Ok(connections.keys().cloned().collect())
}

use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{command, Emitter, Manager, Window};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalOutput {
    pub terminal_id: String,
    pub data: String,
    pub target_window: String,
}

struct TerminalInstance {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    _reader_handle: tokio::task::JoinHandle<()>,
}

lazy_static::lazy_static! {
    static ref TERMINALS: Arc<Mutex<HashMap<String, TerminalInstance>>> = Arc::new(Mutex::new(HashMap::new()));
}

#[command]
pub async fn create_terminal(
    window: Window,
    terminal_id: String,
    cwd: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let window_label = window.label().to_string();
    let app = window.app_handle().clone();
    
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;
    
    let shell = if cfg!(windows) {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    };
    
    let mut cmd = CommandBuilder::new(&shell);
    
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    
    // Set environment variables for better terminal experience
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    
    let _child = pair.slave.spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;
    
    let mut reader = pair.master.try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;
    
    let writer = pair.master.take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;
    
    let terminal_id_clone = terminal_id.clone();
    let window_label_clone = window_label.clone();
    
    let reader_handle = tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    // Broadcast to all windows but include target_window for filtering
                    let _ = app.emit(&format!("terminal-output-{}", terminal_id_clone), TerminalOutput {
                        terminal_id: terminal_id_clone.clone(),
                        data,
                        target_window: window_label_clone.clone(),
                    });
                }
                Err(_) => break,
            }
        }
    });
    
    let instance = TerminalInstance {
        writer,
        master: pair.master,
        _reader_handle: reader_handle,
    };
    
    TERMINALS.lock().unwrap().insert(terminal_id, instance);
    
    Ok(())
}

#[command]
pub async fn write_terminal(terminal_id: String, data: String) -> Result<(), String> {
    let mut terminals = TERMINALS.lock().unwrap();
    
    if let Some(instance) = terminals.get_mut(&terminal_id) {
        instance.writer.write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to terminal: {}", e))?;
        instance.writer.flush()
            .map_err(|e| format!("Failed to flush terminal: {}", e))?;
        Ok(())
    } else {
        Err(format!("Terminal not found: {}", terminal_id))
    }
}

#[command]
pub async fn resize_terminal(terminal_id: String, rows: u16, cols: u16) -> Result<(), String> {
    let terminals = TERMINALS.lock().unwrap();
    
    if let Some(instance) = terminals.get(&terminal_id) {
        instance.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| format!("Failed to resize terminal: {}", e))?;
        Ok(())
    } else {
        Err(format!("Terminal not found: {}", terminal_id))
    }
}

#[command]
pub async fn close_terminal(terminal_id: String) -> Result<(), String> {
    let mut terminals = TERMINALS.lock().unwrap();
    terminals.remove(&terminal_id);
    Ok(())
}

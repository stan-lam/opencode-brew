use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::{command, Emitter, Manager, Window};
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher, Event, EventKind};
use lazy_static::lazy_static;

lazy_static! {
    static ref WATCHERS: Arc<Mutex<HashMap<String, RecommendedWatcher>>> = 
        Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileChangeEvent {
    pub kind: String,
    pub paths: Vec<String>,
    pub target_window: String,
}

fn event_to_file_change(event: &Event, target_window: String) -> FileChangeEvent {
    let kind = match event.kind {
        EventKind::Create(_) => "create",
        EventKind::Modify(_) => "modify",
        EventKind::Remove(_) => "remove",
        EventKind::Access(_) => "access",
        EventKind::Any => "any",
        EventKind::Other => "other",
    }.to_string();

    FileChangeEvent {
        kind,
        paths: event.paths.iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect(),
        target_window,
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_file: bool,
    pub size: Option<u64>,
    pub modified: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub is_directory: bool,
    pub is_file: bool,
    pub size: u64,
    pub modified: String,
    pub created: String,
}

#[command]
pub async fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(&path);
    
    if !dir_path.exists() {
        return Err(format!("Directory does not exist: {}", path));
    }
    
    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }
    
    let mut entries = Vec::new();
    
    match fs::read_dir(dir_path) {
        Ok(read_dir) => {
            for entry in read_dir.flatten() {
                let entry_path = entry.path();
                let metadata = entry.metadata().ok();
                
                let file_entry = FileEntry {
                    name: entry.file_name().to_string_lossy().to_string(),
                    path: entry_path.to_string_lossy().to_string(),
                    is_directory: entry_path.is_dir(),
                    is_file: entry_path.is_file(),
                    size: metadata.as_ref().map(|m| m.len()),
                    modified: metadata.as_ref().and_then(|m| {
                        m.modified().ok().map(|t| {
                            chrono::DateTime::<chrono::Utc>::from(t)
                                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                                .to_string()
                        })
                    }),
                };
                entries.push(file_entry);
            }
            Ok(entries)
        }
        Err(e) => Err(format!("Failed to read directory: {}", e)),
    }
}

#[command]
pub async fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))
}

#[command]
pub async fn create_file(path: String) -> Result<(), String> {
    fs::write(&path, "").map_err(|e| format!("Failed to create file: {}", e))
}

#[command]
pub async fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create directory: {}", e))
}

#[command]
pub async fn delete_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete directory: {}", e))
    } else {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))
    }
}

#[command]
pub async fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path).map_err(|e| format!("Failed to rename: {}", e))
}

#[command]
pub async fn get_file_info(path: String) -> Result<FileInfo, String> {
    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to get file info: {}", e))?;
    
    let modified = metadata
        .modified()
        .map(|t| {
            chrono::DateTime::<chrono::Utc>::from(t)
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string()
        })
        .unwrap_or_default();
    
    let created = metadata
        .created()
        .map(|t| {
            chrono::DateTime::<chrono::Utc>::from(t)
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string()
        })
        .unwrap_or_default();
    
    Ok(FileInfo {
        is_directory: metadata.is_dir(),
        is_file: metadata.is_file(),
        size: metadata.len(),
        modified,
        created,
    })
}

#[command]
pub async fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[command]
pub async fn watch_directory(window: Window, path: String) -> Result<(), String> {
    let path_clone = path.clone();
    let window_label = window.label().to_string();
    let app = window.app_handle().clone();
    
    // Check if already watching this path
    {
        let watchers = WATCHERS.lock().map_err(|e| e.to_string())?;
        if watchers.contains_key(&path) {
            return Ok(()); // Already watching
        }
    }
    
    let (tx, rx) = std::sync::mpsc::channel();
    
    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        Config::default().with_poll_interval(std::time::Duration::from_secs(2)),
    ).map_err(|e| format!("Failed to create watcher: {}", e))?;
    
    watcher.watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {}", e))?;
    
    // Store the watcher
    {
        let mut watchers = WATCHERS.lock().map_err(|e| e.to_string())?;
        watchers.insert(path.clone(), watcher);
    }
    
    // Spawn a thread to listen for events and broadcast them with target_window
    std::thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            // Skip access events as they're noisy
            if matches!(event.kind, EventKind::Access(_)) {
                continue;
            }
            
            let change_event = event_to_file_change(&event, window_label.clone());
            // Broadcast to all windows with target_window for filtering
            let _ = app.emit("fs-change", change_event);
        }
    });
    
    log::info!("Started watching directory: {}", path_clone);
    Ok(())
}

#[command]
pub async fn unwatch_directory(path: String) -> Result<(), String> {
    let mut watchers = WATCHERS.lock().map_err(|e| e.to_string())?;
    
    if watchers.remove(&path).is_some() {
        log::info!("Stopped watching directory: {}", path);
        Ok(())
    } else {
        Err(format!("Directory not being watched: {}", path))
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchMatch {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub text: String,
    pub match_text: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub use_regex: bool,
}

#[command]
pub async fn search_in_files(
    directory: String,
    query: String,
    options: SearchOptions,
) -> Result<Vec<SearchMatch>, String> {
    use regex::RegexBuilder;
    use walkdir::WalkDir;

    let mut results = Vec::new();
    
    if query.is_empty() {
        return Ok(results);
    }

    let pattern = if options.use_regex {
        query.clone()
    } else {
        let escaped = regex::escape(&query);
        if options.whole_word {
            format!(r"\b{}\b", escaped)
        } else {
            escaped
        }
    };

    let regex = RegexBuilder::new(&pattern)
        .case_insensitive(!options.case_sensitive)
        .build()
        .map_err(|e| format!("Invalid regex pattern: {}", e))?;

    let skip_dirs = [
        "node_modules", ".git", "target", "dist", "build", 
        ".next", ".nuxt", "__pycache__", ".venv", "venv",
        ".idea", ".vscode", ".openide"
    ];

    let skip_extensions = [
        "png", "jpg", "jpeg", "gif", "ico", "svg", "webp",
        "woff", "woff2", "ttf", "eot", "otf",
        "mp3", "mp4", "avi", "mov", "webm",
        "zip", "tar", "gz", "rar", "7z",
        "pdf", "doc", "docx", "xls", "xlsx",
        "exe", "dll", "so", "dylib", "bin",
        "lock", "sum"
    ];

    for entry in WalkDir::new(&directory)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !skip_dirs.iter().any(|d| name == *d)
        })
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        
        if !path.is_file() {
            continue;
        }

        if let Some(ext) = path.extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            if skip_extensions.contains(&ext_str.as_str()) {
                continue;
            }
        }

        if let Ok(content) = fs::read_to_string(path) {
            for (line_num, line) in content.lines().enumerate() {
                for mat in regex.find_iter(line) {
                    let context_start = mat.start().saturating_sub(50);
                    let context_end = (mat.end() + 50).min(line.len());
                    let text = line[context_start..context_end].to_string();
                    
                    results.push(SearchMatch {
                        file: path.to_string_lossy().to_string(),
                        line: (line_num + 1) as u32,
                        column: (mat.start() + 1) as u32,
                        text,
                        match_text: mat.as_str().to_string(),
                    });

                    if results.len() >= 1000 {
                        return Ok(results);
                    }
                }
            }
        }
    }

    Ok(results)
}

#[command]
pub async fn replace_in_file(
    path: String,
    search: String,
    replace: String,
    options: SearchOptions,
) -> Result<u32, String> {
    use regex::RegexBuilder;
    
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let pattern = if options.use_regex {
        search.clone()
    } else {
        let escaped = regex::escape(&search);
        if options.whole_word {
            format!(r"\b{}\b", escaped)
        } else {
            escaped
        }
    };

    let regex = RegexBuilder::new(&pattern)
        .case_insensitive(!options.case_sensitive)
        .build()
        .map_err(|e| format!("Invalid regex pattern: {}", e))?;

    let count = regex.find_iter(&content).count() as u32;
    let new_content = regex.replace_all(&content, replace.as_str()).to_string();

    fs::write(&path, new_content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(count)
}

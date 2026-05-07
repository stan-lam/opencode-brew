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
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub workspace_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub workspace_id: String,
    pub folder_id: Option<String>,
    pub title: String,
    pub pinned: bool,
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
    pub context_summary: Option<String>,
    pub summary_updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub attachments: Option<String>, // JSON string
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationTag {
    pub conversation_id: String,
    pub tag_id: String,
}

// ============= Database Connection =============

lazy_static::lazy_static! {
    static ref NOTES_DB: Arc<Mutex<Option<Connection>>> = Arc::new(Mutex::new(None));
}

fn get_notes_db_path(app: &AppHandle) -> PathBuf {
    let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
    app_data_dir.join("notes.db")
}

async fn get_connection(app: &AppHandle) -> Result<Connection, String> {
    let db_path = get_notes_db_path(app);
    
    // Ensure directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    Connection::open(&db_path).map_err(|e| e.to_string())
}

// ============= Database Initialization =============

#[command]
pub async fn init_notes_db(app: AppHandle) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        
        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            parent_id TEXT,
            name TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
        );
        
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            folder_id TEXT,
            title TEXT NOT NULL,
            pinned INTEGER DEFAULT 0,
            archived INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
            FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
        );
        
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            attachments TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );
        
        CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        
        CREATE TABLE IF NOT EXISTS conversation_tags (
            conversation_id TEXT NOT NULL,
            tag_id TEXT NOT NULL,
            PRIMARY KEY (conversation_id, tag_id),
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );
        
        CREATE INDEX IF NOT EXISTS idx_folders_workspace ON folders(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_conversations_folder ON conversations(folder_id);
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_tags_workspace ON tags(workspace_id);
        "#,
    )
    .map_err(|e| e.to_string())?;
    
    // Migration: Add context_summary columns if they don't exist
    let has_context_summary: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('conversations') WHERE name='context_summary'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .map(|count| count > 0)
        .unwrap_or(false);
    
    if !has_context_summary {
        println!("[notes] Migrating: Adding context_summary columns to conversations table");
        conn.execute("ALTER TABLE conversations ADD COLUMN context_summary TEXT", [])
            .map_err(|e| format!("Migration failed: {}", e))?;
        conn.execute("ALTER TABLE conversations ADD COLUMN summary_updated_at TEXT", [])
            .map_err(|e| format!("Migration failed: {}", e))?;
    }
    
    // Create default workspace if none exists
    let count: i32 = conn
        .query_row("SELECT COUNT(*) FROM workspaces", [], |row| row.get(0))
        .unwrap_or(0);
    
    if count == 0 {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO workspaces (id, name, icon, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![Uuid::new_v4().to_string(), "Personal", "user", &now, &now],
        )
        .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

// ============= Workspace Commands =============

#[command]
pub async fn list_workspaces(app: AppHandle) -> Result<Vec<Workspace>, String> {
    let conn = get_connection(&app).await?;
    
    let mut stmt = conn
        .prepare("SELECT id, name, icon, created_at, updated_at FROM workspaces ORDER BY created_at")
        .map_err(|e| e.to_string())?;
    
    let workspaces = stmt
        .query_map([], |row| {
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                icon: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    
    Ok(workspaces)
}

#[command]
pub async fn create_workspace(app: AppHandle, name: String, icon: Option<String>) -> Result<Workspace, String> {
    let conn = get_connection(&app).await?;
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    
    conn.execute(
        "INSERT INTO workspaces (id, name, icon, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![&id, &name, &icon, &now, &now],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(Workspace {
        id,
        name,
        icon,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[command]
pub async fn update_workspace(app: AppHandle, id: String, name: String, icon: Option<String>) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    let now = Utc::now().to_rfc3339();
    
    conn.execute(
        "UPDATE workspaces SET name = ?1, icon = ?2, updated_at = ?3 WHERE id = ?4",
        params![&name, &icon, &now, &id],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[command]
pub async fn delete_workspace(app: AppHandle, id: String) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    
    conn.execute("DELETE FROM workspaces WHERE id = ?1", params![&id])
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

// ============= Folder Commands =============

#[command]
pub async fn list_folders(app: AppHandle, workspace_id: String) -> Result<Vec<Folder>, String> {
    let conn = get_connection(&app).await?;
    
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, parent_id, name, sort_order, created_at, updated_at 
             FROM folders WHERE workspace_id = ?1 ORDER BY sort_order, name"
        )
        .map_err(|e| e.to_string())?;
    
    let folders = stmt
        .query_map([&workspace_id], |row| {
            Ok(Folder {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                parent_id: row.get(2)?,
                name: row.get(3)?,
                sort_order: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    
    Ok(folders)
}

#[command]
pub async fn create_folder(
    app: AppHandle,
    workspace_id: String,
    name: String,
    parent_id: Option<String>,
) -> Result<Folder, String> {
    let conn = get_connection(&app).await?;
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    
    conn.execute(
        "INSERT INTO folders (id, workspace_id, parent_id, name, sort_order, created_at, updated_at) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![&id, &workspace_id, &parent_id, &name, 0, &now, &now],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(Folder {
        id,
        workspace_id,
        parent_id,
        name,
        sort_order: 0,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[command]
pub async fn update_folder(app: AppHandle, id: String, name: String, parent_id: Option<String>) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    let now = Utc::now().to_rfc3339();
    
    conn.execute(
        "UPDATE folders SET name = ?1, parent_id = ?2, updated_at = ?3 WHERE id = ?4",
        params![&name, &parent_id, &now, &id],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[command]
pub async fn delete_folder(app: AppHandle, id: String) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    
    conn.execute("DELETE FROM folders WHERE id = ?1", params![&id])
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

// ============= Conversation Commands =============

#[command]
pub async fn list_conversations(
    app: AppHandle,
    workspace_id: String,
    folder_id: Option<String>,
    archived: bool,
) -> Result<Vec<Conversation>, String> {
    let conn = get_connection(&app).await?;
    
    let sql = if folder_id.is_some() {
        "SELECT id, workspace_id, folder_id, title, pinned, archived, created_at, updated_at, context_summary, summary_updated_at 
         FROM conversations WHERE workspace_id = ?1 AND folder_id = ?2 AND archived = ?3
         ORDER BY pinned DESC, updated_at DESC"
    } else {
        "SELECT id, workspace_id, folder_id, title, pinned, archived, created_at, updated_at, context_summary, summary_updated_at 
         FROM conversations WHERE workspace_id = ?1 AND folder_id IS NULL AND archived = ?2
         ORDER BY pinned DESC, updated_at DESC"
    };
    
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    
    let conversations: Vec<Conversation> = if let Some(fid) = folder_id {
        stmt.query_map(params![&workspace_id, &fid, archived as i32], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                folder_id: row.get(2)?,
                title: row.get(3)?,
                pinned: row.get::<_, i32>(4)? != 0,
                archived: row.get::<_, i32>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                context_summary: row.get(8)?,
                summary_updated_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map(params![&workspace_id, archived as i32], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                folder_id: row.get(2)?,
                title: row.get(3)?,
                pinned: row.get::<_, i32>(4)? != 0,
                archived: row.get::<_, i32>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                context_summary: row.get(8)?,
                summary_updated_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    };
    
    Ok(conversations)
}

#[command]
pub async fn create_conversation(
    app: AppHandle,
    workspace_id: String,
    title: String,
    folder_id: Option<String>,
) -> Result<Conversation, String> {
    let conn = get_connection(&app).await?;
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    
    conn.execute(
        "INSERT INTO conversations (id, workspace_id, folder_id, title, pinned, archived, created_at, updated_at) 
         VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?6)",
        params![&id, &workspace_id, &folder_id, &title, &now, &now],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(Conversation {
        id,
        workspace_id,
        folder_id,
        title,
        pinned: false,
        archived: false,
        created_at: now.clone(),
        updated_at: now,
        context_summary: None,
        summary_updated_at: None,
    })
}

#[command]
pub async fn update_conversation(
    app: AppHandle,
    id: String,
    title: Option<String>,
    folder_id: Option<Option<String>>,
    pinned: Option<bool>,
    archived: Option<bool>,
) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    let now = Utc::now().to_rfc3339();
    
    // Get current values
    let current: (String, Option<String>, i32, i32) = conn
        .query_row(
            "SELECT title, folder_id, pinned, archived FROM conversations WHERE id = ?1",
            [&id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| e.to_string())?;
    
    let new_title = title.unwrap_or(current.0);
    let new_folder_id = folder_id.unwrap_or(current.1);
    let new_pinned = pinned.map(|b| b as i32).unwrap_or(current.2);
    let new_archived = archived.map(|b| b as i32).unwrap_or(current.3);
    
    conn.execute(
        "UPDATE conversations SET title = ?1, folder_id = ?2, pinned = ?3, archived = ?4, updated_at = ?5 WHERE id = ?6",
        params![&new_title, &new_folder_id, new_pinned, new_archived, &now, &id],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[command]
pub async fn delete_conversation(app: AppHandle, id: String) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    
    conn.execute("DELETE FROM conversations WHERE id = ?1", params![&id])
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[command]
pub async fn update_conversation_summary(
    app: AppHandle,
    id: String,
    context_summary: String,
) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    let now = Utc::now().to_rfc3339();
    
    conn.execute(
        "UPDATE conversations SET context_summary = ?1, summary_updated_at = ?2, updated_at = ?3 WHERE id = ?4",
        params![&context_summary, &now, &now, &id],
    )
    .map_err(|e| e.to_string())?;
    
    println!("[notes] Updated context summary for conversation {}", id);
    
    Ok(())
}

#[command]
pub async fn get_conversation_summary(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let conn = get_connection(&app).await?;
    
    let summary: Option<String> = conn
        .query_row(
            "SELECT context_summary FROM conversations WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    
    Ok(summary)
}

// ============= Message Commands =============

#[command]
pub async fn list_messages(app: AppHandle, conversation_id: String) -> Result<Vec<Message>, String> {
    let conn = get_connection(&app).await?;
    
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, role, content, attachments, created_at 
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at"
        )
        .map_err(|e| e.to_string())?;
    
    let messages = stmt
        .query_map([&conversation_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                attachments: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    
    Ok(messages)
}

#[command]
pub async fn add_message(
    app: AppHandle,
    conversation_id: String,
    role: String,
    content: String,
    attachments: Option<String>,
) -> Result<Message, String> {
    let conn = get_connection(&app).await?;
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, attachments, created_at) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![&id, &conversation_id, &role, &content, &attachments, &now],
    )
    .map_err(|e| e.to_string())?;
    
    // Update conversation's updated_at
    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![&now, &conversation_id],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(Message {
        id,
        conversation_id,
        role,
        content,
        attachments,
        created_at: now,
    })
}

#[command]
pub async fn update_message_content(
    app: AppHandle,
    message_id: String,
    content: String,
) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    
    conn.execute(
        "UPDATE messages SET content = ?1 WHERE id = ?2",
        params![&content, &message_id],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

// ============= Tag Commands =============

#[command]
pub async fn list_tags(app: AppHandle, workspace_id: String) -> Result<Vec<Tag>, String> {
    let conn = get_connection(&app).await?;
    
    let mut stmt = conn
        .prepare("SELECT id, workspace_id, name, color FROM tags WHERE workspace_id = ?1 ORDER BY name")
        .map_err(|e| e.to_string())?;
    
    let tags = stmt
        .query_map([&workspace_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                name: row.get(2)?,
                color: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    
    Ok(tags)
}

#[command]
pub async fn create_tag(app: AppHandle, workspace_id: String, name: String, color: String) -> Result<Tag, String> {
    let conn = get_connection(&app).await?;
    let id = Uuid::new_v4().to_string();
    
    conn.execute(
        "INSERT INTO tags (id, workspace_id, name, color) VALUES (?1, ?2, ?3, ?4)",
        params![&id, &workspace_id, &name, &color],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(Tag {
        id,
        workspace_id,
        name,
        color,
    })
}

#[command]
pub async fn delete_tag(app: AppHandle, id: String) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    
    conn.execute("DELETE FROM tags WHERE id = ?1", params![&id])
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[command]
pub async fn add_tag_to_conversation(app: AppHandle, conversation_id: String, tag_id: String) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    
    conn.execute(
        "INSERT OR IGNORE INTO conversation_tags (conversation_id, tag_id) VALUES (?1, ?2)",
        params![&conversation_id, &tag_id],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[command]
pub async fn remove_tag_from_conversation(app: AppHandle, conversation_id: String, tag_id: String) -> Result<(), String> {
    let conn = get_connection(&app).await?;
    
    conn.execute(
        "DELETE FROM conversation_tags WHERE conversation_id = ?1 AND tag_id = ?2",
        params![&conversation_id, &tag_id],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[command]
pub async fn get_conversation_tags(app: AppHandle, conversation_id: String) -> Result<Vec<Tag>, String> {
    let conn = get_connection(&app).await?;
    
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.workspace_id, t.name, t.color FROM tags t
             INNER JOIN conversation_tags ct ON t.id = ct.tag_id
             WHERE ct.conversation_id = ?1"
        )
        .map_err(|e| e.to_string())?;
    
    let tags = stmt
        .query_map([&conversation_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                name: row.get(2)?,
                color: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    
    Ok(tags)
}

// ============= Search =============

#[command]
pub async fn search_conversations(
    app: AppHandle,
    workspace_id: String,
    query: String,
) -> Result<Vec<Conversation>, String> {
    let conn = get_connection(&app).await?;
    
    let search_pattern = format!("%{}%", query);
    
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT c.id, c.workspace_id, c.folder_id, c.title, c.pinned, c.archived, c.created_at, c.updated_at, c.context_summary, c.summary_updated_at 
             FROM conversations c
             LEFT JOIN messages m ON c.id = m.conversation_id
             WHERE c.workspace_id = ?1 AND (c.title LIKE ?2 OR m.content LIKE ?2)
             ORDER BY c.updated_at DESC"
        )
        .map_err(|e| e.to_string())?;
    
    let conversations = stmt
        .query_map(params![&workspace_id, &search_pattern], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                folder_id: row.get(2)?,
                title: row.get(3)?,
                pinned: row.get::<_, i32>(4)? != 0,
                archived: row.get::<_, i32>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                context_summary: row.get(8)?,
                summary_updated_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    
    Ok(conversations)
}

// ============= Export =============

#[derive(Debug, Serialize)]
pub struct ExportedConversation {
    pub conversation: Conversation,
    pub messages: Vec<Message>,
    pub tags: Vec<Tag>,
}

#[command]
pub async fn export_conversation(app: AppHandle, conversation_id: String) -> Result<ExportedConversation, String> {
    let conn = get_connection(&app).await?;
    
    // Get conversation
    let conversation: Conversation = conn
        .query_row(
            "SELECT id, workspace_id, folder_id, title, pinned, archived, created_at, updated_at, context_summary, summary_updated_at 
             FROM conversations WHERE id = ?1",
            [&conversation_id],
            |row| {
                Ok(Conversation {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    folder_id: row.get(2)?,
                    title: row.get(3)?,
                    pinned: row.get::<_, i32>(4)? != 0,
                    archived: row.get::<_, i32>(5)? != 0,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                    context_summary: row.get(8)?,
                    summary_updated_at: row.get(9)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    
    // Get messages
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, role, content, attachments, created_at 
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at"
        )
        .map_err(|e| e.to_string())?;
    
    let messages: Vec<Message> = stmt
        .query_map([&conversation_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                attachments: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    
    // Get tags
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.workspace_id, t.name, t.color FROM tags t
             INNER JOIN conversation_tags ct ON t.id = ct.tag_id
             WHERE ct.conversation_id = ?1"
        )
        .map_err(|e| e.to_string())?;
    
    let tags: Vec<Tag> = stmt
        .query_map([&conversation_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                name: row.get(2)?,
                color: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    
    Ok(ExportedConversation {
        conversation,
        messages,
        tags,
    })
}

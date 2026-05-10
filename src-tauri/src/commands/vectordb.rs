use lancedb::connect;
use lancedb::query::ExecutableQuery;
use arrow_array::{RecordBatch, RecordBatchIterator, StringArray, Float32Array, ArrayRef};
use arrow_schema::{Schema, Field, DataType};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tauri::command;
use tokio::sync::RwLock;
use walkdir::WalkDir;

lazy_static::lazy_static! {
    static ref INDEX_CACHE: RwLock<HashMap<String, IndexState>> = RwLock::new(HashMap::new());
}

#[derive(Clone)]
struct IndexState {
    db_path: String,
    file_count: usize,
    last_indexed: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaEmbeddingRequest {
    model: String,
    input: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaEmbeddingResponse {
    embeddings: Vec<Vec<f32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeChunk {
    pub file_path: String,
    pub content: String,
    pub start_line: usize,
    pub end_line: usize,
    pub chunk_type: String, // "function", "class", "block", "file"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub file_path: String,
    pub content: String,
    pub start_line: usize,
    pub end_line: usize,
    pub chunk_type: String,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexStatus {
    pub is_indexed: bool,
    pub file_count: usize,
    pub last_indexed: Option<String>,
    pub db_path: String,
}

const EMBEDDING_MODEL: &str = "nomic-embed-text";
const EMBEDDING_DIM: usize = 768;
const CHUNK_SIZE: usize = 1500;
const CHUNK_OVERLAP: usize = 200;

fn get_db_path(workspace_path: &str) -> String {
    let hash = md5::compute(workspace_path);
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let db_dir = home.join(".opencodebrew").join("vector_indexes");
    std::fs::create_dir_all(&db_dir).ok();
    db_dir.join(format!("{:x}", hash)).to_string_lossy().to_string()
}

fn should_index_file(path: &Path) -> bool {
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let indexable = [
        "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "cpp", "c", "h", "hpp",
        "rb", "php", "swift", "kt", "scala", "cs", "vue", "svelte", "astro",
        "md", "mdx", "txt", "json", "yaml", "yml", "toml", "xml", "html", "css", "scss",
    ];
    
    if !indexable.contains(&extension) {
        return false;
    }
    
    let path_str = path.to_string_lossy();
    let ignore_patterns = [
        "node_modules", ".git", "target", "dist", "build", ".next", "__pycache__",
        ".venv", "venv", ".idea", ".vscode", "coverage", ".cache", "vendor",
        ".pnpm", ".yarn", "bower_components", ".turbo", ".nuxt", ".output",
    ];
    
    !ignore_patterns.iter().any(|p| path_str.contains(p))
}

fn chunk_content(content: &str, file_path: &str) -> Vec<CodeChunk> {
    let lines: Vec<&str> = content.lines().collect();
    let mut chunks = Vec::new();
    
    if lines.len() <= 50 {
        chunks.push(CodeChunk {
            file_path: file_path.to_string(),
            content: content.to_string(),
            start_line: 1,
            end_line: lines.len(),
            chunk_type: "file".to_string(),
        });
        return chunks;
    }
    
    let mut start = 0;
    while start < lines.len() {
        let end = (start + CHUNK_SIZE / 30).min(lines.len()); // ~30 chars per line estimate
        let chunk_lines = &lines[start..end];
        let chunk_content = chunk_lines.join("\n");
        
        if !chunk_content.trim().is_empty() {
            chunks.push(CodeChunk {
                file_path: file_path.to_string(),
                content: chunk_content,
                start_line: start + 1,
                end_line: end,
                chunk_type: "block".to_string(),
            });
        }
        
        start = if end >= lines.len() { lines.len() } else { end.saturating_sub(CHUNK_OVERLAP / 30) };
        if start >= end { break; }
    }
    
    chunks
}

async fn get_embeddings(texts: &[String], ollama_url: &str) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(vec![]);
    }
    
    let client = Client::new();
    let url = format!("{}/api/embed", ollama_url.trim_end_matches('/'));
    
    let request = OllamaEmbeddingRequest {
        model: EMBEDDING_MODEL.to_string(),
        input: texts.to_vec(),
    };
    
    let response = client
        .post(&url)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Ollama: {}. Make sure Ollama is running and {} model is installed (ollama pull {})", e, EMBEDDING_MODEL, EMBEDDING_MODEL))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama embedding failed ({}): {}. Try: ollama pull {}", status, body, EMBEDDING_MODEL));
    }
    
    let result: OllamaEmbeddingResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;
    
    Ok(result.embeddings)
}

#[command]
pub async fn index_workspace(workspace_path: String, ollama_url: Option<String>) -> Result<IndexStatus, String> {
    let ollama = ollama_url.unwrap_or_else(|| "http://localhost:11434".to_string());
    let db_path = get_db_path(&workspace_path);
    
    println!("[vectordb] Indexing workspace: {}", workspace_path);
    println!("[vectordb] DB path: {}", db_path);
    
    let mut all_chunks: Vec<CodeChunk> = Vec::new();
    let mut file_count = 0;
    
    for entry in WalkDir::new(&workspace_path)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() || !should_index_file(path) {
            continue;
        }
        
        if let Ok(content) = std::fs::read_to_string(path) {
            if content.len() > 500_000 {
                continue;
            }
            
            let relative_path = path.strip_prefix(&workspace_path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| path.to_string_lossy().to_string());
            
            let chunks = chunk_content(&content, &relative_path);
            all_chunks.extend(chunks);
            file_count += 1;
        }
    }
    
    println!("[vectordb] Found {} files, {} chunks", file_count, all_chunks.len());
    
    if all_chunks.is_empty() {
        return Ok(IndexStatus {
            is_indexed: false,
            file_count: 0,
            last_indexed: None,
            db_path,
        });
    }
    
    let batch_size = 32;
    let mut all_embeddings: Vec<Vec<f32>> = Vec::new();
    
    for (i, batch) in all_chunks.chunks(batch_size).enumerate() {
        println!("[vectordb] Embedding batch {}/{}", i + 1, (all_chunks.len() + batch_size - 1) / batch_size);
        
        let texts: Vec<String> = batch.iter().map(|c| {
            format!("File: {}\n{}", c.file_path, c.content)
        }).collect();
        
        let embeddings = get_embeddings(&texts, &ollama).await?;
        all_embeddings.extend(embeddings);
    }
    
    println!("[vectordb] Got {} embeddings", all_embeddings.len());
    
    if std::path::Path::new(&db_path).exists() {
        std::fs::remove_dir_all(&db_path).ok();
    }
    
    let db = connect(&db_path).execute().await
        .map_err(|e| format!("Failed to create LanceDB: {}", e))?;
    
    let schema = Arc::new(Schema::new(vec![
        Field::new("file_path", DataType::Utf8, false),
        Field::new("content", DataType::Utf8, false),
        Field::new("start_line", DataType::Utf8, false),
        Field::new("end_line", DataType::Utf8, false),
        Field::new("chunk_type", DataType::Utf8, false),
        Field::new("vector", DataType::FixedSizeList(
            Arc::new(Field::new("item", DataType::Float32, true)),
            EMBEDDING_DIM as i32,
        ), false),
    ]));
    
    let file_paths: Vec<&str> = all_chunks.iter().map(|c| c.file_path.as_str()).collect();
    let contents: Vec<&str> = all_chunks.iter().map(|c| c.content.as_str()).collect();
    let start_lines: Vec<String> = all_chunks.iter().map(|c| c.start_line.to_string()).collect();
    let end_lines: Vec<String> = all_chunks.iter().map(|c| c.end_line.to_string()).collect();
    let chunk_types: Vec<&str> = all_chunks.iter().map(|c| c.chunk_type.as_str()).collect();
    
    let vectors: Vec<Option<Vec<Option<f32>>>> = all_embeddings.iter()
        .map(|v| Some(v.iter().map(|&x| Some(x)).collect()))
        .collect();
    
    let file_path_array = Arc::new(StringArray::from(file_paths)) as ArrayRef;
    let content_array = Arc::new(StringArray::from(contents)) as ArrayRef;
    let start_line_array = Arc::new(StringArray::from(start_lines.iter().map(|s| s.as_str()).collect::<Vec<_>>())) as ArrayRef;
    let end_line_array = Arc::new(StringArray::from(end_lines.iter().map(|s| s.as_str()).collect::<Vec<_>>())) as ArrayRef;
    let chunk_type_array = Arc::new(StringArray::from(chunk_types)) as ArrayRef;
    
    let vector_field = Arc::new(Field::new("item", DataType::Float32, true));
    let vector_array = Arc::new(
        arrow_array::FixedSizeListArray::from_iter_primitive::<arrow_array::types::Float32Type, _, _>(
            vectors,
            EMBEDDING_DIM as i32,
        )
    ) as ArrayRef;
    
    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![file_path_array, content_array, start_line_array, end_line_array, chunk_type_array, vector_array],
    ).map_err(|e| format!("Failed to create record batch: {}", e))?;
    
    let batches = vec![batch];
    let batch_iter = RecordBatchIterator::new(batches.into_iter().map(Ok), schema);
    
    db.create_table("code_chunks", Box::new(batch_iter))
        .execute()
        .await
        .map_err(|e| format!("Failed to create table: {}", e))?;
    
    let now = chrono::Utc::now();
    
    {
        let mut cache = INDEX_CACHE.write().await;
        cache.insert(workspace_path.clone(), IndexState {
            db_path: db_path.clone(),
            file_count,
            last_indexed: now,
        });
    }
    
    println!("[vectordb] Indexing complete: {} files, {} chunks", file_count, all_chunks.len());
    
    Ok(IndexStatus {
        is_indexed: true,
        file_count,
        last_indexed: Some(now.to_rfc3339()),
        db_path,
    })
}

#[command]
pub async fn search_codebase(
    workspace_path: String,
    query: String,
    limit: Option<usize>,
    ollama_url: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    let ollama = ollama_url.unwrap_or_else(|| "http://localhost:11434".to_string());
    let db_path = get_db_path(&workspace_path);
    let limit = limit.unwrap_or(10);
    
    println!("[vectordb] Searching: '{}' (limit: {})", query, limit);
    
    if !std::path::Path::new(&db_path).exists() {
        return Err("Workspace not indexed. Run index_workspace first.".to_string());
    }
    
    let query_embedding = get_embeddings(&[query.clone()], &ollama).await?;
    if query_embedding.is_empty() {
        return Err("Failed to generate query embedding".to_string());
    }
    
    let db = connect(&db_path).execute().await
        .map_err(|e| format!("Failed to connect to LanceDB: {}", e))?;
    
    let table = db.open_table("code_chunks").execute().await
        .map_err(|e| format!("Failed to open table: {}", e))?;
    
    let results = table
        .vector_search(query_embedding[0].clone())
        .map_err(|e| format!("Search error: {}", e))?
        .limit(limit)
        .execute()
        .await
        .map_err(|e| format!("Search execution error: {}", e))?;
    
    let batches: Vec<RecordBatch> = results
        .try_collect()
        .await
        .map_err(|e| format!("Failed to collect results: {}", e))?;
    
    let mut search_results = Vec::new();
    
    for batch in batches {
        let file_paths = batch.column_by_name("file_path")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let contents = batch.column_by_name("content")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let start_lines = batch.column_by_name("start_line")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let end_lines = batch.column_by_name("end_line")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let chunk_types = batch.column_by_name("chunk_type")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let distances = batch.column_by_name("_distance")
            .and_then(|c| c.as_any().downcast_ref::<Float32Array>());
        
        if let (Some(fp), Some(ct), Some(sl), Some(el), Some(cht)) = 
            (file_paths, contents, start_lines, end_lines, chunk_types) {
            for i in 0..batch.num_rows() {
                let score = distances.map(|d| 1.0 - d.value(i)).unwrap_or(0.0);
                search_results.push(SearchResult {
                    file_path: fp.value(i).to_string(),
                    content: ct.value(i).to_string(),
                    start_line: sl.value(i).parse().unwrap_or(1),
                    end_line: el.value(i).parse().unwrap_or(1),
                    chunk_type: cht.value(i).to_string(),
                    score,
                });
            }
        }
    }
    
    println!("[vectordb] Found {} results", search_results.len());
    Ok(search_results)
}

#[command]
pub async fn get_index_status(workspace_path: String) -> Result<IndexStatus, String> {
    let db_path = get_db_path(&workspace_path);
    
    let cache = INDEX_CACHE.read().await;
    if let Some(state) = cache.get(&workspace_path) {
        return Ok(IndexStatus {
            is_indexed: true,
            file_count: state.file_count,
            last_indexed: Some(state.last_indexed.to_rfc3339()),
            db_path: state.db_path.clone(),
        });
    }
    drop(cache);
    
    if std::path::Path::new(&db_path).exists() {
        Ok(IndexStatus {
            is_indexed: true,
            file_count: 0,
            last_indexed: None,
            db_path,
        })
    } else {
        Ok(IndexStatus {
            is_indexed: false,
            file_count: 0,
            last_indexed: None,
            db_path,
        })
    }
}

#[command]
pub async fn delete_index(workspace_path: String) -> Result<(), String> {
    let db_path = get_db_path(&workspace_path);
    
    if std::path::Path::new(&db_path).exists() {
        std::fs::remove_dir_all(&db_path)
            .map_err(|e| format!("Failed to delete index: {}", e))?;
    }
    
    let mut cache = INDEX_CACHE.write().await;
    cache.remove(&workspace_path);
    
    println!("[vectordb] Deleted index for: {}", workspace_path);
    Ok(())
}

use futures::stream::TryStreamExt;

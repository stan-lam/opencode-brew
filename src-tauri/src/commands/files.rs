use std::fs::File;
use std::io::{Read, BufReader};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

#[tauri::command]
pub async fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    Ok(BASE64.encode(&bytes))
}

#[tauri::command]
pub async fn extract_pdf_text(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read PDF file: {}", e))?;
    pdf_extract::extract_text_from_mem(&bytes)
        .map_err(|e| format!("Failed to extract text from PDF: {}", e))
}

#[tauri::command]
pub async fn extract_docx_text(path: String) -> Result<String, String> {
    let file = File::open(&path).map_err(|e| format!("Failed to open DOCX file: {}", e))?;
    let reader = BufReader::new(file);
    
    let mut archive = zip::ZipArchive::new(reader)
        .map_err(|e| format!("Failed to read DOCX as ZIP: {}", e))?;
    
    let mut xml_content = String::new();
    
    if let Ok(mut document) = archive.by_name("word/document.xml") {
        document.read_to_string(&mut xml_content)
            .map_err(|e| format!("Failed to read document.xml: {}", e))?;
    } else {
        return Err("No document.xml found in DOCX".to_string());
    }
    
    let text = extract_text_from_docx_xml(&xml_content);
    Ok(text)
}

fn extract_text_from_docx_xml(xml: &str) -> String {
    let mut result = String::new();
    let mut in_text = false;
    let mut current_text = String::new();
    
    for c in xml.chars() {
        match c {
            '<' => {
                if in_text && !current_text.is_empty() {
                    result.push_str(&current_text);
                    current_text.clear();
                }
                in_text = false;
            }
            '>' => {
                in_text = true;
            }
            _ => {
                if in_text {
                    current_text.push(c);
                }
            }
        }
    }
    
    if !current_text.is_empty() {
        result.push_str(&current_text);
    }
    
    result
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

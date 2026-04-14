use tauri::{command, AppHandle, Manager, Window};

#[command]
pub async fn set_window_title(window: Window, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn set_all_windows_title(app: AppHandle, title: String) -> Result<(), String> {
    for (_, window) in app.webview_windows() {
        let _ = window.set_title(&title);
    }
    Ok(())
}

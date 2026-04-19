use tauri::{command, AppHandle, Manager, Window, WebviewUrl, WebviewWindowBuilder};

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

#[command]
pub async fn open_tool_window(app: AppHandle, tool: String, label: String, title: String) -> Result<(), String> {
    // Check if window already exists
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Determine the URL based on environment and tool
    let url = if cfg!(debug_assertions) {
        // Development mode - use different ports for each tool
        let port = match tool.as_str() {
            "ide" => 5174,
            "notes" => 5175,
            "assistant" => 5176,
            _ => 5173,
        };
        WebviewUrl::External(format!("http://localhost:{}", port).parse().unwrap())
    } else {
        // Production mode - use relative paths
        let path = match tool.as_str() {
            "ide" => "ide/index.html",
            "notes" => "notes/index.html",
            "assistant" => "assistant/index.html",
            _ => "index.html",
        };
        WebviewUrl::App(path.into())
    };

    // Window configurations per tool
    let (width, height, min_width, min_height) = match tool.as_str() {
        "ide" => (1400.0, 900.0, 800.0, 600.0),
        "notes" => (1200.0, 800.0, 600.0, 500.0),
        "assistant" => (1200.0, 800.0, 600.0, 500.0),
        _ => (1000.0, 700.0, 600.0, 500.0),
    };

    WebviewWindowBuilder::new(&app, &label, url)
        .title(&title)
        .inner_size(width, height)
        .min_inner_size(min_width, min_height)
        .resizable(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[command]
pub async fn close_tool_window(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

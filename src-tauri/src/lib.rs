mod commands;

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

static LAST_FOCUSED_WINDOW: Mutex<Option<String>> = Mutex::new(None);

fn get_target_window(app: &AppHandle) -> Option<WebviewWindow> {
    // First try to get the last focused window we tracked
    if let Ok(guard) = LAST_FOCUSED_WINDOW.lock() {
        if let Some(ref label) = *guard {
            if let Some(window) = app.get_webview_window(label) {
                return Some(window);
            }
        }
    }
    // Fallback: try to find currently focused window
    app.webview_windows()
        .into_iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .map(|(_, w)| w)
        .or_else(|| app.webview_windows().into_iter().next().map(|(_, w)| w))
}

fn emit_to_focused(app: &AppHandle, event: &str) {
    let target_label = if let Some(window) = get_target_window(app) {
        window.label().to_string()
    } else {
        // Fallback to "main" if no window found
        "main".to_string()
    };
    
    println!(">>> Emitting '{}' targeting window: {}", event, target_label);
    
    // Emit to each window individually with the target window label
    let payload = serde_json::json!({ "target_window": target_label });
    for (label, window) in app.webview_windows() {
        match window.emit(event, payload.clone()) {
            Ok(_) => println!(">>> Event '{}' sent to window '{}'", event, label),
            Err(e) => println!(">>> Failed to send event '{}' to window '{}': {}", event, label, e),
        }
    }
}

fn track_window_focus(label: String) {
    println!(">>> Window focused: {}", label);
    if let Ok(mut guard) = LAST_FOCUSED_WINDOW.lock() {
        *guard = Some(label);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // App menu (OpenCodeBrew) - macOS style app menu
            let about = PredefinedMenuItem::about(app, Some("About OpenCodeBrew"), None)?;
            let separator1 = PredefinedMenuItem::separator(app)?;
            let settings = MenuItem::with_id(app, "settings", "Settings...", true, Some("CmdOrCtrl+,"))?;
            let check_updates = MenuItem::with_id(app, "check_updates", "Check for Updates...", true, None::<&str>)?;
            let separator2 = PredefinedMenuItem::separator(app)?;
            let services = PredefinedMenuItem::services(app, Some("Services"))?;
            let separator3 = PredefinedMenuItem::separator(app)?;
            let hide = PredefinedMenuItem::hide(app, Some("Hide OpenCodeBrew"))?;
            let hide_others = PredefinedMenuItem::hide_others(app, Some("Hide Others"))?;
            let show_all = PredefinedMenuItem::show_all(app, Some("Show All"))?;
            let separator4 = PredefinedMenuItem::separator(app)?;
            let quit = PredefinedMenuItem::quit(app, Some("Quit OpenCodeBrew"))?;

            let app_menu = Submenu::with_items(
                app,
                "OpenCodeBrew",
                true,
                &[&about, &separator1, &settings, &check_updates, &separator2, &services, &separator3, &hide, &hide_others, &show_all, &separator4, &quit],
            )?;

            // File menu
            let new_window = MenuItem::with_id(app, "new_window", "New Window", true, Some("CmdOrCtrl+Shift+N"))?;
            let open_folder = MenuItem::with_id(app, "open_folder", "Open Folder...", true, Some("CmdOrCtrl+O"))?;
            let file_separator = PredefinedMenuItem::separator(app)?;
            let close_window = PredefinedMenuItem::close_window(app, Some("Close Window"))?;

            let file_menu = Submenu::with_items(
                app,
                "File",
                true,
                &[&new_window, &open_folder, &file_separator, &close_window],
            )?;

            // Edit menu with standard items
            let undo = PredefinedMenuItem::undo(app, Some("Undo"))?;
            let redo = PredefinedMenuItem::redo(app, Some("Redo"))?;
            let edit_separator1 = PredefinedMenuItem::separator(app)?;
            let cut = PredefinedMenuItem::cut(app, Some("Cut"))?;
            let copy = PredefinedMenuItem::copy(app, Some("Copy"))?;
            let paste = PredefinedMenuItem::paste(app, Some("Paste"))?;
            let select_all = PredefinedMenuItem::select_all(app, Some("Select All"))?;
            let edit_separator2 = PredefinedMenuItem::separator(app)?;
            let find = MenuItem::with_id(app, "find", "Find...", true, Some("CmdOrCtrl+F"))?;
            let replace = MenuItem::with_id(app, "replace", "Replace...", true, Some("CmdOrCtrl+H"))?;
            let find_in_files = MenuItem::with_id(app, "find_in_files", "Find in Files...", true, Some("CmdOrCtrl+Shift+F"))?;
            let replace_in_files = MenuItem::with_id(app, "replace_in_files", "Replace in Files...", true, Some("CmdOrCtrl+Shift+H"))?;

            let edit_menu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[&undo, &redo, &edit_separator1, &cut, &copy, &paste, &select_all, &edit_separator2, &find, &replace, &find_in_files, &replace_in_files],
            )?;

            // Run menu
            let run_project = MenuItem::with_id(app, "run", "Run", true, Some("F5"))?;
            let run_file = MenuItem::with_id(app, "run_file", "Run Current File", true, Some("Shift+F10"))?;
            let stop_run = MenuItem::with_id(app, "stop", "Stop", true, Some("Shift+F5"))?;
            let run_separator = PredefinedMenuItem::separator(app)?;
            let run_configs = MenuItem::with_id(app, "run_configs", "Edit Configurations...", true, None::<&str>)?;

            let run_menu = Submenu::with_items(
                app,
                "Run",
                true,
                &[&run_project, &run_file, &stop_run, &run_separator, &run_configs],
            )?;

            // Build menu
            let build_project = MenuItem::with_id(app, "build", "Build Project", true, Some("CmdOrCtrl+B"))?;
            let rebuild_project = MenuItem::with_id(app, "rebuild", "Rebuild Project", true, Some("CmdOrCtrl+Shift+B"))?;
            let clean_project = MenuItem::with_id(app, "clean", "Clean", true, None::<&str>)?;
            let build_separator = PredefinedMenuItem::separator(app)?;
            let install_deps = MenuItem::with_id(app, "install_deps", "Install Dependencies", true, None::<&str>)?;

            let build_menu = Submenu::with_items(
                app,
                "Build",
                true,
                &[&build_project, &rebuild_project, &clean_project, &build_separator, &install_deps],
            )?;

            // View menu
            let fullscreen = PredefinedMenuItem::fullscreen(app, Some("Toggle Fullscreen"))?;
            let view_separator = PredefinedMenuItem::separator(app)?;
            let toggle_terminal = MenuItem::with_id(app, "toggle_terminal", "Toggle Terminal", true, Some("CmdOrCtrl+`"))?;
            let toggle_problems = MenuItem::with_id(app, "toggle_problems", "Toggle Problems", true, Some("CmdOrCtrl+Shift+M"))?;
            let toggle_output = MenuItem::with_id(app, "toggle_output", "Toggle Output", true, Some("CmdOrCtrl+Shift+U"))?;

            let view_menu = Submenu::with_items(
                app,
                "View",
                true,
                &[&fullscreen, &view_separator, &toggle_terminal, &toggle_problems, &toggle_output],
            )?;

            // Window menu
            let minimize = PredefinedMenuItem::minimize(app, Some("Minimize"))?;
            let window_separator = PredefinedMenuItem::separator(app)?;
            let front = MenuItem::with_id(app, "bring_to_front", "Bring All to Front", true, None::<&str>)?;

            let window_menu = Submenu::with_items(
                app,
                "Window",
                true,
                &[&minimize, &window_separator, &front],
            )?;

            // Help menu
            let help_item = MenuItem::with_id(app, "help", "OpenCodeBrew Help", true, None::<&str>)?;

            let help_menu = Submenu::with_items(app, "Help", true, &[&help_item])?;

            let menu = Menu::with_items(
                app,
                &[&app_menu, &file_menu, &edit_menu, &run_menu, &build_menu, &view_menu, &window_menu, &help_menu],
            )?;

            app.set_menu(menu)?;

            // Track the main window as initially focused
            track_window_focus("main".to_string());

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "new_window" => {
                    println!("New window menu clicked");
                    let window_count = app.webview_windows().len();
                    let window_label = format!("window_{}", window_count + 1);
                    println!("Creating window with label: {}", window_label);
                    
                    match WebviewWindowBuilder::new(
                        app,
                        &window_label,
                        WebviewUrl::default(),
                    )
                    .title("OpenCodeBrew")
                    .inner_size(1400.0, 900.0)
                    .min_inner_size(800.0, 600.0)
                    .build()
                    {
                        Ok(window) => {
                            println!("New window created successfully: {}", window.label());
                        }
                        Err(e) => {
                            eprintln!("Failed to create new window: {}", e);
                        }
                    }
                }
                "open_folder" => {
                    println!("Open folder menu clicked");
                    emit_to_focused(app, "open-folder");
                }
                "settings" => {
                    emit_to_focused(app, "open-settings");
                }
                "check_updates" => {
                    emit_to_focused(app, "check-updates");
                }
                "bring_to_front" => {
                    for (_, window) in app.webview_windows() {
                        let _ = window.set_focus();
                    }
                }
                "help" => {
                    let _ = tauri::async_runtime::spawn(async {
                        let _ = open::that("https://github.com/opencodebrew/opencodebrew");
                    });
                }
                "find" => emit_to_focused(app, "open-find"),
                "replace" => emit_to_focused(app, "open-replace"),
                "find_in_files" => emit_to_focused(app, "open-find-in-files"),
                "replace_in_files" => emit_to_focused(app, "open-replace-in-files"),
                // Run menu events
                "run" => {
                    println!("Run project menu clicked");
                    emit_to_focused(app, "run-project");
                }
                "run_file" => {
                    println!("Run file menu clicked");
                    emit_to_focused(app, "run-file");
                }
                "stop" => {
                    println!("Stop menu clicked");
                    emit_to_focused(app, "stop-run");
                }
                "run_configs" => {
                    println!("Edit configurations menu clicked");
                    emit_to_focused(app, "edit-run-configs");
                }
                // Build menu events
                "build" => {
                    println!("Build project menu clicked");
                    emit_to_focused(app, "build-project");
                }
                "rebuild" => {
                    println!("Rebuild project menu clicked");
                    emit_to_focused(app, "rebuild-project");
                }
                "clean" => {
                    println!("Clean menu clicked");
                    emit_to_focused(app, "clean-project");
                }
                "install_deps" => {
                    println!("Install dependencies menu clicked");
                    emit_to_focused(app, "install-deps");
                }
                // View menu events
                "toggle_terminal" => emit_to_focused(app, "toggle-terminal"),
                "toggle_problems" => emit_to_focused(app, "toggle-problems"),
                "toggle_output" => emit_to_focused(app, "toggle-output"),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::read_directory,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::create_file,
            commands::fs::create_directory,
            commands::fs::delete_path,
            commands::fs::rename_path,
            commands::fs::get_file_info,
            commands::fs::path_exists,
            commands::fs::watch_directory,
            commands::fs::unwatch_directory,
            commands::fs::search_in_files,
            commands::fs::replace_in_file,
            commands::fs::get_app_data_dir,
            commands::git::git_status,
            commands::git::git_init,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_commit,
            commands::git::git_branches,
            commands::git::git_checkout,
            commands::git::git_log,
            commands::git::git_diff_file,
            commands::git::git_diff_all,
            commands::git::is_git_repo,
            commands::git::git_fetch,
            commands::git::git_pull,
            commands::git::git_push,
            commands::git::git_create_branch,
            commands::git::git_remotes,
            commands::ai::chat_ollama,
            commands::ai::chat_openai_compatible,
            commands::ai::chat_copilot,
            commands::ai::list_ollama_models,
            commands::ai::list_copilot_models,
            commands::ai::list_copilot_vision_models,
            commands::ai::check_ollama_status,
            commands::ai::copilot_device_login_start,
            commands::ai::copilot_device_login_poll,
            commands::ai::copilot_device_login_status,
            commands::ai::copilot_device_logout,
            commands::ai::copilot_list_orgs,
            commands::ai::copilot_billing_info,
            commands::ai::stop_ai_stream,
            commands::history::save_history_entry,
            commands::history::get_file_history,
            commands::history::get_history_content,
            commands::history::init_history_db,
            commands::terminal::create_terminal,
            commands::terminal::write_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::close_terminal,
            commands::project::detect_project,
            commands::project::get_npm_scripts,
            commands::window::set_window_title,
            commands::window::set_all_windows_title,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(focused) = event {
                if *focused {
                    track_window_focus(window.label().to_string());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

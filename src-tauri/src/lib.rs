pub mod ai;
pub mod commands;
pub mod database;
pub mod db;
mod ssh_tunnel;

use commands::ai::{detect_ai_harnesses, generate_sql, get_ai_status};
use commands::connections::{
    create_connection, delete_connection, export_connection, get_connection_by_uuid,
    get_connections, import_connections, update_connection,
};
use commands::database::{
    delete_table_row, insert_table_row, redis_delete_key, redis_get_key_details, redis_search_keys,
    redis_set_hash_key, redis_set_key, redis_set_list_key, redis_set_set_key, redis_set_zset_key,
    redis_update_ttl, unified_execute_query, unified_get_schema_overview, unified_get_table_data,
    unified_get_table_structure, unified_list_tables, unified_test_connection, update_table_row,
    update_table_row_with_raw_sql,
};
use commands::pool::{
    pool_connect, pool_delete_table_row, pool_disconnect, pool_execute_query,
    pool_get_function_definition, pool_get_schema_overview, pool_get_status, pool_get_table_data,
    pool_get_table_structure, pool_health_check, pool_insert_table_row, pool_list_tables,
    pool_update_table_row,
};
use commands::postgres::{
    execute_query, get_table_data, get_table_structure, list_tables, test_connection,
};
use commands::queries::{
    clear_query_history, create_saved_query, delete_saved_query, get_query_history,
    get_saved_queries, record_query_history, update_saved_query,
};
use commands::settings::{get_all_settings, get_setting, set_setting, set_settings};
#[cfg(desktop)]
use commands::updates::check_for_update;
use database::pool_manager::PoolManager;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, WebviewUrl};

const NEW_WINDOW_MENU_ID: &str = "new_window";
const CLOSE_TAB_MENU_ID: &str = "close_tab";
const CLOSE_WINDOW_MENU_ID: &str = "close_window";

fn create_new_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let label = format!("window-{}", uuid::Uuid::new_v4());

    if let Some(mut window_config) = app.config().app.windows.first().cloned() {
        window_config.label = label;
        tauri::WebviewWindowBuilder::from_config(app, &window_config)?.build()?;
    } else {
        tauri::WebviewWindowBuilder::new(app, label, WebviewUrl::default()).build()?;
    }

    Ok(())
}

/// Resolve the window a menu accelerator should act on. Prefers the focused
/// window (the one the user is interacting with) and falls back to the first
/// window so single-window setups always have a target.
fn menu_target_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Option<tauri::WebviewWindow<R>> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| windows.values().next())
        .cloned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .menu(|app_handle| {
            // Create About metadata with descriptive information
            // Note: macOS automatically uses the app icon from the bundle
            let about_metadata = AboutMetadata {
                name: Some("DBcooper".into()),
                copyright: Some("© 2026 Amal Shaji. All rights reserved.".into()),
                website: Some("https://dbcooper.amal.sh".into()),
                website_label: Some("Visit Website".into()),
                credits: Some(
                    "A modern database client for PostgreSQL, SQLite, Redis, and ClickHouse."
                        .into(),
                ),
                ..Default::default()
            };

            // Build minimal app submenu with descriptive About item
            let app_submenu = Submenu::with_items(
                app_handle,
                "DBcooper",
                true,
                &[
                    &PredefinedMenuItem::about(
                        app_handle,
                        Some("About DBcooper"),
                        Some(about_metadata),
                    )?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::services(app_handle, Some("Services"))?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::hide(app_handle, Some("Hide DBcooper"))?,
                    &PredefinedMenuItem::hide_others(app_handle, Some("Hide Others"))?,
                    &PredefinedMenuItem::show_all(app_handle, Some("Show All"))?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::quit(app_handle, Some("Quit DBcooper"))?,
                ],
            )?;

            let edit_submenu = Submenu::with_items(
                app_handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app_handle, Some("Undo"))?,
                    &PredefinedMenuItem::redo(app_handle, Some("Redo"))?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::cut(app_handle, Some("Cut"))?,
                    &PredefinedMenuItem::copy(app_handle, Some("Copy"))?,
                    &PredefinedMenuItem::paste(app_handle, Some("Paste"))?,
                    &PredefinedMenuItem::select_all(app_handle, Some("Select All"))?,
                ],
            )?;

            let new_window_menu_item = MenuItem::with_id(
                app_handle,
                NEW_WINDOW_MENU_ID,
                "New Window",
                true,
                Some("CmdOrCtrl+Shift+N"),
            )?;

            // Cmd/Ctrl+W closes the active in-app tab (not the window). The
            // predefined close_window item hard-codes Cmd/Ctrl+W and the native
            // menu intercepts that accelerator before the webview ever sees it,
            // so closing a tab ended up closing the whole window (issue #66).
            let close_tab_menu_item = MenuItem::with_id(
                app_handle,
                CLOSE_TAB_MENU_ID,
                "Close Tab",
                true,
                Some("CmdOrCtrl+W"),
            )?;

            let close_window_menu_item = MenuItem::with_id(
                app_handle,
                CLOSE_WINDOW_MENU_ID,
                "Close Window",
                true,
                Some("CmdOrCtrl+Shift+W"),
            )?;

            let file_submenu = Submenu::with_items(
                app_handle,
                "File",
                true,
                &[
                    &new_window_menu_item,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &close_tab_menu_item,
                    &close_window_menu_item,
                ],
            )?;

            Menu::with_items(app_handle, &[&app_submenu, &file_submenu, &edit_submenu])
        })
        .on_menu_event(|app, event| {
            let id = event.id();
            if id == NEW_WINDOW_MENU_ID {
                if let Err(error) = create_new_window(app) {
                    eprintln!("Failed to open new window: {error}");
                }
            } else if id == CLOSE_TAB_MENU_ID {
                // Let the frontend close the active tab; it falls back to
                // closing the window when no tab is open.
                if let Some(window) = menu_target_window(app) {
                    if let Err(error) = window.emit("menu:close-tab", ()) {
                        eprintln!("Failed to emit close-tab event: {error}");
                    }
                }
            } else if id == CLOSE_WINDOW_MENU_ID {
                if let Some(window) = menu_target_window(app) {
                    if let Err(error) = window.close() {
                        eprintln!("Failed to close window: {error}");
                    }
                }
            }
        })
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
            let pool = rt
                .block_on(db::init_pool())
                .expect("Failed to initialize database");
            app.manage(pool);

            // Initialize connection pool manager
            app.manage(PoolManager::new());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_connections,
            get_connection_by_uuid,
            create_connection,
            update_connection,
            delete_connection,
            export_connection,
            import_connections,
            test_connection,
            list_tables,
            get_table_data,
            get_table_structure,
            execute_query,
            unified_test_connection,
            unified_list_tables,
            unified_get_table_data,
            unified_get_table_structure,
            unified_execute_query,
            unified_get_schema_overview,
            redis_search_keys,
            redis_get_key_details,
            redis_delete_key,
            redis_set_key,
            redis_set_list_key,
            redis_set_set_key,
            redis_set_hash_key,
            redis_set_zset_key,
            redis_update_ttl,
            update_table_row,
            update_table_row_with_raw_sql,
            delete_table_row,
            insert_table_row,
            get_saved_queries,
            create_saved_query,
            update_saved_query,
            delete_saved_query,
            record_query_history,
            get_query_history,
            clear_query_history,
            get_setting,
            set_setting,
            set_settings,
            get_all_settings,
            #[cfg(desktop)]
            check_for_update,
            generate_sql,
            detect_ai_harnesses,
            get_ai_status,
            pool_connect,
            pool_disconnect,
            pool_get_status,
            pool_health_check,
            pool_list_tables,
            pool_get_table_data,
            pool_get_table_structure,
            pool_execute_query,
            pool_get_schema_overview,
            pool_get_function_definition,
            pool_update_table_row,
            pool_delete_table_row,
            pool_insert_table_row,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

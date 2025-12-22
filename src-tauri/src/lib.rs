mod commands;
mod database;
mod db;
mod ssh_tunnel;

use commands::connections::{
    create_connection, delete_connection, get_connection_by_uuid, get_connections,
    update_connection,
};
use commands::database::{
    unified_execute_query, unified_get_table_data, unified_get_table_structure,
    unified_list_tables, unified_test_connection,
};
use commands::postgres::{
    execute_query, get_table_data, get_table_structure, list_tables, test_connection,
};
use commands::queries::{
    create_saved_query, delete_saved_query, get_saved_queries, update_saved_query,
};
use commands::settings::{get_all_settings, get_setting, set_setting};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
            let pool = rt
                .block_on(db::init_pool())
                .expect("Failed to initialize database");
            app.manage(pool);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_connections,
            get_connection_by_uuid,
            create_connection,
            update_connection,
            delete_connection,
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
            get_saved_queries,
            create_saved_query,
            update_saved_query,
            delete_saved_query,
            get_setting,
            set_setting,
            get_all_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

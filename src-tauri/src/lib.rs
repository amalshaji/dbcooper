mod commands;
mod database;
mod db;
mod ssh_tunnel;

use commands::ai::{generate_sql, select_tables_for_query};
use commands::connections::{
    create_connection, delete_connection, get_connection_by_uuid, get_connections,
    update_connection,
};
use commands::database::{
    delete_table_row, insert_table_row, redis_delete_key, redis_get_key_details, redis_search_keys,
    redis_set_key, unified_execute_query, unified_get_schema_overview, unified_get_table_data,
    unified_get_table_structure, unified_list_tables, unified_test_connection, update_table_row,
};
use commands::pool::{
    pool_connect, pool_disconnect, pool_execute_query, pool_get_schema_overview, pool_get_status,
    pool_get_table_data, pool_get_table_structure, pool_health_check, pool_list_tables,
};
use commands::postgres::{
    execute_query, get_table_data, get_table_structure, list_tables, test_connection,
};
use commands::queries::{
    create_saved_query, delete_saved_query, get_saved_queries, update_saved_query,
};
use commands::settings::{get_all_settings, get_setting, set_setting};
use database::pool_manager::PoolManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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
            update_table_row,
            delete_table_row,
            insert_table_row,
            get_saved_queries,
            create_saved_query,
            update_saved_query,
            delete_saved_query,
            get_setting,
            set_setting,
            get_all_settings,
            generate_sql,
            pool_connect,
            pool_disconnect,
            pool_get_status,
            pool_health_check,
            pool_list_tables,
            pool_get_table_data,
            pool_get_table_structure,
            pool_execute_query,
            pool_get_schema_overview,
            select_tables_for_query,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

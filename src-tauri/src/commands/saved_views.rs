use crate::db::models::{SavedView, SavedViewFormData, SavedViewState, SavedViewUpdateData};
use sqlx::{FromRow, SqlitePool};
use tauri::State;

const VIEW_STATE_VERSION: u8 = 1;
const MIN_COLUMN_WIDTH: u16 = 80;
const MAX_COLUMN_WIDTH: u16 = 300;
const MAX_VIEW_NAME_LENGTH: usize = 80;

#[derive(FromRow)]
struct SavedViewRow {
    id: i64,
    connection_uuid: String,
    table_name: String,
    name: String,
    state_json: String,
    created_at: String,
    updated_at: String,
}

impl SavedViewRow {
    fn into_saved_view(self) -> Result<SavedView, String> {
        let state = serde_json::from_str(&self.state_json)
            .map_err(|_| format!("Saved view '{}' has invalid state", self.name))?;

        Ok(SavedView {
            id: self.id,
            connection_uuid: self.connection_uuid,
            table_name: self.table_name,
            name: self.name,
            state,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

fn normalize_view_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("View name is required".to_string());
    }
    if name.chars().count() > MAX_VIEW_NAME_LENGTH {
        return Err(format!(
            "View name must be {MAX_VIEW_NAME_LENGTH} characters or fewer"
        ));
    }
    Ok(name.to_string())
}

fn validate_view_state(state: &SavedViewState) -> Result<(), String> {
    if state.version != VIEW_STATE_VERSION {
        return Err(format!("Unsupported saved view version: {}", state.version));
    }

    if state
        .column_widths
        .values()
        .any(|width| !(MIN_COLUMN_WIDTH..=MAX_COLUMN_WIDTH).contains(width))
    {
        return Err(format!(
            "Column widths must be between {MIN_COLUMN_WIDTH} and {MAX_COLUMN_WIDTH} pixels"
        ));
    }

    Ok(())
}

fn map_database_error(error: sqlx::Error) -> String {
    if error
        .as_database_error()
        .is_some_and(|database_error| database_error.is_unique_violation())
    {
        "A view with this name already exists for this table".to_string()
    } else {
        error.to_string()
    }
}

fn serialize_state(state: &SavedViewState) -> Result<String, String> {
    validate_view_state(state)?;
    serde_json::to_string(state).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_saved_views(
    pool: State<'_, SqlitePool>,
    connection_uuid: String,
    table_name: String,
) -> Result<Vec<SavedView>, String> {
    let rows = sqlx::query_as::<_, SavedViewRow>(
        r#"
        SELECT * FROM saved_views
        WHERE connection_uuid = ? AND table_name = ?
        ORDER BY updated_at DESC, id DESC
        "#,
    )
    .bind(connection_uuid)
    .bind(table_name)
    .fetch_all(pool.inner())
    .await
    .map_err(map_database_error)?;

    rows.into_iter()
        .map(SavedViewRow::into_saved_view)
        .collect()
}

#[tauri::command]
pub async fn create_saved_view(
    pool: State<'_, SqlitePool>,
    connection_uuid: String,
    data: SavedViewFormData,
) -> Result<SavedView, String> {
    if data.table_name.trim().is_empty() {
        return Err("Table name is required".to_string());
    }

    let name = normalize_view_name(&data.name)?;
    let state_json = serialize_state(&data.state)?;
    let row = sqlx::query_as::<_, SavedViewRow>(
        r#"
        INSERT INTO saved_views (connection_uuid, table_name, name, state_json)
        VALUES (?, ?, ?, ?)
        RETURNING *
        "#,
    )
    .bind(connection_uuid)
    .bind(data.table_name)
    .bind(name)
    .bind(state_json)
    .fetch_one(pool.inner())
    .await
    .map_err(map_database_error)?;

    row.into_saved_view()
}

#[tauri::command]
pub async fn update_saved_view(
    pool: State<'_, SqlitePool>,
    id: i64,
    data: SavedViewUpdateData,
) -> Result<SavedView, String> {
    let name = normalize_view_name(&data.name)?;
    let state_json = serialize_state(&data.state)?;
    let row = sqlx::query_as::<_, SavedViewRow>(
        r#"
        UPDATE saved_views
        SET name = ?, state_json = ?, updated_at = datetime('now')
        WHERE id = ?
        RETURNING *
        "#,
    )
    .bind(name)
    .bind(state_json)
    .bind(id)
    .fetch_one(pool.inner())
    .await
    .map_err(map_database_error)?;

    row.into_saved_view()
}

#[tauri::command]
pub async fn delete_saved_view(pool: State<'_, SqlitePool>, id: i64) -> Result<bool, String> {
    sqlx::query("DELETE FROM saved_views WHERE id = ?")
        .bind(id)
        .execute(pool.inner())
        .await
        .map(|_| true)
        .map_err(map_database_error)
}

#[cfg(test)]
mod tests {
    use super::{normalize_view_name, validate_view_state};
    use crate::db::models::SavedViewState;
    use std::collections::HashMap;

    fn state() -> SavedViewState {
        SavedViewState {
            version: 1,
            filter: None,
            sort: None,
            column_order: vec!["id".to_string()],
            hidden_columns: Vec::new(),
            column_widths: HashMap::from([("id".to_string(), 150)]),
        }
    }

    #[test]
    fn normalizes_valid_names_and_rejects_blank_or_long_names() {
        assert_eq!(
            normalize_view_name("  Recent events  ").unwrap(),
            "Recent events"
        );
        assert!(normalize_view_name("   ").is_err());
        assert!(normalize_view_name(&"a".repeat(81)).is_err());
    }

    #[test]
    fn validates_the_state_version_and_column_width_bounds() {
        assert!(validate_view_state(&state()).is_ok());

        let mut unsupported = state();
        unsupported.version = 2;
        assert!(validate_view_state(&unsupported).is_err());

        let mut too_narrow = state();
        too_narrow.column_widths.insert("id".to_string(), 79);
        assert!(validate_view_state(&too_narrow).is_err());

        let mut too_wide = state();
        too_wide.column_widths.insert("id".to_string(), 301);
        assert!(validate_view_state(&too_wide).is_err());
    }
}

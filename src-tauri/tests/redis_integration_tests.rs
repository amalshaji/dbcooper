//! Integration tests for the Redis database driver
//!
//! These tests verify the Redis driver implementation.
//! Requires a running Redis instance at localhost:6379 (use docker-compose up -d redis)
//!
//! Run with: cargo test --test redis_integration_tests -- --test-threads=1

use std::collections::HashMap;

use dbcooper_lib::database::redis::RedisDriver;
use dbcooper_lib::database::{DatabaseDriver, RedisConfig};

/// Helper function to create a test Redis driver
fn create_test_driver() -> RedisDriver {
    let config = RedisConfig {
        host: "localhost".to_string(),
        port: 6379,
        password: None,
        db: Some(15), // Use database 15 for tests to avoid conflicts
        tls: false,
    };
    RedisDriver::new(config)
}

/// Generate a unique test key to avoid conflicts
fn test_key(prefix: &str) -> String {
    format!("test:{}:{}", prefix, uuid::Uuid::new_v4())
}

/// Helper macro to clean up test keys
macro_rules! cleanup_keys {
    ($driver:expr, $($key:expr),+) => {
        $(
            let _ = $driver.delete_key($key).await;
        )+
    };
}

// ============================================================================
// Connection Tests
// ============================================================================

#[tokio::test]
async fn test_connection_success() {
    let driver = create_test_driver();

    let result = driver.test_connection().await;
    assert!(result.is_ok(), "test_connection should not error");

    let test_result = result.unwrap();
    assert!(
        test_result.success,
        "Connection should succeed. Make sure Redis is running (docker-compose up -d redis). Message: {}",
        test_result.message
    );
    assert_eq!(test_result.message, "Connection successful!");
}

#[tokio::test]
async fn test_connection_failure() {
    let config = RedisConfig {
        host: "localhost".to_string(),
        port: 16379, // Wrong port
        password: None,
        db: None,
        tls: false,
    };
    let driver = RedisDriver::new(config);

    let result = driver.test_connection().await;
    assert!(result.is_ok());

    let test_result = result.unwrap();
    assert!(
        !test_result.success,
        "Connection should fail with wrong port"
    );
    assert!(test_result.message.contains("Connection failed"));
}

// ============================================================================
// DatabaseDriver Trait Tests
// ============================================================================

#[tokio::test]
async fn test_list_tables_returns_keyspace() {
    let driver = create_test_driver();

    let result = driver.list_tables().await;
    assert!(result.is_ok());

    let tables = result.unwrap();
    assert_eq!(tables.len(), 1, "Should return 1 'table' for keyspace");
    assert_eq!(tables[0].name, "keys");
    assert_eq!(tables[0].schema, "redis");
    assert_eq!(tables[0].table_type, "keyspace");
}

#[tokio::test]
async fn test_get_table_data_returns_empty() {
    let driver = create_test_driver();

    let result = driver.get_table_data("redis", "keys", 1, 10, None, None, None).await;
    assert!(result.is_ok());

    let data = result.unwrap();
    assert!(
        data.data.is_empty(),
        "get_table_data should return empty for Redis"
    );
}

#[tokio::test]
async fn test_get_table_structure_returns_empty() {
    let driver = create_test_driver();

    let result = driver.get_table_structure("redis", "keys").await;
    assert!(result.is_ok());

    let structure = result.unwrap();
    assert!(structure.columns.is_empty());
    assert!(structure.indexes.is_empty());
    assert!(structure.foreign_keys.is_empty());
}

#[tokio::test]
async fn test_get_schema_overview_returns_empty() {
    let driver = create_test_driver();

    let result = driver.get_schema_overview().await;
    assert!(result.is_ok());

    let overview = result.unwrap();
    assert!(overview.tables.is_empty());
}

#[tokio::test]
async fn test_execute_query_ping() {
    let driver = create_test_driver();

    let result = driver.execute_query("PING").await;
    assert!(result.is_ok());

    let query_result = result.unwrap();
    assert!(query_result.error.is_none(), "PING should not error");
    assert_eq!(query_result.row_count, 1);
    assert!(query_result.time_taken_ms.is_some());
}

#[tokio::test]
async fn test_execute_query_info() {
    let driver = create_test_driver();

    let result = driver.execute_query("INFO server").await;
    assert!(result.is_ok());

    let query_result = result.unwrap();
    assert!(query_result.error.is_none(), "INFO should not error");
    assert_eq!(query_result.row_count, 1);
    assert!(!query_result.data.is_empty());
}

#[tokio::test]
async fn test_execute_query_invalid_command() {
    let driver = create_test_driver();

    let result = driver.execute_query("INVALID_CMD arg1 arg2").await;
    assert!(result.is_ok());

    let query_result = result.unwrap();
    assert!(
        query_result.error.is_some(),
        "Invalid command should return error"
    );
}

// ============================================================================
// String Key Tests
// ============================================================================

#[tokio::test]
async fn test_set_and_get_string_key() {
    let driver = create_test_driver();
    let key = test_key("string");

    // Set the key
    let result = driver.set_key(&key, "hello world", None).await;
    assert!(result.is_ok(), "set_key should succeed");

    // Get key details
    let details = driver.get_key_details(&key).await;
    assert!(details.is_ok());

    let details = details.unwrap();
    assert_eq!(details.key, key);
    assert_eq!(details.key_type, "string");
    assert_eq!(details.value.as_str().unwrap(), "hello world");
    assert_eq!(details.ttl, -1); // No expiration

    // Cleanup
    cleanup_keys!(driver, &key);
}

#[tokio::test]
async fn test_set_string_key_with_ttl() {
    let driver = create_test_driver();
    let key = test_key("string_ttl");

    // Set the key with 60 second TTL
    let result = driver.set_key(&key, "expiring value", Some(60)).await;
    assert!(result.is_ok());

    // Get key details
    let details = driver.get_key_details(&key).await.unwrap();
    assert!(details.ttl > 0 && details.ttl <= 60, "TTL should be set");

    // Cleanup
    cleanup_keys!(driver, &key);
}

// ============================================================================
// List Key Tests
// ============================================================================

#[tokio::test]
async fn test_set_and_get_list_key() {
    let driver = create_test_driver();
    let key = test_key("list");

    let values = vec![
        "item1".to_string(),
        "item2".to_string(),
        "item3".to_string(),
    ];

    // Set the list
    let result = driver.set_list_key(&key, &values, None).await;
    assert!(result.is_ok(), "set_list_key should succeed");

    // Get key details
    let details = driver.get_key_details(&key).await.unwrap();
    assert_eq!(details.key_type, "list");
    assert_eq!(details.length, Some(3));

    let list_values = details.value.as_array().unwrap();
    assert_eq!(list_values.len(), 3);
    assert_eq!(list_values[0].as_str().unwrap(), "item1");
    assert_eq!(list_values[1].as_str().unwrap(), "item2");
    assert_eq!(list_values[2].as_str().unwrap(), "item3");

    // Cleanup
    cleanup_keys!(driver, &key);
}

#[tokio::test]
async fn test_set_list_key_empty_values_error() {
    let driver = create_test_driver();
    let key = test_key("list_empty");

    let result = driver.set_list_key(&key, &[], None).await;
    assert!(result.is_err(), "Empty list should error");
    assert!(result.unwrap_err().contains("empty"));
}

#[tokio::test]
async fn test_set_list_key_with_ttl() {
    let driver = create_test_driver();
    let key = test_key("list_ttl");

    let values = vec!["a".to_string(), "b".to_string()];
    let result = driver.set_list_key(&key, &values, Some(120)).await;
    assert!(result.is_ok());

    let details = driver.get_key_details(&key).await.unwrap();
    assert!(details.ttl > 0 && details.ttl <= 120);

    cleanup_keys!(driver, &key);
}

// ============================================================================
// Set Key Tests
// ============================================================================

#[tokio::test]
async fn test_set_and_get_set_key() {
    let driver = create_test_driver();
    let key = test_key("set");

    let values = vec![
        "member1".to_string(),
        "member2".to_string(),
        "member3".to_string(),
    ];

    // Set the set
    let result = driver.set_set_key(&key, &values, None).await;
    assert!(result.is_ok(), "set_set_key should succeed");

    // Get key details
    let details = driver.get_key_details(&key).await.unwrap();
    assert_eq!(details.key_type, "set");
    assert_eq!(details.length, Some(3));

    let set_values = details.value.as_array().unwrap();
    assert_eq!(set_values.len(), 3);

    // Cleanup
    cleanup_keys!(driver, &key);
}

#[tokio::test]
async fn test_set_set_key_deduplicates() {
    let driver = create_test_driver();
    let key = test_key("set_dup");

    // Add duplicates - Redis should deduplicate
    let values = vec![
        "member1".to_string(),
        "member1".to_string(),
        "member2".to_string(),
    ];

    let result = driver.set_set_key(&key, &values, None).await;
    assert!(result.is_ok());

    let details = driver.get_key_details(&key).await.unwrap();
    assert_eq!(details.length, Some(2), "Duplicates should be removed");

    cleanup_keys!(driver, &key);
}

#[tokio::test]
async fn test_set_set_key_empty_values_error() {
    let driver = create_test_driver();
    let key = test_key("set_empty");

    let result = driver.set_set_key(&key, &[], None).await;
    assert!(result.is_err(), "Empty set should error");
}

// ============================================================================
// Hash Key Tests
// ============================================================================

#[tokio::test]
async fn test_set_and_get_hash_key() {
    let driver = create_test_driver();
    let key = test_key("hash");

    let mut fields = HashMap::new();
    fields.insert("name".to_string(), "John".to_string());
    fields.insert("age".to_string(), "30".to_string());
    fields.insert("city".to_string(), "NYC".to_string());

    // Set the hash
    let result = driver.set_hash_key(&key, &fields, None).await;
    assert!(result.is_ok(), "set_hash_key should succeed");

    // Get key details
    let details = driver.get_key_details(&key).await.unwrap();
    assert_eq!(details.key_type, "hash");
    assert_eq!(details.length, Some(3));

    let hash_value = details.value.as_object().unwrap();
    assert_eq!(hash_value.get("name").unwrap().as_str().unwrap(), "John");
    assert_eq!(hash_value.get("age").unwrap().as_str().unwrap(), "30");
    assert_eq!(hash_value.get("city").unwrap().as_str().unwrap(), "NYC");

    // Cleanup
    cleanup_keys!(driver, &key);
}

#[tokio::test]
async fn test_set_hash_key_empty_fields_error() {
    let driver = create_test_driver();
    let key = test_key("hash_empty");

    let fields: HashMap<String, String> = HashMap::new();
    let result = driver.set_hash_key(&key, &fields, None).await;
    assert!(result.is_err(), "Empty hash should error");
}

// ============================================================================
// Sorted Set (ZSet) Key Tests
// ============================================================================

#[tokio::test]
async fn test_set_and_get_zset_key() {
    let driver = create_test_driver();
    let key = test_key("zset");

    let members = vec![
        ("alice".to_string(), 100.0),
        ("bob".to_string(), 85.5),
        ("charlie".to_string(), 92.0),
    ];

    // Set the sorted set
    let result = driver.set_zset_key(&key, &members, None).await;
    assert!(result.is_ok(), "set_zset_key should succeed");

    // Get key details
    let details = driver.get_key_details(&key).await.unwrap();
    assert_eq!(details.key_type, "zset");
    assert_eq!(details.length, Some(3));

    // ZSet values are returned as [[member, score], ...] or similar
    let zset_values = details.value.as_array().unwrap();
    assert_eq!(zset_values.len(), 3);

    // Cleanup
    cleanup_keys!(driver, &key);
}

#[tokio::test]
async fn test_set_zset_key_empty_members_error() {
    let driver = create_test_driver();
    let key = test_key("zset_empty");

    let members: Vec<(String, f64)> = vec![];
    let result = driver.set_zset_key(&key, &members, None).await;
    assert!(result.is_err(), "Empty zset should error");
}

// ============================================================================
// Key Search Tests
// ============================================================================

#[tokio::test]
async fn test_search_keys() {
    let driver = create_test_driver();

    // Create some test keys with a unique prefix
    let prefix = format!("searchtest:{}", uuid::Uuid::new_v4());
    let key1 = format!("{}:key1", prefix);
    let key2 = format!("{}:key2", prefix);
    let key3 = format!("{}:key3", prefix);

    driver.set_key(&key1, "value1", None).await.unwrap();
    driver.set_key(&key2, "value2", None).await.unwrap();
    driver.set_key(&key3, "value3", None).await.unwrap();

    // Search for keys matching the pattern
    let pattern = format!("{}:*", prefix);
    let result = driver.search_keys(&pattern, 100, 0, |_, _, _| {}).await;
    assert!(result.is_ok());

    let response = result.unwrap();
    assert_eq!(response.keys.len(), 3, "Should find 3 keys");
    assert_eq!(response.total, 3);
    assert!(response.time_taken_ms.is_some());

    // Verify key names are in the result
    let key_names: Vec<&str> = response.keys.iter().map(|k| k.key.as_str()).collect();
    assert!(key_names.contains(&key1.as_str()));
    assert!(key_names.contains(&key2.as_str()));
    assert!(key_names.contains(&key3.as_str()));

    // Cleanup
    cleanup_keys!(driver, &key1, &key2, &key3);
}

#[tokio::test]
async fn test_search_keys_with_limit() {
    let driver = create_test_driver();

    // Create 5 test keys
    let prefix = format!("limitest:{}", uuid::Uuid::new_v4());
    let keys: Vec<String> = (1..=5).map(|i| format!("{}:key{}", prefix, i)).collect();

    for key in &keys {
        driver.set_key(key, "value", None).await.unwrap();
    }

    // Search with limit of 2
    let pattern = format!("{}:*", prefix);
    let result = driver.search_keys(&pattern, 2, 0, |_, _, _| {}).await.unwrap();
    assert!(result.keys.len() <= 2, "Should respect limit");

    // Cleanup
    for key in &keys {
        let _ = driver.delete_key(key).await;
    }
}

#[tokio::test]
async fn test_search_keys_no_match() {
    let driver = create_test_driver();

    let result = driver
        .search_keys("nonexistent:pattern:*", 100, 0, |_, _, _| {})
        .await
        .unwrap();
    assert!(result.keys.is_empty(), "Should return empty for no matches");
    assert_eq!(result.total, 0);
}

// ============================================================================
// Delete Key Tests
// ============================================================================

#[tokio::test]
async fn test_delete_key() {
    let driver = create_test_driver();
    let key = test_key("delete");

    // Create a key
    driver.set_key(&key, "to be deleted", None).await.unwrap();

    // Verify it exists
    let details = driver.get_key_details(&key).await;
    assert!(details.is_ok());

    // Delete it
    let result = driver.delete_key(&key).await;
    assert!(result.is_ok());
    assert!(result.unwrap(), "delete_key should return true");

    // Verify it's gone
    let details = driver.get_key_details(&key).await;
    assert!(details.is_err(), "Key should not exist after deletion");
}

#[tokio::test]
async fn test_delete_nonexistent_key() {
    let driver = create_test_driver();

    let result = driver.delete_key("nonexistent:key:12345").await;
    assert!(result.is_ok());
    assert!(
        !result.unwrap(),
        "Deleting nonexistent key should return false"
    );
}

// ============================================================================
// TTL Tests
// ============================================================================

#[tokio::test]
async fn test_update_ttl_set_expiration() {
    let driver = create_test_driver();
    let key = test_key("ttl_set");

    // Create a key without TTL
    driver.set_key(&key, "persistent", None).await.unwrap();

    // Verify no TTL
    let details = driver.get_key_details(&key).await.unwrap();
    assert_eq!(details.ttl, -1, "Key should have no TTL initially");

    // Set TTL
    let result = driver.update_ttl(&key, Some(300)).await;
    assert!(result.is_ok());

    // Verify TTL is set
    let details = driver.get_key_details(&key).await.unwrap();
    assert!(details.ttl > 0 && details.ttl <= 300, "TTL should be set");

    cleanup_keys!(driver, &key);
}

#[tokio::test]
async fn test_update_ttl_remove_expiration() {
    let driver = create_test_driver();
    let key = test_key("ttl_remove");

    // Create a key with TTL
    driver.set_key(&key, "expiring", Some(60)).await.unwrap();

    // Verify TTL exists
    let details = driver.get_key_details(&key).await.unwrap();
    assert!(details.ttl > 0, "Key should have TTL");

    // Remove TTL (make persistent)
    let result = driver.update_ttl(&key, None).await;
    assert!(result.is_ok());

    // Verify TTL is removed
    let details = driver.get_key_details(&key).await.unwrap();
    assert_eq!(details.ttl, -1, "TTL should be removed");

    cleanup_keys!(driver, &key);
}

// ============================================================================
// Get Key Details Tests
// ============================================================================

#[tokio::test]
async fn test_get_key_details_nonexistent() {
    let driver = create_test_driver();

    let result = driver.get_key_details("nonexistent:key:xyz").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("does not exist"));
}

#[tokio::test]
async fn test_get_key_details_includes_metadata() {
    let driver = create_test_driver();
    let key = test_key("metadata");

    driver.set_key(&key, "test value", Some(60)).await.unwrap();

    let details = driver.get_key_details(&key).await.unwrap();

    // Verify all metadata fields
    assert_eq!(details.key, key);
    assert_eq!(details.key_type, "string");
    assert!(details.ttl > 0);
    assert_eq!(details.value.as_str().unwrap(), "test value");
    assert!(details.size.is_some(), "Memory size should be available");
    assert!(
        details.length.is_some(),
        "Length should be available for string"
    );
    assert!(details.encoding.is_some(), "Encoding should be available");

    cleanup_keys!(driver, &key);
}

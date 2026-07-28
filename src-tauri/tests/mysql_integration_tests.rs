use dbcooper_lib::database::mutation::MutationPlan;
use dbcooper_lib::database::mysql::MysqlDriver;
use dbcooper_lib::database::{DatabaseDriver, DatabaseType, MysqlConfig, MysqlFlavor};
use dbcooper_lib::db::models::{CreateTableColumn, CreateTableRequest, MysqlColumnModifiers};

fn driver(engine: DatabaseType, port: i64) -> MysqlDriver {
    MysqlDriver::new(MysqlConfig {
        flavor: MysqlFlavor::try_from(engine).unwrap(),
        host: "127.0.0.1".to_string(),
        port,
        database: "testdb".to_string(),
        username: "dbcooper".to_string(),
        password: "dbcooper".to_string(),
        ssl: false,
    })
}

fn column(name: &str, data_type: &str) -> CreateTableColumn {
    CreateTableColumn {
        name: name.to_string(),
        data_type: data_type.to_string(),
        nullable: true,
        primary_key: false,
        unique: false,
        default: None,
        mysql_modifiers: None,
    }
}

async fn exercise(engine: DatabaseType, port: i64) {
    let driver = driver(engine, port);
    let connection = driver.test_connection().await.unwrap();
    assert!(connection.success, "{}", connection.message);

    let table = format!("mysql_adapter_{}", uuid::Uuid::new_v4().simple());
    let mut id = column("id", "bigint");
    id.primary_key = true;
    id.nullable = false;
    id.mysql_modifiers = Some(MysqlColumnModifiers {
        unsigned: true,
        auto_increment: true,
        ..Default::default()
    });
    let mut label = column("label", "varchar");
    label.mysql_modifiers = Some(MysqlColumnModifiers {
        length: Some(191),
        ..Default::default()
    });
    let mut amount = column("amount", "decimal");
    amount.mysql_modifiers = Some(MysqlColumnModifiers {
        precision: Some(30),
        scale: Some(12),
        ..Default::default()
    });

    let request = CreateTableRequest {
        schema: "testdb".to_string(),
        name: table.clone(),
        columns: vec![id, label, amount],
    };
    driver.create_table(&request).await.unwrap();
    assert!(driver
        .list_tables()
        .await
        .unwrap()
        .iter()
        .any(|item| item.name == table));
    let insert = driver
        .execute_mutation(&MutationPlan {
            sql: format!("INSERT INTO `testdb`.`{table}` (`label`, `amount`) VALUES (?, ?)"),
            values: vec!["hello".into(), "123456789012345678.123456789012".into()],
        })
        .await
        .unwrap();
    assert_eq!(insert.rows_affected, Some(1));

    let structure = driver.get_table_structure("testdb", &table).await.unwrap();
    assert!(structure
        .columns
        .iter()
        .any(|column| column.name == "id" && column.primary_key));
    let description = driver
        .execute_query(&format!("DESC `{table}`"))
        .await
        .unwrap();
    assert!(description.error.is_none(), "{:?}", description.error);
    assert!(description.data.iter().any(|row| row["Field"] == "id"));
    let data = driver
        .get_table_data("testdb", &table, 1, 25, None, None, None)
        .await
        .unwrap();
    assert_eq!(data.total, 1);
    assert_eq!(data.data[0]["amount"], "123456789012345678.123456789012");

    let blocked = driver
        .execute_query_read_only(&format!("UPDATE `{table}` SET `label` = 'changed'"))
        .await
        .unwrap();
    assert!(blocked.error.is_some());
    let read = driver
        .execute_query_read_only(&format!("SELECT `label` FROM `{table}`"))
        .await
        .unwrap();
    assert!(read.error.is_none(), "{:?}", read.error);
    assert_eq!(read.data[0]["label"], "hello");

    let show = driver.execute_query_read_only("SHOW TABLES").await.unwrap();
    assert!(show.error.is_none(), "{:?}", show.error);
    assert!(driver
        .get_schema_overview()
        .await
        .unwrap()
        .tables
        .iter()
        .any(|item| item.name == table));

    let updated = driver
        .execute_mutation(&MutationPlan {
            sql: format!("UPDATE `{table}` SET `label` = ? WHERE `id` = ?"),
            values: vec!["updated".into(), 1.into()],
        })
        .await
        .unwrap();
    assert_eq!(updated.rows_affected, Some(1));
    let deleted = driver
        .execute_mutation(&MutationPlan {
            sql: format!("DELETE FROM `{table}` WHERE `id` = ?"),
            values: vec![1.into()],
        })
        .await
        .unwrap();
    assert_eq!(deleted.rows_affected, Some(1));

    let _ = driver.execute_query(&format!("DROP TABLE `{table}`")).await;
}

#[tokio::test]
async fn mysql_84_supports_the_full_adapter_path() {
    exercise(DatabaseType::Mysql, 3306).await;
}

#[tokio::test]
async fn mariadb_114_supports_the_full_adapter_path() {
    exercise(DatabaseType::Mariadb, 3307).await;
}

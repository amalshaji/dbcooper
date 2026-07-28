use super::{contains_keyword_outside_literals, starts_with_keyword, strip_leading_sql_comments};

pub(crate) fn query_is_safe(sql: &str) -> bool {
    let sql = strip_leading_sql_comments(sql).trim();
    let lower = sql.to_ascii_lowercase();
    if lower.contains("/*!") || lower.contains("/*m!") || has_multiple_statements(sql) {
        return false;
    }
    if !["SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN"]
        .iter()
        .any(|keyword| starts_with_keyword(sql, keyword))
    {
        return false;
    }

    ![
        "INSERT", "UPDATE", "DELETE", "REPLACE", "CREATE", "ALTER", "DROP", "TRUNCATE", "RENAME",
        "GRANT", "REVOKE", "CALL", "DO", "HANDLER", "LOAD", "OUTFILE", "DUMPFILE", "LOCK",
        "UNLOCK",
    ]
    .iter()
    .any(|keyword| contains_keyword_outside_literals(sql, keyword))
}

fn has_multiple_statements(sql: &str) -> bool {
    let mut semicolons = Vec::new();
    let mut chars = sql.char_indices().peekable();
    let mut quote = None;
    let mut line_comment = false;
    let mut block_comment = false;
    while let Some((index, ch)) = chars.next() {
        let next = chars.peek().map(|(_, value)| *value);
        if line_comment {
            if ch == '\n' {
                line_comment = false;
            }
            continue;
        }
        if block_comment {
            if ch == '*' && next == Some('/') {
                chars.next();
                block_comment = false;
            }
            continue;
        }
        if let Some(delimiter) = quote {
            if ch == delimiter {
                if next == Some(delimiter) {
                    chars.next();
                } else {
                    quote = None;
                }
            }
            continue;
        }
        if ch == '-' && next == Some('-') {
            chars.next();
            line_comment = true;
        } else if ch == '/' && next == Some('*') {
            chars.next();
            block_comment = true;
        } else if matches!(ch, '\'' | '"' | '`') {
            quote = Some(ch);
        } else if ch == ';' {
            semicolons.push(index);
        }
    }
    match semicolons.as_slice() {
        [] => false,
        [index] => *index + 1 != sql.trim_end().len(),
        _ => true,
    }
}

pub(crate) fn uses_text_protocol(sql: &str) -> bool {
    let sql = strip_leading_sql_comments(sql);
    ["SHOW", "DESCRIBE", "DESC"]
        .iter()
        .any(|keyword| starts_with_keyword(sql, keyword))
}

#[cfg(test)]
mod tests {
    use super::query_is_safe;
    use crate::database::query_returns_rows;

    #[test]
    fn accepts_reads_and_rejects_mutating_or_multi_statement_queries() {
        assert!(query_is_safe("SELECT * FROM `update`"));
        assert!(query_is_safe("WITH ids AS (SELECT 1) SELECT * FROM ids"));
        assert!(query_is_safe("SHOW TABLES;"));
        assert!(query_is_safe("SELECT ';' AS value"));
        assert!(!query_is_safe("SELECT 1; DROP TABLE users"));
        assert!(!query_is_safe(
            "WITH changed AS (UPDATE users SET name = 'x') SELECT * FROM changed"
        ));
        assert!(!query_is_safe(
            "SELECT * FROM users INTO OUTFILE '/tmp/users'"
        ));
        assert!(!query_is_safe(
            "SELECT 1 /*!50000 INTO OUTFILE '/tmp/value' */"
        ));
    }

    #[test]
    fn treats_mysql_desc_as_a_row_returning_query() {
        assert!(query_returns_rows("DESC users"));
    }
}

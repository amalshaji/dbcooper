use crate::ai::clean_generated_query;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum Action {
    Query {
        query: Value,
        #[serde(default)]
        purpose: Option<String>,
        #[serde(default)]
        inspect: Option<String>,
    },
    Describe {
        #[serde(default)]
        table: Option<String>,
        #[serde(default)]
        database: Option<String>,
        #[serde(default)]
        collection: Option<String>,
    },
    Write {
        query: Value,
        #[serde(default)]
        summary: Option<String>,
    },
    Answer {
        #[serde(default)]
        text: String,
        #[serde(default)]
        step: Option<usize>,
        #[serde(default)]
        chart: Option<Value>,
    },
}

pub fn parse_action(response: &str) -> Result<Action, String> {
    let cleaned = clean_generated_query(response);
    let start = cleaned
        .find('{')
        .ok_or_else(|| "Response did not contain a JSON object".to_string())?;
    let end = cleaned
        .rfind('}')
        .filter(|end| *end > start)
        .ok_or_else(|| "Response did not contain a complete JSON object".to_string())?;
    serde_json::from_str(&cleaned[start..=end]).map_err(|error| format!("Invalid action: {error}"))
}

/// A response with no JSON at all is treated as a plain-text answer rather
/// than a protocol violation, so a chatty model still produces something.
pub fn is_plain_text(response: &str) -> bool {
    !response.contains('{') && !response.trim().is_empty()
}

#[cfg(test)]
mod tests {
    use super::{is_plain_text, parse_action, Action};
    use serde_json::json;

    #[test]
    fn parses_query_actions_with_optional_fields() {
        let action = parse_action(
            r#"{"action":"query","query":"SELECT 1","purpose":"check","inspect":"rows"}"#,
        )
        .unwrap();
        assert_eq!(
            action,
            Action::Query {
                query: json!("SELECT 1"),
                purpose: Some("check".to_string()),
                inspect: Some("rows".to_string()),
            }
        );

        let minimal = parse_action(r#"{"action":"query","query":"SELECT 1"}"#).unwrap();
        assert!(matches!(minimal, Action::Query { inspect: None, .. }));
    }

    #[test]
    fn accepts_fenced_json_and_surrounding_prose() {
        let fenced = parse_action("```json\n{\"action\":\"answer\",\"text\":\"Done\"}\n```");
        assert!(matches!(fenced, Ok(Action::Answer { .. })));

        let prose =
            parse_action("Here you go: {\"action\":\"answer\",\"text\":\"Hi\",\"chart\":null}");
        assert_eq!(
            prose.unwrap(),
            Action::Answer {
                text: "Hi".to_string(),
                step: None,
                chart: None,
            }
        );
    }

    #[test]
    fn parses_mongo_queries_as_objects() {
        let action = parse_action(
            r#"{"action":"query","query":{"type":"find","database":"app","collection":"users","filter":{}}}"#,
        )
        .unwrap();
        let Action::Query { query, .. } = action else {
            panic!("expected query");
        };
        assert_eq!(query["collection"], "users");
    }

    #[test]
    fn rejects_unknown_actions_and_broken_json() {
        assert!(parse_action(r#"{"action":"drop_table"}"#).is_err());
        assert!(parse_action(r#"{"action":"query""#).is_err());
        assert!(parse_action("no json here").is_err());
    }

    #[test]
    fn detects_plain_text_responses() {
        assert!(is_plain_text("There are 42 users."));
        assert!(!is_plain_text("{\"action\":"));
        assert!(!is_plain_text("   "));
    }
}

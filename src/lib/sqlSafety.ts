import { parseStatements } from "./sqlParser";

export type SqlIntent = "read" | "write" | "unknown";

function maskSqlLiteralsAndComments(sql: string): string {
	let masked = "";
	let index = 0;

	const mask = (value: string) => value.replace(/[^\n]/g, " ");

	while (index < sql.length) {
		if (sql.startsWith("--", index)) {
			const end = sql.indexOf("\n", index + 2);
			const nextIndex = end < 0 ? sql.length : end;
			masked += mask(sql.slice(index, nextIndex));
			index = nextIndex;
			continue;
		}

		if (sql.startsWith("/*", index)) {
			const end = sql.indexOf("*/", index + 2);
			const nextIndex = end < 0 ? sql.length : end + 2;
			masked += mask(sql.slice(index, nextIndex));
			index = nextIndex;
			continue;
		}

		const char = sql[index];
		if (char === "'" || char === '"') {
			let end = index + 1;
			while (end < sql.length) {
				if (sql[end] === char) {
					if (sql[end + 1] === char) {
						end += 2;
						continue;
					}
					end++;
					break;
				}
				end++;
			}
			masked += mask(sql.slice(index, end));
			index = end;
			continue;
		}

		if (char === "$") {
			const tag = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
			if (tag) {
				const closingIndex = sql.indexOf(tag, index + tag.length);
				const nextIndex =
					closingIndex < 0 ? sql.length : closingIndex + tag.length;
				masked += mask(sql.slice(index, nextIndex));
				index = nextIndex;
				continue;
			}
		}

		masked += char;
		index++;
	}

	return masked;
}

function classifyStatement(sql: string): SqlIntent {
	const normalized = maskSqlLiteralsAndComments(sql).trimStart().toUpperCase();
	if (/^(SELECT|SHOW|DESCRIBE|PRAGMA|VALUES)\b/.test(normalized)) {
		return "read";
	}
	if (
		/^(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/.test(
			normalized,
		)
	) {
		return "write";
	}
	if (/^EXPLAIN\b/.test(normalized)) {
		return /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/.test(
			normalized,
		)
			? "write"
			: "read";
	}
	if (/^WITH\b/.test(normalized)) {
		return /\b(INSERT|UPDATE|DELETE|MERGE)\b/.test(normalized)
			? "write"
			: "read";
	}
	return "unknown";
}

export function classifySqlIntent(sql: string): SqlIntent {
	const statements = parseStatements(sql);
	if (statements.length === 0) return "unknown";

	const intents = statements.map((statement) =>
		classifyStatement(statement.text),
	);
	if (intents.includes("write")) return "write";
	if (intents.includes("unknown")) return "unknown";
	return "read";
}

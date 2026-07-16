export type SqlIntent = "read" | "write" | "unknown";

function stripLeadingComments(sql: string): string {
	let remaining = sql.trimStart();
	while (remaining.startsWith("--") || remaining.startsWith("/*")) {
		if (remaining.startsWith("--")) {
			const newline = remaining.indexOf("\n");
			if (newline < 0) return "";
			remaining = remaining.slice(newline + 1).trimStart();
		} else {
			const end = remaining.indexOf("*/");
			if (end < 0) return "";
			remaining = remaining.slice(end + 2).trimStart();
		}
	}
	return remaining;
}

export function classifySqlIntent(sql: string): SqlIntent {
	const normalized = stripLeadingComments(sql).toUpperCase();
	if (/^(SELECT|SHOW|DESCRIBE|PRAGMA|EXPLAIN|VALUES)\b/.test(normalized)) {
		return "read";
	}
	if (
		/^(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/.test(
			normalized,
		)
	) {
		return "write";
	}
	if (/^WITH\b/.test(normalized)) {
		return /\b(INSERT|UPDATE|DELETE|MERGE)\b/.test(normalized)
			? "write"
			: "read";
	}
	return "unknown";
}

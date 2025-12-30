/**
 * SQL Statement Parser
 * Parses SQL text to identify individual statements and find the statement at cursor position.
 */

export interface SqlStatement {
	text: string;
	startLine: number; // 0-indexed
	endLine: number; // 0-indexed
	startOffset: number; // Character offset from start of text
	endOffset: number; // Character offset from start of text
}

/**
 * Parse SQL text into individual statements.
 * Handles semicolons within string literals and comments.
 */
export function parseStatements(sql: string): SqlStatement[] {
	const statements: SqlStatement[] = [];
	const lines = sql.split("\n");

	let currentStatement = "";
	let statementStartLine = 0;
	let statementStartOffset = 0;
	let currentOffset = 0;
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let lineNum = 0; lineNum < lines.length; lineNum++) {
		const line = lines[lineNum];
		inLineComment = false; // Reset line comment at each new line

		for (let i = 0; i < line.length; i++) {
			const char = line[i];
			const nextChar = line[i + 1];
			const prevChar = line[i - 1];

			// Handle block comment start
			if (
				!inSingleQuote &&
				!inDoubleQuote &&
				!inLineComment &&
				!inBlockComment
			) {
				if (char === "/" && nextChar === "*") {
					inBlockComment = true;
					currentStatement += char;
					currentOffset++;
					continue;
				}
				// Handle line comment start
				if (char === "-" && nextChar === "-") {
					inLineComment = true;
					currentStatement += char;
					currentOffset++;
					continue;
				}
			}

			// Handle block comment end
			if (inBlockComment && char === "*" && nextChar === "/") {
				inBlockComment = false;
				currentStatement += char;
				currentOffset++;
				continue;
			}

			// Handle string quotes (not in comments)
			if (!inLineComment && !inBlockComment) {
				if (char === "'" && prevChar !== "\\" && !inDoubleQuote) {
					inSingleQuote = !inSingleQuote;
				} else if (char === '"' && prevChar !== "\\" && !inSingleQuote) {
					inDoubleQuote = !inDoubleQuote;
				}
			}

			// Handle semicolon (statement end)
			if (
				char === ";" &&
				!inSingleQuote &&
				!inDoubleQuote &&
				!inLineComment &&
				!inBlockComment
			) {
				currentStatement += char;
				const trimmed = currentStatement.trim();
				if (trimmed.length > 0) {
					statements.push({
						text: trimmed,
						startLine: statementStartLine,
						endLine: lineNum,
						startOffset: statementStartOffset,
						endOffset: currentOffset,
					});
				}
				currentOffset++;
				currentStatement = "";
				statementStartLine = lineNum;
				statementStartOffset = currentOffset + 1; // +1 for next character
				continue;
			}

			// Start of a new statement (first non-whitespace)
			if (currentStatement.trim() === "" && char.trim() !== "") {
				statementStartLine = lineNum;
				statementStartOffset = currentOffset;
			}

			currentStatement += char;
			currentOffset++;
		}

		// Add newline to current statement
		currentStatement += "\n";
		currentOffset++; // Account for newline
	}

	// Handle final statement without trailing semicolon
	const trimmed = currentStatement.trim();
	if (trimmed.length > 0) {
		statements.push({
			text: trimmed,
			startLine: statementStartLine,
			endLine: lines.length - 1,
			startOffset: statementStartOffset,
			endOffset: currentOffset - 1,
		});
	}

	return statements;
}

/**
 * Get the statement at the given cursor position.
 * @param sql The full SQL text
 * @param cursorLine 0-indexed line number
 * @param cursorChar 0-indexed character position in line
 * @returns The statement containing the cursor, or null if none found
 */
export function getStatementAtCursor(
	sql: string,
	cursorLine: number,
	_cursorChar: number,
): SqlStatement | null {
	const statements = parseStatements(sql);

	if (statements.length === 0) {
		return null;
	}

	// If only one statement, return it regardless of cursor position
	if (statements.length === 1) {
		return statements[0];
	}

	// Find the statement that contains the cursor line
	for (const statement of statements) {
		if (cursorLine >= statement.startLine && cursorLine <= statement.endLine) {
			return statement;
		}
	}

	// Cursor is not on any statement - return null (will run empty query)
	return null;
}

/**
 * Check if the SQL text contains multiple statements.
 */
export function hasMultipleStatements(sql: string): boolean {
	return parseStatements(sql).length > 1;
}

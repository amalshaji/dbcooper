interface D1QueryResult {
	success: boolean;
	results?: Record<string, unknown>[];
	meta?: Record<string, unknown>;
}

interface D1Statement {
	bind(...values: unknown[]): D1Statement;
	all(): Promise<D1QueryResult>;
}

interface Env {
	DB: {
		prepare(sql: string): D1Statement;
	};
}

function json(value: unknown, init?: ResponseInit) {
	return Response.json(value, init);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/healthz") {
			return json({ ok: true });
		}

		if (request.headers.get("authorization") !== "Bearer local-token") {
			return json(
				{
					success: false,
					errors: [{ code: 7500, message: "Authentication error" }],
					messages: [],
					result: [],
				},
				{ status: 401 },
			);
		}

		if (
			request.method === "GET" &&
			url.pathname === "/client/v4/accounts/local-account/d1/database"
		) {
			return json({
				success: true,
				errors: [],
				messages: [],
				result: [{ uuid: "local-database", name: "Local D1" }],
				result_info: { page: 1, total_pages: 1 },
			});
		}

		if (
			request.method !== "POST" ||
			url.pathname !==
				"/client/v4/accounts/local-account/d1/database/local-database/query"
		) {
			return json({ success: false, errors: [], result: [] }, { status: 404 });
		}

		try {
			const body = (await request.json()) as {
				sql: string;
				params?: unknown[];
			};
			const statement = env.DB.prepare(body.sql);
			const result = await statement.bind(...(body.params || [])).all();
			return json({
				success: true,
				errors: [],
				messages: [],
				result: [
					{
						success: result.success,
						results: result.results || [],
						meta: result.meta || {},
					},
				],
			});
		} catch (error) {
			return json(
				{
					success: false,
					errors: [
						{
							code: 7500,
							message: error instanceof Error ? error.message : String(error),
						},
					],
					messages: [],
					result: [],
				},
				{ status: 400 },
			);
		}
	},
};

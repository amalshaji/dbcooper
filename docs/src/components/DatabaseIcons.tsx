import { PostgresqlIcon } from "../icons/postgres";
import { SqliteIcon } from "../icons/sqlite";
import { RedisIcon } from "../icons/redis";
import { ClickhouseIcon } from "../icons/clickhouse";

const dbs = [
	{ Icon: PostgresqlIcon, name: "PostgreSQL" },
	{ Icon: SqliteIcon, name: "SQLite" },
	{ Icon: RedisIcon, name: "Redis" },
	{ Icon: ClickhouseIcon, name: "ClickHouse" },
];

export function DatabaseIcons() {
	return (
		<div className="flex flex-wrap items-center gap-x-7 gap-y-3">
			{dbs.map(({ Icon, name }) => (
				<div
					key={name}
					className="group flex items-center gap-2 text-soft hover:text-ink transition-colors"
				>
					<Icon className="w-5 h-5 grayscale opacity-60 group-hover:grayscale-0 group-hover:opacity-100 transition-all" />
					<span className="font-mono text-sm">{name}</span>
				</div>
			))}
		</div>
	);
}

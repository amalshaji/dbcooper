import { PostgresqlIcon } from "../icons/postgres";
import { SqliteIcon } from "../icons/sqlite";
import { RedisIcon } from "../icons/redis";
import { ClickhouseIcon } from "../icons/clickhouse";

export function DatabaseIcons() {
    return (
        <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1">
                <PostgresqlIcon className="w-4 h-4" />
                <span>PostgreSQL</span>
            </div>
            <div className="flex items-center gap-1">
                <SqliteIcon className="w-4 h-4" />
                <span>SQLite</span>
            </div>
            <div className="flex items-center gap-1">
                <RedisIcon className="w-4 h-4" />
                <span>Redis</span>
            </div>
            <div className="flex items-center gap-1">
                <ClickhouseIcon className="w-4 h-4" />
                <span>ClickHouse</span>
            </div>
        </div>
    );
}

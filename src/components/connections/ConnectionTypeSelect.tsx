import type { ReactNode } from "react";
import { ClickhouseIcon } from "@/components/icons/clickhouse";
import { CloudflareIcon } from "@/components/icons/cloudflare";
import { DuckdbIcon } from "@/components/icons/duckdb";
import { MariadbIcon } from "@/components/icons/mariadb";
import { MongodbIcon } from "@/components/icons/mongodb";
import { MysqlIcon } from "@/components/icons/mysql";
import { PostgresqlIcon } from "@/components/icons/postgres";
import { RedisIcon } from "@/components/icons/redis";
import { SqliteIcon } from "@/components/icons/sqlite";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
} from "@/components/ui/select";
import {
	CONNECTION_TYPES,
	getConnectionCapabilities,
} from "@/lib/connectionCapabilities";
import type { ConnectionType } from "@/types/connection";

const icons: Record<ConnectionType, ReactNode> = {
	postgres: <PostgresqlIcon className="size-4" />,
	mysql: <MysqlIcon className="size-4" />,
	mariadb: <MariadbIcon className="size-4" />,
	sqlite: <SqliteIcon className="size-4" />,
	duckdb: <DuckdbIcon className="size-4" />,
	redis: <RedisIcon className="size-4" />,
	clickhouse: <ClickhouseIcon className="size-4" />,
	mongodb: <MongodbIcon className="size-4 text-[#00a35c]" />,
	d1: <CloudflareIcon className="h-3.5 w-5" />,
};

export function ConnectionTypeSelect({
	value,
	onValueChange,
}: {
	value: ConnectionType;
	onValueChange: (value: ConnectionType) => void;
}) {
	const selected = getConnectionCapabilities(value);
	return (
		<Select
			items={CONNECTION_TYPES.map((type) => ({
				value: type,
				label: getConnectionCapabilities(type).label,
			}))}
			value={value}
			onValueChange={(next) => onValueChange(next as ConnectionType)}
		>
			<SelectTrigger id="connection-type">
				<div className="flex items-center gap-2">
					{icons[value]}
					<span>{selected.label}</span>
				</div>
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					{CONNECTION_TYPES.map((type) => (
						<SelectItem key={type} value={type}>
							<div className="flex items-center gap-2">
								{icons[type]}
								<span>{getConnectionCapabilities(type).label}</span>
							</div>
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}

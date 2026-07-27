import { useEffect, useState } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { D1DatabaseList } from "@/lib/tauri";

interface D1ConnectionFieldsProps {
	accountId: string;
	apiToken: string;
	databaseId: string;
	onChange: (values: {
		accountId?: string;
		apiToken?: string;
		databaseId?: string;
	}) => void;
	listDatabases: (
		accountId: string,
		apiToken: string,
		page: number,
	) => Promise<D1DatabaseList>;
}

export function D1ConnectionFields({
	accountId,
	apiToken,
	databaseId,
	onChange,
	listDatabases,
}: D1ConnectionFieldsProps) {
	const [showToken, setShowToken] = useState(false);
	const [databases, setDatabases] = useState<D1DatabaseList["databases"]>([]);
	const [page, setPage] = useState(0);
	const [totalPages, setTotalPages] = useState(0);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setDatabases([]);
		setPage(0);
		setTotalPages(0);
		setError(null);
	}, [accountId, apiToken]);

	const loadDatabases = async (nextPage: number) => {
		setIsLoading(true);
		setError(null);
		try {
			const result = await listDatabases(accountId, apiToken, nextPage);
			setDatabases((current) =>
				nextPage === 1 ? result.databases : [...current, ...result.databases],
			);
			setPage(result.page);
			setTotalPages(result.total_pages);
		} catch (loadError) {
			setError(
				loadError instanceof Error
					? loadError.message
					: "Could not load D1 databases",
			);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<>
			<Field>
				<FieldLabel htmlFor="connection-account-id">
					Cloudflare Account ID
				</FieldLabel>
				<Input
					id="connection-account-id"
					required
					value={accountId}
					onChange={(event) => onChange({ accountId: event.target.value })}
					placeholder="Account ID"
				/>
			</Field>

			<Field>
				<FieldLabel htmlFor="connection-api-token">
					Cloudflare API Token
				</FieldLabel>
				<div className="relative">
					<Input
						id="connection-api-token"
						type={showToken ? "text" : "password"}
						required
						value={apiToken}
						onChange={(event) => onChange({ apiToken: event.target.value })}
						placeholder="Token with D1 Read or D1 Write permission"
						className="pr-10"
					/>
					<button
						type="button"
						onClick={() => setShowToken((visible) => !visible)}
						aria-label={showToken ? "Hide API token" : "Show API token"}
						className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
					>
						{showToken ? (
							<EyeSlash className="size-3" />
						) : (
							<Eye className="size-3" />
						)}
					</button>
				</div>
			</Field>

			<Field>
				<div className="flex items-center justify-between gap-3">
					<FieldLabel htmlFor="connection-database">Database ID</FieldLabel>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={!accountId || !apiToken || isLoading}
						onClick={() => loadDatabases(1)}
					>
						{isLoading && <Spinner />}
						Load databases
					</Button>
				</div>
				<Input
					id="connection-database"
					required
					value={databaseId}
					onChange={(event) => onChange({ databaseId: event.target.value })}
					placeholder="D1 database UUID"
				/>
				{databases.length > 0 && (
					<Select
						items={databases.map((database) => ({
							value: database.uuid,
							label: database.name,
						}))}
						value={
							databases.some((database) => database.uuid === databaseId)
								? databaseId
								: null
						}
						onValueChange={(value) => value && onChange({ databaseId: value })}
					>
						<SelectTrigger
							className="w-full"
							aria-label="Available D1 databases"
						>
							<span className="truncate">Choose a loaded database</span>
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{databases.map((database) => (
									<SelectItem key={database.uuid} value={database.uuid}>
										<span className="truncate">{database.name}</span>
										<span className="text-muted-foreground">
											{database.uuid}
										</span>
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				)}
				{page < totalPages && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={isLoading}
						onClick={() => loadDatabases(page + 1)}
					>
						{isLoading && <Spinner />}
						Load more
					</Button>
				)}
				{error && (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				)}
			</Field>
		</>
	);
}

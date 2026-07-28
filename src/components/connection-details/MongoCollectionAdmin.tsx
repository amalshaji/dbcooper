import { json } from "@codemirror/lang-json";
import { Plus, Trash } from "@phosphor-icons/react";
import CodeMirror from "@uiw/react-codemirror";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
	api,
	type MongoIndexInfo,
	type MongoValidatorSettings,
} from "@/lib/tauri";

interface MongoCollectionAdminProps {
	uuid: string;
	database: string;
	collection: string;
	view: "indexes" | "validation";
}

export function MongoCollectionAdmin({
	uuid,
	database,
	collection,
	view,
}: MongoCollectionAdminProps) {
	const [indexes, setIndexes] = useState<MongoIndexInfo[]>([]);
	const [indexField, setIndexField] = useState("");
	const [indexDirection, setIndexDirection] = useState<1 | -1>(1);
	const [indexName, setIndexName] = useState("");
	const [unique, setUnique] = useState(false);
	const [sparse, setSparse] = useState(false);
	const [ttl, setTtl] = useState("");
	const [validatorText, setValidatorText] = useState("{}");
	const [validationLevel, setValidationLevel] =
		useState<MongoValidatorSettings["validation_level"]>("strict");
	const [validationAction, setValidationAction] =
		useState<MongoValidatorSettings["validation_action"]>("error");
	const [loading, setLoading] = useState(false);
	const jsonExtension = useMemo(() => [json()], []);

	const loadIndexes = useCallback(async () => {
		if (!collection) return;
		setLoading(true);
		try {
			setIndexes(await api.mongo.listIndexes(uuid, database, collection));
		} catch (error) {
			toast.error("Could not load indexes", { description: String(error) });
		} finally {
			setLoading(false);
		}
	}, [collection, database, uuid]);

	const loadValidator = useCallback(async () => {
		if (!collection) return;
		setLoading(true);
		try {
			const settings = await api.mongo.getValidator(uuid, database, collection);
			setValidatorText(JSON.stringify(settings.validator, null, 2));
			setValidationLevel(settings.validation_level);
			setValidationAction(settings.validation_action);
		} catch (error) {
			toast.error("Could not load validator", { description: String(error) });
		} finally {
			setLoading(false);
		}
	}, [collection, database, uuid]);

	useEffect(() => {
		void (view === "indexes" ? loadIndexes() : loadValidator());
	}, [loadIndexes, loadValidator, view]);

	const createIndex = async () => {
		if (!indexField.trim()) return toast.error("Enter an index field");
		setLoading(true);
		try {
			await api.mongo.createIndex(uuid, {
				database,
				collection,
				keys: [{ field: indexField.trim(), direction: indexDirection }],
				name: indexName.trim() || undefined,
				unique,
				sparse,
				expire_after_seconds: ttl ? Number(ttl) : undefined,
			});
			setIndexField("");
			setIndexName("");
			setTtl("");
			await loadIndexes();
			toast.success("Index created");
		} catch (error) {
			toast.error("Could not create index", { description: String(error) });
		} finally {
			setLoading(false);
		}
	};

	if (!collection)
		return (
			<div className="p-6 text-sm text-muted-foreground">
				Select a collection.
			</div>
		);

	if (view === "indexes") {
		return (
			<div className="min-h-0 flex-1 overflow-auto p-4">
				<div className="mb-4 flex items-end gap-2 rounded-lg border bg-card p-3">
					<label className="flex-1 text-xs text-muted-foreground">
						Field
						<Input
							className="mt-1"
							value={indexField}
							onChange={(e) => setIndexField(e.target.value)}
							placeholder="createdAt"
						/>
					</label>
					<label className="w-32 text-xs text-muted-foreground">
						Direction
						<select
							className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
							value={indexDirection}
							onChange={(e) =>
								setIndexDirection(Number(e.target.value) as 1 | -1)
							}
						>
							<option value={1}>Ascending</option>
							<option value={-1}>Descending</option>
						</select>
					</label>
					<label className="flex-1 text-xs text-muted-foreground">
						Name
						<Input
							className="mt-1"
							value={indexName}
							onChange={(e) => setIndexName(e.target.value)}
							placeholder="Optional"
						/>
					</label>
					<label className="w-28 text-xs text-muted-foreground">
						TTL seconds
						<Input
							className="mt-1"
							type="number"
							min={0}
							value={ttl}
							onChange={(e) => setTtl(e.target.value)}
						/>
					</label>
					<label className="flex items-center gap-2 pb-2 text-sm">
						<Switch checked={unique} onCheckedChange={setUnique} />
						Unique
					</label>
					<label className="flex items-center gap-2 pb-2 text-sm">
						<Switch checked={sparse} onCheckedChange={setSparse} />
						Sparse
					</label>
					<Button onClick={() => void createIndex()} disabled={loading}>
						{loading && <Spinner />}
						<Plus />
						Create
					</Button>
				</div>
				<div className="overflow-hidden rounded-lg border">
					{indexes.map((index) => (
						<div
							key={index.name}
							className="flex items-center gap-3 border-b p-3 last:border-0"
						>
							<div className="min-w-0 flex-1">
								<div className="font-medium">{index.name}</div>
								<code className="text-xs text-muted-foreground">
									{JSON.stringify(index.keys)}
								</code>
							</div>
							<div className="text-xs text-muted-foreground">
								{[
									index.unique && "unique",
									index.sparse && "sparse",
									index.expire_after_seconds != null &&
										`TTL ${index.expire_after_seconds}s`,
								]
									.filter(Boolean)
									.join(" · ")}
							</div>
							<Button
								size="icon-sm"
								variant="ghost"
								disabled={index.name === "_id_"}
								onClick={async () => {
									if (!window.confirm(`Drop index ${index.name}?`)) return;
									try {
										await api.mongo.dropIndex(
											uuid,
											database,
											collection,
											index.name,
										);
										await loadIndexes();
										toast.success("Index dropped");
									} catch (error) {
										toast.error("Could not drop index", {
											description: String(error),
										});
									}
								}}
								aria-label={`Drop ${index.name}`}
							>
								<Trash />
							</Button>
						</div>
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col p-4">
			<div className="mb-3 flex items-end gap-3">
				<label className="text-xs text-muted-foreground">
					Validation level
					<select
						className="mt-1 block h-9 rounded-md border bg-background px-3 text-sm"
						value={validationLevel}
						onChange={(e) =>
							setValidationLevel(
								e.target.value as MongoValidatorSettings["validation_level"],
							)
						}
					>
						<option value="off">Off</option>
						<option value="strict">Strict</option>
						<option value="moderate">Moderate</option>
					</select>
				</label>
				<label className="text-xs text-muted-foreground">
					Validation action
					<select
						className="mt-1 block h-9 rounded-md border bg-background px-3 text-sm"
						value={validationAction}
						onChange={(e) =>
							setValidationAction(
								e.target.value as MongoValidatorSettings["validation_action"],
							)
						}
					>
						<option value="error">Error</option>
						<option value="warn">Warn</option>
					</select>
				</label>
				<Button
					className="ml-auto"
					disabled={loading}
					onClick={async () => {
						if (
							!window.confirm(
								`Update validation rules for ${database}.${collection}?`,
							)
						)
							return;
						try {
							const validator = JSON.parse(validatorText) as Record<
								string,
								unknown
							>;
							await api.mongo.setValidator(uuid, {
								database,
								collection,
								validator,
								validation_level: validationLevel,
								validation_action: validationAction,
							});
							toast.success("Validator updated");
						} catch (error) {
							toast.error("Could not update validator", {
								description: String(error),
							});
						}
					}}
				>
					{loading && <Spinner />}Save validator
				</Button>
			</div>
			<div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
				<CodeMirror
					value={validatorText}
					height="100%"
					extensions={jsonExtension}
					onChange={setValidatorText}
				/>
			</div>
		</div>
	);
}

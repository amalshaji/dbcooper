import { Plus, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { MongoJsonEditor } from "@/components/connection-details/MongoJsonEditor";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
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
	const [indexToDrop, setIndexToDrop] = useState<string | null>(null);

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

	const dropIndex = async () => {
		if (!indexToDrop) return;
		setLoading(true);
		try {
			await api.mongo.dropIndex(uuid, database, collection, indexToDrop);
			setIndexToDrop(null);
			await loadIndexes();
			toast.success("Index dropped");
		} catch (error) {
			toast.error("Could not drop index", { description: String(error) });
		} finally {
			setLoading(false);
		}
	};

	const saveValidator = async () => {
		setLoading(true);
		try {
			const validator = JSON.parse(validatorText) as Record<string, unknown>;
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
			<div className="min-h-0 flex-1 overflow-auto bg-muted/15 p-4">
				<div className="mb-4 rounded-xl border bg-card p-4 shadow-sm">
					<div className="mb-3">
						<h2 className="text-sm font-semibold">Create index</h2>
						<p className="mt-0.5 text-xs text-muted-foreground">
							Add a single-field index to {database}.{collection}.
						</p>
					</div>
					<div className="grid grid-cols-[minmax(150px,1fr)_140px_minmax(150px,1fr)_110px_auto] items-end gap-3">
						<div className="space-y-1.5">
							<Label htmlFor="mongo-index-field">Field</Label>
							<Input
								id="mongo-index-field"
								value={indexField}
								onChange={(e) => setIndexField(e.target.value)}
								placeholder="createdAt"
							/>
						</div>
						<div className="space-y-1.5">
							<Label>Direction</Label>
							<Select
								value={indexDirection}
								onValueChange={(value) =>
									setIndexDirection(Number(value) as 1 | -1)
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={1}>Ascending</SelectItem>
									<SelectItem value={-1}>Descending</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="mongo-index-name">Name</Label>
							<Input
								id="mongo-index-name"
								value={indexName}
								onChange={(e) => setIndexName(e.target.value)}
								placeholder="Optional"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="mongo-index-ttl">TTL seconds</Label>
							<Input
								id="mongo-index-ttl"
								type="number"
								min={0}
								value={ttl}
								onChange={(e) => setTtl(e.target.value)}
							/>
						</div>
						<div className="flex h-8 items-center gap-4">
							<Label className="gap-2">
								<Switch
									size="sm"
									checked={unique}
									onCheckedChange={setUnique}
								/>
								Unique
							</Label>
							<Label className="gap-2">
								<Switch
									size="sm"
									checked={sparse}
									onCheckedChange={setSparse}
								/>
								Sparse
							</Label>
						</div>
					</div>
					<div className="mt-3 flex justify-end">
						<Button
							size="sm"
							onClick={() => void createIndex()}
							disabled={loading}
						>
							{loading && <Spinner />}
							<Plus />
							Create index
						</Button>
					</div>
				</div>
				<div className="overflow-hidden rounded-xl border bg-card shadow-sm">
					<div className="border-b px-4 py-3">
						<h2 className="text-sm font-semibold">Indexes</h2>
					</div>
					{!loading && indexes.length === 0 && (
						<div className="p-8 text-center text-xs text-muted-foreground">
							No indexes found
						</div>
					)}
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
								onClick={() => setIndexToDrop(index.name)}
								aria-label={`Drop ${index.name}`}
							>
								<Trash />
							</Button>
						</div>
					))}
				</div>
				<AlertDialog
					open={indexToDrop !== null}
					onOpenChange={(open) => !open && setIndexToDrop(null)}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Drop “{indexToDrop}”?</AlertDialogTitle>
							<AlertDialogDescription>
								Queries that rely on this index may become slower.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								disabled={loading}
								onClick={() => void dropIndex()}
							>
								{loading && <Spinner />} Drop index
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-muted/15 p-4">
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
				<div className="flex items-end gap-3 border-b p-4">
					<div className="space-y-1.5">
						<Label>Validation level</Label>
						<Select
							value={validationLevel}
							onValueChange={(value) =>
								setValidationLevel(
									value as MongoValidatorSettings["validation_level"],
								)
							}
						>
							<SelectTrigger className="w-36">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="off">Off</SelectItem>
								<SelectItem value="strict">Strict</SelectItem>
								<SelectItem value="moderate">Moderate</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-1.5">
						<Label>Validation action</Label>
						<Select
							value={validationAction}
							onValueChange={(value) =>
								setValidationAction(
									value as MongoValidatorSettings["validation_action"],
								)
							}
						>
							<SelectTrigger className="w-36">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="error">Error</SelectItem>
								<SelectItem value="warn">Warn</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<Button
						className="ml-auto"
						size="sm"
						disabled={loading}
						onClick={() => void saveValidator()}
					>
						{loading && <Spinner />} Save validator
					</Button>
				</div>
				<MongoJsonEditor
					className="h-0 min-h-0 flex-1 rounded-none border-0"
					value={validatorText}
					height="100%"
					onChange={setValidatorText}
					ariaLabel="Collection validator"
				/>
			</div>
		</div>
	);
}

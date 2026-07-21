import { useReducer } from "react";
import { ArrowLeft, Table } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import {
	buildCreateTableRequest,
	createInitialTableDraft,
	type CreateTableDbType,
	type CreateTableDraft,
	getCreateTableValidationError,
} from "../lib/createTableForm";
import type { CreateTableRequest, TableInfo } from "../lib/tauri";
import { CreateTableDefinition } from "./CreateTableDefinition";

interface CreateTableSheetProps {
	dbType: CreateTableDbType;
	initialSchema?: string;
	availableSchemas: string[];
	onClose: () => void;
	onPreview: (request: CreateTableRequest) => Promise<string>;
	onCreate: (request: CreateTableRequest) => Promise<TableInfo>;
	onCreated: (table: TableInfo) => void;
}

interface CreateTableSession {
	draft: CreateTableDraft;
	step: "definition" | "review";
	previewSql: string;
	error: string | null;
	status: "idle" | "previewing" | "creating";
}

type CreateTableSessionAction =
	| { type: "draftChanged"; draft: CreateTableDraft }
	| { type: "previewStarted" }
	| { type: "previewSucceeded"; sql: string }
	| { type: "createStarted" }
	| { type: "failed"; error: string }
	| { type: "back" };

function reduceCreateTableSession(
	state: CreateTableSession,
	action: CreateTableSessionAction,
): CreateTableSession {
	switch (action.type) {
		case "draftChanged":
			return { ...state, draft: action.draft, error: null };
		case "previewStarted":
			return { ...state, status: "previewing", error: null };
		case "previewSucceeded":
			return {
				...state,
				step: "review",
				previewSql: action.sql,
				status: "idle",
			};
		case "createStarted":
			return { ...state, status: "creating", error: null };
		case "failed":
			return { ...state, status: "idle", error: action.error };
		case "back":
			return { ...state, step: "definition", error: null };
	}
}

export function CreateTableSheet({
	dbType,
	initialSchema,
	availableSchemas,
	onClose,
	onPreview,
	onCreate,
	onCreated,
}: CreateTableSheetProps) {
	const [session, dispatch] = useReducer(
		reduceCreateTableSession,
		null,
		(): CreateTableSession => ({
			draft: createInitialTableDraft(dbType, initialSchema),
			step: "definition",
			previewSql: "",
			error: null,
			status: "idle",
		}),
	);
	const { draft, step, previewSql, error, status } = session;
	const previewing = status === "previewing";
	const creating = status === "creating";

	const handleReview = async () => {
		const validationError = getCreateTableValidationError(draft, dbType);
		if (validationError) {
			dispatch({ type: "failed", error: validationError });
			return;
		}

		dispatch({ type: "previewStarted" });
		try {
			const sql = await onPreview(buildCreateTableRequest(draft, dbType));
			dispatch({ type: "previewSucceeded", sql });
		} catch (previewError) {
			dispatch({
				type: "failed",
				error:
					previewError instanceof Error
					? previewError.message
					: String(previewError),
			});
		}
	};

	const handleCreate = async () => {
		if (creating) return;
		dispatch({ type: "createStarted" });

		let createdTable: TableInfo;
		try {
			createdTable = await onCreate(buildCreateTableRequest(draft, dbType));
		} catch (createError) {
			dispatch({
				type: "failed",
				error:
					createError instanceof Error
						? createError.message
					: String(createError),
			});
			return;
		}

		onClose();
		onCreated(createdTable);
	};

	return (
		<Sheet
			open
			onOpenChange={(nextOpen) => {
				if (!nextOpen && !creating) onClose();
			}}
		>
			<SheetContent
				side="right"
				className="w-full overflow-hidden sm:max-w-2xl"
				showCloseButton={!creating}
			>
				<SheetHeader>
					<SheetTitle>Create table</SheetTitle>
					<SheetDescription>
						{step === "definition"
							? "Define columns and constraints, then review the generated SQL."
							: "Review the exact SQL before it runs once."}
					</SheetDescription>
				</SheetHeader>

				<div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
					{step === "definition" ? (
						<CreateTableDefinition
							draft={draft}
							dbType={dbType}
							availableSchemas={availableSchemas}
							onChange={(nextDraft) =>
								dispatch({ type: "draftChanged", draft: nextDraft })
							}
						/>
					) : (
						<div className="space-y-3">
							<div>
								<h3 className="text-sm font-medium">Generated SQL</h3>
								<p className="text-xs text-muted-foreground">
									This statement is regenerated from the definition when created.
								</p>
							</div>
							<pre
								aria-label="Generated SQL"
								className="overflow-x-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed select-text"
							>
								{previewSql}
							</pre>
						</div>
					)}

					{error && (
						<div
							role="alert"
							className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
						>
							{error}
						</div>
					)}
				</div>

				<SheetFooter className="flex-row justify-end border-t">
					{step === "review" && (
						<Button
							type="button"
							variant="outline"
							disabled={creating}
							onClick={() => dispatch({ type: "back" })}
						>
							<ArrowLeft />
							Back
						</Button>
					)}
					<Button
						type="button"
						variant="ghost"
						disabled={creating || previewing}
						onClick={onClose}
					>
						Cancel
					</Button>
					{step === "definition" ? (
						<Button
							type="button"
							disabled={previewing}
							onClick={() => void handleReview()}
						>
							{previewing ? <Spinner /> : null}
							Review SQL
						</Button>
					) : (
						<Button
							type="button"
							disabled={creating}
							onClick={() => void handleCreate()}
						>
							{creating ? <Spinner /> : <Table />}
							Create table
						</Button>
					)}
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

import { useEffect, useState } from "react";
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
import { CreateTableReview } from "./CreateTableReview";

interface CreateTableSheetProps {
	open: boolean;
	dbType: CreateTableDbType;
	initialSchema?: string;
	availableSchemas: string[];
	onOpenChange: (open: boolean) => void;
	onPreview: (request: CreateTableRequest) => Promise<string>;
	onCreate: (request: CreateTableRequest) => Promise<TableInfo>;
	onCreated: (table: TableInfo) => void;
}

interface CreateTableActionButtonProps {
	creating: boolean;
	onClick: () => void;
}

export function CreateTableActionButton({
	creating,
	onClick,
}: CreateTableActionButtonProps) {
	return (
		<Button type="button" disabled={creating} onClick={onClick}>
			{creating ? <Spinner /> : <Table />}
			Create table
		</Button>
	);
}

export function CreateTableSheet({
	open,
	dbType,
	initialSchema,
	availableSchemas,
	onOpenChange,
	onPreview,
	onCreate,
	onCreated,
}: CreateTableSheetProps) {
	const [draft, setDraft] = useState<CreateTableDraft>(() =>
		createInitialTableDraft(dbType, initialSchema),
	);
	const [step, setStep] = useState<"definition" | "review">("definition");
	const [previewSql, setPreviewSql] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [previewing, setPreviewing] = useState(false);
	const [creating, setCreating] = useState(false);

	useEffect(() => {
		if (!open) return;
		setDraft(createInitialTableDraft(dbType, initialSchema));
		setStep("definition");
		setPreviewSql("");
		setError(null);
		setPreviewing(false);
		setCreating(false);
	}, [open, dbType, initialSchema]);

	const handleReview = async () => {
		const validationError = getCreateTableValidationError(draft, dbType);
		if (validationError) {
			setError(validationError);
			return;
		}

		setPreviewing(true);
		setError(null);
		try {
			const sql = await onPreview(buildCreateTableRequest(draft, dbType));
			setPreviewSql(sql);
			setStep("review");
		} catch (previewError) {
			setError(
				previewError instanceof Error
					? previewError.message
					: String(previewError),
			);
		} finally {
			setPreviewing(false);
		}
	};

	const handleCreate = async () => {
		setCreating(true);
		setError(null);

		let createdTable: TableInfo;
		try {
			createdTable = await onCreate(buildCreateTableRequest(draft, dbType));
		} catch (createError) {
			setError(
				createError instanceof Error ? createError.message : String(createError),
			);
			setCreating(false);
			return;
		}

		onOpenChange(false);
		onCreated(createdTable);
	};

	return (
		<Sheet
			open={open}
			onOpenChange={(nextOpen) => {
				if (!creating) onOpenChange(nextOpen);
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
							onChange={setDraft}
							onClearError={() => setError(null)}
						/>
					) : (
						<CreateTableReview sql={previewSql} />
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
							onClick={() => {
								setStep("definition");
								setError(null);
							}}
						>
							<ArrowLeft />
							Back
						</Button>
					)}
					<Button
						type="button"
						variant="ghost"
						disabled={creating || previewing}
						onClick={() => onOpenChange(false)}
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
						<CreateTableActionButton
							creating={creating}
							onClick={() => void handleCreate()}
						/>
					)}
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

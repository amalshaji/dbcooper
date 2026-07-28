import { FilePlus, FloppyDisk, Trash } from "@phosphor-icons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useState } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import type { MongoWorkbenchController } from "@/hooks/connection-details/useMongoWorkbench";
import type { JsonObject } from "@/lib/mongo/querySpec";

function documentSummary(document: JsonObject) {
	return Object.entries(document)
		.slice(0, 3)
		.map(
			([key, value]) =>
				`${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
		)
		.join(" · ");
}

export function MongoDocumentBrowser({
	workbench,
}: {
	workbench: MongoWorkbenchController;
}) {
	const [inspectorWidth, setInspectorWidth] = useState(440);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);
	// TanStack Virtual intentionally returns non-memoizable functions.
	// eslint-disable-next-line react-hooks/incompatible-library
	const virtualizer = useVirtualizer({
		count: workbench.result?.documents.length ?? 0,
		getScrollElement: () => listRef.current,
		estimateSize: () => 58,
		overscan: 8,
	});

	const beginResize = (event: React.PointerEvent) => {
		const startX = event.clientX;
		const startWidth = inspectorWidth;
		const move = (next: PointerEvent) =>
			setInspectorWidth(
				Math.min(720, Math.max(300, startWidth + startX - next.clientX)),
			);
		const stop = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", stop);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", stop);
	};

	const deleteDocument = async () => {
		if (workbench.selectedDocument?._id === undefined) return;
		await workbench.actions.deleteDocument();
		setDeleteDialogOpen(false);
	};

	return (
		<div className="flex min-h-0 flex-1 bg-muted/10">
			<section
				ref={listRef}
				className="min-w-0 flex-1 overflow-auto bg-background"
			>
				<div className="sticky top-0 z-10 flex h-10 items-center border-b bg-background/95 px-3 text-xs text-muted-foreground backdrop-blur">
					{workbench.result
						? `${workbench.result.returned_count} documents${workbench.result.has_more ? "+" : ""} · ${workbench.result.execution_time_ms} ms`
						: "Run a query to browse documents"}
					<Button
						className="ml-auto"
						size="xs"
						variant="ghost"
						disabled={!workbench.namespace.collection}
						onClick={workbench.actions.beginDocument}
					>
						<FilePlus />
						New document
					</Button>
				</div>
				{workbench.result && workbench.result.documents.length === 0 && (
					<div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
						No documents matched this query
					</div>
				)}
				<div
					className="relative"
					style={{ height: virtualizer.getTotalSize() }}
				>
					{virtualizer.getVirtualItems().map((row) => {
						const document = workbench.result?.documents[row.index];
						if (!document) return null;
						return (
							<button
								key={row.key}
								className={`absolute left-0 top-0 w-full border-b px-3 py-2 text-left transition-colors hover:bg-accent/60 ${workbench.inspector.selectedIndex === row.index ? "bg-emerald-500/[0.07] shadow-[inset_2px_0_0_theme(colors.emerald.500)]" : ""}`}
								style={{
									height: row.size,
									transform: `translateY(${row.start}px)`,
								}}
								onClick={() => workbench.actions.selectDocument(row.index)}
							>
								<div className="truncate font-mono text-xs">
									{documentSummary(document)}
								</div>
								<div className="mt-1 truncate text-[11px] text-muted-foreground">
									{JSON.stringify(document._id ?? "No _id")}
								</div>
							</button>
						);
					})}
				</div>
			</section>
			<div
				role="separator"
				aria-label="Resize document inspector"
				aria-orientation="vertical"
				tabIndex={0}
				className="w-1 cursor-col-resize bg-border transition-colors hover:bg-emerald-500/50 focus:bg-emerald-500/50 focus:outline-none"
				onPointerDown={beginResize}
				onKeyDown={(event) => {
					if (event.key === "ArrowLeft") {
						setInspectorWidth((value) => Math.min(720, value + 20));
					}
					if (event.key === "ArrowRight") {
						setInspectorWidth((value) => Math.max(300, value - 20));
					}
				}}
			/>
			<aside
				className="flex shrink-0 flex-col overflow-hidden bg-card"
				style={{ width: inspectorWidth }}
			>
				<div className="flex h-10 items-center gap-1.5 border-b px-3 text-sm font-medium">
					{workbench.inspector.isNew
						? "New document"
						: workbench.selectedDocument
							? "Document"
							: "Inspector"}
					{(workbench.inspector.isNew || workbench.selectedDocument) && (
						<>
							<Button
								className="ml-auto"
								size="xs"
								disabled={workbench.loading}
								onClick={() => void workbench.actions.saveDocument()}
							>
								{workbench.loading && <Spinner />}
								<FloppyDisk />
								{workbench.inspector.isNew ? "Insert" : "Save"}
							</Button>
							{workbench.selectedDocument && (
								<Button
									size="icon-xs"
									variant="ghost"
									className="text-destructive hover:bg-destructive/10 hover:text-destructive"
									onClick={() => setDeleteDialogOpen(true)}
									aria-label="Delete document"
								>
									<Trash />
								</Button>
							)}
						</>
					)}
				</div>
				<MongoJsonEditor
					className="min-h-0 flex-1 rounded-none border-0"
					value={workbench.inspector.documentText}
					height="100%"
					onChange={workbench.actions.setDocumentText}
					editable={
						workbench.inspector.isNew || Boolean(workbench.selectedDocument)
					}
					ariaLabel="MongoDB document"
				/>
			</aside>

			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this document?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently removes document{" "}
							{JSON.stringify(workbench.selectedDocument?._id)}.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={workbench.loading}
							onClick={() => void deleteDocument()}
						>
							{workbench.loading && <Spinner />} Delete document
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

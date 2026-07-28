import { json } from "@codemirror/lang-json";
import { FilePlus, FloppyDisk, Trash } from "@phosphor-icons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
	const listRef = useRef<HTMLDivElement>(null);
	const extensions = useMemo(() => [json()], []);
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
		const id = workbench.selectedDocument?._id;
		if (id === undefined || !window.confirm(`Delete document ${JSON.stringify(id)}?`)) {
			return;
		}
		await workbench.actions.deleteDocument();
	};

	return (
		<div className="flex min-h-0 flex-1">
			<section ref={listRef} className="min-w-0 flex-1 overflow-auto">
				<div className="sticky top-0 z-10 flex h-10 items-center border-b bg-background px-3 text-xs text-muted-foreground">
					{workbench.result
						? `${workbench.result.returned_count} documents${workbench.result.has_more ? "+" : ""} · ${workbench.result.execution_time_ms} ms`
						: "Run a query to browse documents"}
					<Button
						className="ml-auto"
						size="sm"
						variant="ghost"
						onClick={workbench.actions.beginDocument}
					>
						<FilePlus />
						New document
					</Button>
				</div>
				<div className="relative" style={{ height: virtualizer.getTotalSize() }}>
					{virtualizer.getVirtualItems().map((row) => {
						const document = workbench.result?.documents[row.index];
						if (!document) return null;
						return (
							<button
								key={row.key}
								className={`absolute left-0 top-0 w-full border-b px-3 py-2 text-left hover:bg-accent ${workbench.inspector.selectedIndex === row.index ? "bg-accent" : ""}`}
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
				className="w-1 cursor-col-resize bg-border hover:bg-primary/40 focus:bg-primary/40"
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
				<div className="flex h-10 items-center gap-2 border-b px-3 text-sm font-medium">
					{workbench.inspector.isNew
						? "New document"
						: workbench.selectedDocument
							? "Document"
							: "Inspector"}
					{(workbench.inspector.isNew || workbench.selectedDocument) && (
						<>
							<Button
								className="ml-auto"
								size="sm"
								onClick={() => void workbench.actions.saveDocument()}
							>
								<FloppyDisk />
								{workbench.inspector.isNew ? "Insert" : "Save"}
							</Button>
							{workbench.selectedDocument && (
								<Button
									size="sm"
									variant="destructive"
									onClick={() => void deleteDocument()}
								>
									<Trash />
									Delete
								</Button>
							)}
						</>
					)}
				</div>
				<CodeMirror
					className="min-h-0 flex-1 overflow-auto"
					value={workbench.inspector.documentText}
					height="100%"
					extensions={extensions}
					onChange={workbench.actions.setDocumentText}
					editable={
						workbench.inspector.isNew || Boolean(workbench.selectedDocument)
					}
				/>
			</aside>
		</div>
	);
}

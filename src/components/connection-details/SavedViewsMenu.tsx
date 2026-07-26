import {
	CaretDown,
	Check,
	FloppyDisk,
	PencilSimple,
	Trash,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { getSavedViewStatus } from "@/lib/savedViews";
import { api, type SavedView, type SavedViewStateV1 } from "@/lib/tauri";

interface SavedViewsMenuProps {
	connectionUuid: string;
	tableName: string;
	currentState: SavedViewStateV1;
	activeViewId: number | null;
	loading: boolean;
	hasUnappliedFilterDraft: boolean;
	onActiveViewChange: (id: number | null) => void;
	onApply: (view: SavedView) => Promise<boolean>;
}

type NameDialogMode = "create" | "rename" | null;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function SavedViewsMenu({
	connectionUuid,
	tableName,
	currentState,
	activeViewId,
	loading,
	hasUnappliedFilterDraft,
	onActiveViewChange,
	onApply,
}: SavedViewsMenuProps) {
	const [views, setViews] = useState<SavedView[]>([]);
	const [loadingViews, setLoadingViews] = useState(true);
	const [busy, setBusy] = useState(false);
	const [nameDialog, setNameDialog] = useState<NameDialogMode>(null);
	const [name, setName] = useState("");
	const [renameTarget, setRenameTarget] = useState<SavedView | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<SavedView | null>(null);
	const [switchTarget, setSwitchTarget] = useState<SavedView | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoadingViews(true);
		api.savedViews
			.list(connectionUuid, tableName)
			.then((nextViews) => {
				if (!cancelled) setViews(nextViews);
			})
			.catch((error) => {
				if (!cancelled) {
					toast.error("Failed to load saved views", {
						description: errorMessage(error),
					});
				}
			})
			.finally(() => {
				if (!cancelled) setLoadingViews(false);
			});
		return () => {
			cancelled = true;
		};
	}, [connectionUuid, tableName]);

	const { activeView, isEdited } = useMemo(
		() => getSavedViewStatus(activeViewId, views, currentState),
		[activeViewId, currentState, views],
	);

	const replaceView = useCallback((updated: SavedView) => {
		setViews((current) => [
			updated,
			...current.filter((view) => view.id !== updated.id),
		]);
	}, []);

	const applyView = useCallback(
		async (view: SavedView) => {
			setBusy(true);
			try {
				if (await onApply(view)) onActiveViewChange(view.id);
			} finally {
				setBusy(false);
			}
		},
		[onActiveViewChange, onApply],
	);

	const requestView = useCallback(
		(view: SavedView) => {
			if (view.id === activeViewId) return;
			if (activeView && isEdited) {
				setSwitchTarget(view);
				return;
			}
			void applyView(view);
		},
		[activeView, activeViewId, applyView, isEdited],
	);

	const createView = async () => {
		if (!name.trim()) return;
		setBusy(true);
		try {
			const created = await api.savedViews.create(connectionUuid, {
				table_name: tableName,
				name,
				state: currentState,
			});
			replaceView(created);
			onActiveViewChange(created.id);
			setNameDialog(null);
			setName("");
			toast.success(`Saved “${created.name}”`);
		} catch (error) {
			toast.error("Failed to save view", { description: errorMessage(error) });
		} finally {
			setBusy(false);
		}
	};

	const updateActiveView = useCallback(async () => {
		if (!activeView) return false;
		setBusy(true);
		try {
			const updated = await api.savedViews.update(activeView.id, {
				name: activeView.name,
				state: currentState,
			});
			replaceView(updated);
			toast.success(`Updated “${updated.name}”`);
			return true;
		} catch (error) {
			toast.error("Failed to update view", {
				description: errorMessage(error),
			});
			return false;
		} finally {
			setBusy(false);
		}
	}, [activeView, currentState, replaceView]);

	const renameView = async () => {
		if (!renameTarget || !name.trim()) return;
		setBusy(true);
		try {
			const updated = await api.savedViews.update(renameTarget.id, {
				name,
				state: renameTarget.state,
			});
			replaceView(updated);
			setNameDialog(null);
			setRenameTarget(null);
			setName("");
		} catch (error) {
			toast.error("Failed to rename view", {
				description: errorMessage(error),
			});
		} finally {
			setBusy(false);
		}
	};

	const deleteView = async () => {
		if (!deleteTarget) return;
		setBusy(true);
		try {
			await api.savedViews.delete(deleteTarget.id);
			setViews((current) =>
				current.filter((view) => view.id !== deleteTarget.id),
			);
			if (deleteTarget.id === activeViewId) onActiveViewChange(null);
			setDeleteTarget(null);
			toast.success(`Deleted “${deleteTarget.name}”`);
		} catch (error) {
			toast.error("Failed to delete view", {
				description: errorMessage(error),
			});
		} finally {
			setBusy(false);
		}
	};

	const saveAndSwitch = async () => {
		if (!switchTarget) return;
		const target = switchTarget;
		if (await updateActiveView()) {
			setSwitchTarget(null);
			await applyView(target);
		}
	};

	const disabled = loading || loadingViews || busy;

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={<Button variant="outline" size="sm" disabled={disabled} />}
				>
					<FloppyDisk data-icon="inline-start" />
					<span className="max-w-36 truncate">
						{activeView?.name ?? "Views"}
					</span>
					{isEdited && (
						<span className="rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
							Edited
						</span>
					)}
					<CaretDown data-icon="inline-end" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-64 p-1">
					<p className="px-2 py-2 text-xs text-muted-foreground">
						Saved views for this table
					</p>
					{views.length ? (
						views.map((view) => (
							<DropdownMenuItem key={view.id} onClick={() => requestView(view)}>
								<span className="min-w-0 flex-1 truncate">{view.name}</span>
								{view.id === activeViewId && <Check className="text-primary" />}
							</DropdownMenuItem>
						))
					) : (
						<p className="px-2 py-3 text-xs text-muted-foreground">
							No views saved for this table.
						</p>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => {
							setName("");
							setNameDialog("create");
						}}
					>
						<FloppyDisk /> Save current view…
					</DropdownMenuItem>
					{activeView && (
						<>
							<DropdownMenuItem onClick={() => void updateActiveView()}>
								<FloppyDisk /> Update “{activeView.name}”
							</DropdownMenuItem>
						</>
					)}
					{views.length > 0 && (
						<>
							<DropdownMenuSub>
								<DropdownMenuSubTrigger>
									<PencilSimple /> Rename view
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="w-52 p-1">
									{views.map((view) => (
										<DropdownMenuItem
											key={view.id}
											onClick={() => {
												setRenameTarget(view);
												setName(view.name);
												setNameDialog("rename");
											}}
										>
											<span className="truncate">{view.name}</span>
										</DropdownMenuItem>
									))}
								</DropdownMenuSubContent>
							</DropdownMenuSub>
							<DropdownMenuSub>
								<DropdownMenuSubTrigger className="text-destructive">
									<Trash /> Delete view
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="w-52 p-1">
									{views.map((view) => (
										<DropdownMenuItem
											key={view.id}
											variant="destructive"
											onClick={() => setDeleteTarget(view)}
										>
											<span className="truncate">{view.name}</span>
										</DropdownMenuItem>
									))}
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog
				open={nameDialog !== null}
				onOpenChange={(open) => {
					if (!open) {
						setNameDialog(null);
						setRenameTarget(null);
					}
				}}
			>
				<DialogContent className="max-w-sm">
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void (nameDialog === "create"
								? createView()
								: renameView());
						}}
					>
						<DialogHeader>
							<DialogTitle>
								{nameDialog === "create" ? "Save view" : "Rename view"}
							</DialogTitle>
							<DialogDescription>
								{nameDialog === "create"
									? "Save the applied filter, sort, and column layout for this table."
									: "Choose a clear name for this table view."}
							</DialogDescription>
						</DialogHeader>
						<div className="my-4 space-y-2">
							<label htmlFor="saved-view-name" className="text-xs font-medium">
								Name
							</label>
							<Input
								id="saved-view-name"
								autoFocus
								maxLength={80}
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="Recent activity"
							/>
							{nameDialog === "create" && hasUnappliedFilterDraft && (
								<p className="text-[11px] text-amber-700 dark:text-amber-300">
									Unapplied filter edits won’t be included.
								</p>
							)}
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									setNameDialog(null);
									setRenameTarget(null);
								}}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={busy || !name.trim()}>
								{busy && <Spinner />}
								{nameDialog === "create" ? "Save view" : "Rename view"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => !open && setDeleteTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
						<AlertDialogDescription>
							Your current table layout and filter will stay in place.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => void deleteView()}
							disabled={busy}
						>
							{busy && <Spinner />} Delete view
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<Dialog
				open={switchTarget !== null}
				onOpenChange={(open) => !open && setSwitchTarget(null)}
			>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>Save changes to “{activeView?.name}”?</DialogTitle>
						<DialogDescription>
							You edited this view. Save those changes before switching to “
							{switchTarget?.name}”.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className="sm:grid sm:grid-cols-[auto_1fr_1fr]">
						<Button variant="ghost" onClick={() => setSwitchTarget(null)}>
							Cancel
						</Button>
						<Button
							variant="outline"
							onClick={() => {
								const target = switchTarget;
								setSwitchTarget(null);
								if (target) void applyView(target);
							}}
							disabled={busy}
						>
							Discard and switch
						</Button>
						<Button onClick={() => void saveAndSwitch()} disabled={busy}>
							{busy && <Spinner />} Save and switch
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

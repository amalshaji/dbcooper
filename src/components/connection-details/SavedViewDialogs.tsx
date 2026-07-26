import type { FormEvent } from "react";
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { SavedView } from "@/lib/tauri";

export type SavedViewDialogAction =
	| { type: "create"; name: string }
	| { type: "rename"; view: SavedView; name: string }
	| { type: "delete"; view: SavedView }
	| { type: "switch"; view: SavedView }
	| null;

interface SavedViewDialogsProps {
	action: SavedViewDialogAction;
	busy: boolean;
	hasUnappliedFilterDraft: boolean;
	activeView: SavedView | null;
	onActionChange: (action: SavedViewDialogAction) => void;
	onNameSubmit: () => void;
	onDelete: () => void;
	onDiscardAndSwitch: () => void;
	onSaveAndSwitch: () => void;
}

export function SavedViewDialogs({
	action,
	busy,
	hasUnappliedFilterDraft,
	activeView,
	onActionChange,
	onNameSubmit,
	onDelete,
	onDiscardAndSwitch,
	onSaveAndSwitch,
}: SavedViewDialogsProps) {
	const nameAction =
		action?.type === "create" || action?.type === "rename" ? action : null;
	const deleteTarget = action?.type === "delete" ? action.view : null;
	const switchTarget = action?.type === "switch" ? action.view : null;
	const submitName = (event: FormEvent) => {
		event.preventDefault();
		onNameSubmit();
	};

	return (
		<>
			<Dialog
				open={nameAction !== null}
				onOpenChange={(open) => !open && onActionChange(null)}
			>
				<DialogContent className="max-w-sm">
					<form onSubmit={submitName}>
						<DialogHeader>
							<DialogTitle>
								{nameAction?.type === "create" ? "Save view" : "Rename view"}
							</DialogTitle>
							<DialogDescription>
								{nameAction?.type === "create"
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
								value={nameAction?.name ?? ""}
								onChange={(event) =>
									nameAction &&
									onActionChange({ ...nameAction, name: event.target.value })
								}
								placeholder="Recent activity"
							/>
							{nameAction?.type === "create" && hasUnappliedFilterDraft && (
								<p className="text-[11px] text-amber-700 dark:text-amber-300">
									Unapplied filter edits won’t be included.
								</p>
							)}
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => onActionChange(null)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={busy || !nameAction?.name.trim()}>
								{busy && <Spinner />}
								{nameAction?.type === "create" ? "Save view" : "Rename view"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => !open && onActionChange(null)}
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
							onClick={onDelete}
							disabled={busy}
						>
							{busy && <Spinner />} Delete view
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<Dialog
				open={switchTarget !== null}
				onOpenChange={(open) => !open && onActionChange(null)}
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
						<Button variant="ghost" onClick={() => onActionChange(null)}>
							Cancel
						</Button>
						<Button
							variant="outline"
							onClick={onDiscardAndSwitch}
							disabled={busy}
						>
							Discard and switch
						</Button>
						<Button onClick={onSaveAndSwitch} disabled={busy}>
							{busy && <Spinner />} Save and switch
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

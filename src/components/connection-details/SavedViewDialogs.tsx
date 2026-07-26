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

interface SavedViewDialogsProps {
	nameDialog: "create" | "rename" | null;
	name: string;
	busy: boolean;
	hasUnappliedFilterDraft: boolean;
	deleteTarget: SavedView | null;
	activeView: SavedView | null;
	switchTarget: SavedView | null;
	onNameChange: (name: string) => void;
	onNameDialogOpenChange: (open: boolean) => void;
	onNameSubmit: () => void;
	onDeleteDialogOpenChange: (open: boolean) => void;
	onDelete: () => void;
	onSwitchDialogOpenChange: (open: boolean) => void;
	onDiscardAndSwitch: () => void;
	onSaveAndSwitch: () => void;
}

export function SavedViewDialogs({
	nameDialog,
	name,
	busy,
	hasUnappliedFilterDraft,
	deleteTarget,
	activeView,
	switchTarget,
	onNameChange,
	onNameDialogOpenChange,
	onNameSubmit,
	onDeleteDialogOpenChange,
	onDelete,
	onSwitchDialogOpenChange,
	onDiscardAndSwitch,
	onSaveAndSwitch,
}: SavedViewDialogsProps) {
	const submitName = (event: FormEvent) => {
		event.preventDefault();
		onNameSubmit();
	};

	return (
		<>
			<Dialog open={nameDialog !== null} onOpenChange={onNameDialogOpenChange}>
				<DialogContent className="max-w-sm">
					<form onSubmit={submitName}>
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
								onChange={(event) => onNameChange(event.target.value)}
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
								onClick={() => onNameDialogOpenChange(false)}
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
				onOpenChange={onDeleteDialogOpenChange}
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
				onOpenChange={onSwitchDialogOpenChange}
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
						<Button
							variant="ghost"
							onClick={() => onSwitchDialogOpenChange(false)}
						>
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

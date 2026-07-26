import {
	CaretDown,
	Check,
	FloppyDisk,
	PencilSimple,
	Trash,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { decodeSavedViewState, getSavedViewStatus } from "@/lib/savedViews";
import { api, type SavedView, type SavedViewStateV1 } from "@/lib/tauri";
import {
	SavedViewDialogs,
	type SavedViewDialogAction,
} from "./SavedViewDialogs";

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

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function SavedViewsMenu(props: SavedViewsMenuProps) {
	return (
		<SavedViewsMenuContent
			key={`${props.connectionUuid}:${props.tableName}`}
			{...props}
		/>
	);
}

function SavedViewsMenuContent({
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
	const [dialogAction, setDialogAction] = useState<SavedViewDialogAction>(null);

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
				setDialogAction({ type: "switch", view });
				return;
			}
			void applyView(view);
		},
		[activeView, activeViewId, applyView, isEdited],
	);

	const createView = async () => {
		if (dialogAction?.type !== "create" || !dialogAction.name.trim()) return;
		setBusy(true);
		try {
			const created = await api.savedViews.create(connectionUuid, {
				table_name: tableName,
				name: dialogAction.name,
				state: currentState,
			});
			replaceView(created);
			onActiveViewChange(created.id);
			setDialogAction(null);
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
		if (dialogAction?.type !== "rename" || !dialogAction.name.trim()) return;
		const decodedState = decodeSavedViewState(dialogAction.view.state);
		if (!decodedState.state) {
			toast.error("Failed to rename view", {
				description: decodedState.error,
			});
			return;
		}
		setBusy(true);
		try {
			const updated = await api.savedViews.update(dialogAction.view.id, {
				name: dialogAction.name,
				state: decodedState.state,
			});
			replaceView(updated);
			setDialogAction(null);
		} catch (error) {
			toast.error("Failed to rename view", {
				description: errorMessage(error),
			});
		} finally {
			setBusy(false);
		}
	};

	const deleteView = async () => {
		if (dialogAction?.type !== "delete") return;
		const target = dialogAction.view;
		setBusy(true);
		try {
			await api.savedViews.delete(target.id);
			setViews((current) => current.filter((view) => view.id !== target.id));
			if (target.id === activeViewId) onActiveViewChange(null);
			setDialogAction(null);
			toast.success(`Deleted “${target.name}”`);
		} catch (error) {
			toast.error("Failed to delete view", {
				description: errorMessage(error),
			});
		} finally {
			setBusy(false);
		}
	};

	const saveAndSwitch = async () => {
		if (dialogAction?.type !== "switch") return;
		const target = dialogAction.view;
		if (await updateActiveView()) {
			setDialogAction(null);
			await applyView(target);
		}
	};

	const discardAndSwitch = () => {
		if (dialogAction?.type !== "switch") return;
		const target = dialogAction.view;
		setDialogAction(null);
		void applyView(target);
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
						onClick={() => setDialogAction({ type: "create", name: "" })}
					>
						<FloppyDisk /> Save current view…
					</DropdownMenuItem>
					{activeView && (
						<DropdownMenuItem onClick={() => void updateActiveView()}>
							<FloppyDisk /> Update “{activeView.name}”
						</DropdownMenuItem>
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
												setDialogAction({
													type: "rename",
													view,
													name: view.name,
												});
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
											onClick={() => setDialogAction({ type: "delete", view })}
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

			<SavedViewDialogs
				action={dialogAction}
				busy={busy}
				hasUnappliedFilterDraft={hasUnappliedFilterDraft}
				activeView={activeView}
				onActionChange={setDialogAction}
				onNameSubmit={() =>
					void (dialogAction?.type === "create" ? createView() : renameView())
				}
				onDelete={() => void deleteView()}
				onDiscardAndSwitch={discardAndSwitch}
				onSaveAndSwitch={() => void saveAndSwitch()}
			/>
		</>
	);
}

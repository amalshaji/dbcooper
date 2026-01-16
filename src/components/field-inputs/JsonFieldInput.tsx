import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { NullButton } from "./NullButton";
import { ExpandableText } from "@/components/ExpandableText";
import { ArrowsOut, Check, Copy, PaintBrush } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { FieldInputProps } from "./types";

export function JsonFieldInput({
	column,
	value,
	isNull,
	onValueChange,
	isReadonly = false,
}: FieldInputProps) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [dialogValue, setDialogValue] = useState("");
	const [jsonError, setJsonError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const stringValue =
		typeof value === "object" && value !== null
			? JSON.stringify(value, null, 2)
			: value === null
				? ""
				: String(value);

	const openDialog = () => {
		setDialogValue(stringValue);
		setJsonError(null);
		setDialogOpen(true);
	};

	const handleDialogValueChange = (newValue: string) => {
		setDialogValue(newValue);
		if (newValue.trim() === "") {
			setJsonError(null);
			return;
		}
		try {
			JSON.parse(newValue);
			setJsonError(null);
		} catch (e) {
			setJsonError((e as Error).message);
		}
	};

	const handleFormat = () => {
		try {
			const parsed = JSON.parse(dialogValue);
			setDialogValue(JSON.stringify(parsed, null, 2));
			setJsonError(null);
		} catch (e) {
			setJsonError((e as Error).message);
		}
	};

	const handleCopy = async () => {
		await navigator.clipboard.writeText(dialogValue);
		setCopied(true);
		toast.success("Copied to clipboard");
		setTimeout(() => setCopied(false), 2000);
	};

	const handleApply = () => {
		if (jsonError) return;
		try {
			const parsed = JSON.parse(dialogValue);
			onValueChange(parsed, false);
			setDialogOpen(false);
		} catch {
			onValueChange(dialogValue, false);
			setDialogOpen(false);
		}
	};

	if (isReadonly) {
		return (
			<>
				<div className="relative group">
					<ExpandableText value={stringValue} isNull={isNull} isJson={true} />
					{!isNull && stringValue.length > 0 && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="absolute top-1 right-1 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
							onClick={openDialog}
							title="Expand JSON"
						>
							<ArrowsOut className="w-4 h-4" />
						</Button>
					)}
				</div>
				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<DialogContent className="sm:max-w-2xl">
						<DialogHeader>
							<DialogTitle>{column.name}</DialogTitle>
							<DialogDescription>JSON data (read-only)</DialogDescription>
						</DialogHeader>
						<Textarea
							value={dialogValue}
							readOnly
							className="font-mono text-xs h-[50vh] resize-none"
						/>
						<div className="flex justify-end">
							<Button variant="outline" size="sm" onClick={handleCopy}>
								{copied ? (
									<Check className="w-4 h-4" />
								) : (
									<Copy className="w-4 h-4" />
								)}
								Copy
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			</>
		);
	}

	return (
		<>
			<div className="space-y-1">
				<div className="relative group">
					<Textarea
						value={isNull ? "" : stringValue}
						onChange={(e) => {
							try {
								const parsed = JSON.parse(e.target.value);
								onValueChange(parsed, false);
							} catch {
								onValueChange(e.target.value, false);
							}
						}}
						placeholder={isNull ? "NULL" : ""}
						className="font-mono text-xs min-h-[80px] pr-10"
					/>
					{!isNull && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="absolute top-1 right-1 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
							onClick={openDialog}
							title="Expand JSON editor"
						>
							<ArrowsOut className="w-4 h-4" />
						</Button>
					)}
				</div>
				<NullButton
					isNull={isNull}
					nullable={column.nullable}
					onToggle={() => onValueChange(isNull ? {} : null, false)}
				/>
			</div>
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>{column.name}</DialogTitle>
						<DialogDescription>
							Edit JSON data. Changes will be applied when you click Apply.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Textarea
							value={dialogValue}
							onChange={(e) => handleDialogValueChange(e.target.value)}
							className="font-mono text-xs h-[50vh] resize-none"
							placeholder="Enter JSON..."
						/>
						{jsonError && (
							<p className="text-xs text-destructive">{jsonError}</p>
						)}
					</div>
					<div className="flex items-center justify-between pt-2">
						<div className="flex gap-2">
							<Button variant="outline" size="sm" onClick={handleFormat}>
								<PaintBrush className="w-4 h-4" />
								Format
							</Button>
							<Button variant="outline" size="sm" onClick={handleCopy}>
								{copied ? (
									<Check className="w-4 h-4" />
								) : (
									<Copy className="w-4 h-4" />
								)}
								Copy
							</Button>
						</div>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setDialogOpen(false)}
							>
								Cancel
							</Button>
							<Button size="sm" onClick={handleApply} disabled={!!jsonError}>
								Apply
							</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface TableFilterBarProps {
	filter: string;
	filterInput: string;
	loading: boolean;
	showInput: boolean;
	onInputChange: (value: string) => void;
	onApply: () => void;
	onClear: () => void;
}

export function TableFilterBar({
	filter,
	filterInput,
	loading,
	showInput,
	onInputChange,
	onApply,
	onClear,
}: TableFilterBarProps) {
	if (!showInput && !filter) return null;

	return (
		<div className="px-6 pb-4">
			{showInput && (
				<div className="flex items-center gap-2">
					<Input
						placeholder="Filter: e.g. id = 1 AND status = 'active'"
						value={filterInput}
						onChange={(e) => onInputChange(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") onApply();
						}}
						className="flex-1 font-mono text-xs"
					/>
					{filter && (
						<Button
							size="sm"
							variant="outline"
							onClick={onClear}
							disabled={loading}
						>
							Clear
						</Button>
					)}
				</div>
			)}
			{filter && (
				<div
					className={
						showInput
							? "mt-2 text-xs text-muted-foreground"
							: "flex items-center justify-between gap-2 text-xs text-muted-foreground"
					}
				>
					<span>
						Active filter:{" "}
						<code className="bg-muted px-1 py-0.5 rounded">{filter}</code>
					</span>
					{!showInput && (
						<Button
							size="sm"
							variant="outline"
							onClick={onClear}
							disabled={loading}
						>
							Clear
						</Button>
					)}
				</div>
			)}
		</div>
	);
}

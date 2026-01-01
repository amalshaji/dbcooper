import { useMemo, useState, useEffect } from "react";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
	Check,
	Copy,
	CaretDown,
	CaretUp,
	MagnifyingGlass,
} from "@phosphor-icons/react";
import { toast } from "sonner";

interface QueryResultSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	row: Record<string, unknown> | null;
	rowIndex?: number;
}

const TRUNCATE_LENGTH = 100;

export function QueryResultSheet({
	open,
	onOpenChange,
	row,
	rowIndex,
}: QueryResultSheetProps) {
	const [copiedField, setCopiedField] = useState<string | null>(null);
	const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());
	const [columnSearch, setColumnSearch] = useState("");

	const formattedFields = useMemo(() => {
		if (!row) return [];

		return Object.entries(row).map(([key, value]) => {
			let displayValue: string;
			let isJson = false;

			if (value === null || value === undefined) {
				displayValue = "null";
			} else if (typeof value === "object") {
				displayValue = JSON.stringify(value, null, 2);
				isJson = true;
			} else if (typeof value === "boolean") {
				displayValue = value ? "true" : "false";
			} else {
				displayValue = String(value);
			}

			const isLong = displayValue.length > TRUNCATE_LENGTH;
			const isExpanded = expandedFields.has(key);
			const shouldTruncate = isLong && !isExpanded;

			let truncatedValue = displayValue;
			let remainingChars = 0;
			let remainingLines = 0;

			if (shouldTruncate) {
				truncatedValue = displayValue.substring(0, TRUNCATE_LENGTH);
				remainingChars = displayValue.length - TRUNCATE_LENGTH;
				// Count actual newlines in the full remaining text
				const remainingText = displayValue.substring(TRUNCATE_LENGTH);
				const newlineCount = (remainingText.match(/\n/g) || []).length;
				// If there are newlines, use actual count + 1 (for the last line)
				// Otherwise estimate ~80 chars per line for textarea, or 1 line for input
				if (newlineCount > 0) {
					remainingLines = newlineCount + 1;
				} else {
					// For textarea, estimate lines; for single-line input, it's just chars
					remainingLines = Math.max(1, Math.ceil(remainingChars / 80));
				}
			} else if (isLong && isExpanded) {
				// When expanded, show how much we're hiding if collapsed
				remainingChars = displayValue.length - TRUNCATE_LENGTH;
				const remainingText = displayValue.substring(TRUNCATE_LENGTH);
				const newlineCount = (remainingText.match(/\n/g) || []).length;
				if (newlineCount > 0) {
					remainingLines = newlineCount + 1;
				} else {
					remainingLines = Math.max(1, Math.ceil(remainingChars / 80));
				}
			}

			return {
				key,
				value: displayValue,
				truncatedValue,
				isJson,
				isNull: value === null || value === undefined,
				isLong,
				isExpanded,
				remainingChars,
				remainingLines,
			};
		});
	}, [row, expandedFields]);

	const filteredFields = useMemo(() => {
		if (!columnSearch.trim()) {
			return formattedFields;
		}
		const searchLower = columnSearch.toLowerCase();
		return formattedFields.filter((field) =>
			field.key.toLowerCase().includes(searchLower),
		);
	}, [formattedFields, columnSearch]);

	useEffect(() => {
		if (!open) {
			setColumnSearch("");
		}
	}, [open]);

	const handleCopyField = (fieldKey: string, value: string) => {
		navigator.clipboard.writeText(value);
		setCopiedField(fieldKey);
		toast.success("Copied to clipboard");
		setTimeout(() => setCopiedField(null), 2000);
	};

	const toggleExpand = (fieldKey: string) => {
		setExpandedFields((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(fieldKey)) {
				newSet.delete(fieldKey);
			} else {
				newSet.add(fieldKey);
			}
			return newSet;
		});
	};

	if (!row) return null;

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						Query Result
						{rowIndex !== undefined && (
							<Badge variant="secondary" className="font-mono">
								Row {rowIndex + 1}
							</Badge>
						)}
					</SheetTitle>
					<SheetDescription>
						View the details of this query result row. All fields are readonly.
					</SheetDescription>
				</SheetHeader>

				<div className="px-4 pt-4 pb-2">
					<div className="relative">
						<MagnifyingGlass className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
						<Input
							placeholder="Search columns..."
							value={columnSearch}
							onChange={(e) => setColumnSearch(e.target.value)}
							className="pl-8"
						/>
					</div>
				</div>

				<div className="py-6 px-4 space-y-4">
					{filteredFields.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">
							<p>No columns match your search.</p>
						</div>
					) : (
						filteredFields.map((field) => (
							<div key={field.key} className="space-y-1.5">
								<div className="flex items-center justify-between gap-2">
									<Label className="flex items-center gap-2">{field.key}</Label>
									<Button
										variant="ghost"
										size="sm"
										className="h-7 px-2"
										onClick={() => handleCopyField(field.key, field.value)}
									>
										{copiedField === field.key ? (
											<>
												<Check className="w-4 h-4" />
												Copied!
											</>
										) : (
											<>
												<Copy className="w-4 h-4" />
												Copy
											</>
										)}
									</Button>
								</div>
								{field.isJson || field.value.length > 100 ? (
									<div className="space-y-2">
										<Textarea
											value={field.isNull ? "" : field.truncatedValue}
											disabled
											placeholder={field.isNull ? "NULL" : ""}
											className={
												field.isJson
													? "font-mono text-xs min-h-[80px]"
													: "min-h-[60px]"
											}
											readOnly
										/>
										{field.isLong && (
											<div className="flex justify-center">
												<Button
													variant="ghost"
													size="sm"
													className="h-7 px-3 text-xs"
													onClick={() => toggleExpand(field.key)}
												>
													{field.isExpanded ? (
														<>
															<CaretUp className="w-3 h-3" />
															Collapse ({field.remainingLines} line
															{field.remainingLines !== 1 ? "s" : ""})
														</>
													) : (
														<>
															<CaretDown className="w-3 h-3" />
															Show {field.remainingLines} more line
															{field.remainingLines !== 1 ? "s" : ""}
														</>
													)}
												</Button>
											</div>
										)}
									</div>
								) : (
									<div className="space-y-2">
										<Input
											value={field.isNull ? "" : field.truncatedValue}
											disabled
											placeholder={field.isNull ? "NULL" : ""}
											className="flex-1"
											readOnly
										/>
										{field.isLong && (
											<div className="flex justify-center">
												<Button
													variant="ghost"
													size="sm"
													className="h-7 px-3 text-xs"
													onClick={() => toggleExpand(field.key)}
												>
													{field.isExpanded ? (
														<>
															<CaretUp className="w-3 h-3" />
															Collapse ({field.remainingChars} chars)
														</>
													) : (
														<>
															<CaretDown className="w-3 h-3" />
															Show {field.remainingChars} more chars
														</>
													)}
												</Button>
											</div>
										)}
									</div>
								)}
							</div>
						))
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}

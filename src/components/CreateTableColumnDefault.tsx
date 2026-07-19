import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	type CreateTableColumnDraft,
	type CreateTableDbType,
	type DefaultKind,
	getDefaultExpressions,
} from "../lib/createTableForm";

interface CreateTableColumnDefaultProps {
	column: CreateTableColumnDraft;
	dbType: CreateTableDbType;
	inputId: string;
	onChange: (column: CreateTableColumnDraft) => void;
}

export function CreateTableColumnDefault({
	column,
	dbType,
	inputId,
	onChange,
}: CreateTableColumnDefaultProps) {
	const expressions = getDefaultExpressions(dbType, column.dataType);
	const update = (updates: Partial<CreateTableColumnDraft>) => {
		onChange({ ...column, ...updates });
	};

	const handleKindChange = (kind: DefaultKind | null) => {
		if (!kind) return;
		update({
			defaultKind: kind,
			defaultValue:
				kind === "expression"
					? expressions[0] || ""
					: kind === "literal" && column.dataType === "BOOLEAN"
						? "false"
						: "",
		});
	};

	return (
		<div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
			<div className="space-y-1.5">
				<Label htmlFor={`${inputId}-default-kind`}>Default</Label>
				<Select value={column.defaultKind} onValueChange={handleKindChange}>
					<SelectTrigger id={`${inputId}-default-kind`} className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="none">None</SelectItem>
						<SelectItem value="literal">Literal value</SelectItem>
						<SelectItem value="expression" disabled={expressions.length === 0}>
							Expression
						</SelectItem>
					</SelectContent>
				</Select>
			</div>
			{column.defaultKind !== "none" && (
				<div className="space-y-1.5">
					<Label htmlFor={`${inputId}-default-value`}>
						{column.defaultKind === "expression"
							? "Default expression"
							: "Default value"}
					</Label>
					{column.defaultKind === "expression" ? (
						<Select
							value={column.defaultValue}
							onValueChange={(value) =>
								value && update({ defaultValue: value })
							}
						>
							<SelectTrigger
								id={`${inputId}-default-value`}
								className="w-full font-mono"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{expressions.map((expression) => (
									<SelectItem key={expression} value={expression}>
										<span className="font-mono">{expression}</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : column.dataType === "BOOLEAN" ? (
						<Select
							value={column.defaultValue || "false"}
							onValueChange={(value) =>
								value && update({ defaultValue: value })
							}
						>
							<SelectTrigger
								id={`${inputId}-default-value`}
								className="w-full"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="false">false</SelectItem>
								<SelectItem value="true">true</SelectItem>
							</SelectContent>
						</Select>
					) : (
						<Input
							id={`${inputId}-default-value`}
							value={column.defaultValue}
							inputMode={
								/INT|REAL|NUMERIC|SERIAL/.test(column.dataType)
									? "decimal"
									: "text"
							}
							onChange={(event) =>
								update({ defaultValue: event.target.value })
							}
						/>
					)}
				</div>
			)}
		</div>
	);
}

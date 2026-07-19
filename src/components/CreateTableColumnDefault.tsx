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
import { getLiteralKind } from "../lib/databaseCatalog";

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
	const literalKind = getLiteralKind(dbType, column.dataType);

	const handleKindChange = (kind: DefaultKind | null) => {
		if (!kind) return;
		onChange({
			...column,
			default:
				kind === "expression"
					? { kind, value: expressions[0] || "" }
					: kind === "literal"
						? { kind, value: literalKind === "boolean" ? "false" : "" }
						: { kind },
		});
	};
	const defaultValue =
		column.default.kind === "none" ? "" : column.default.value;
	const updateDefaultValue = (value: string) => {
		if (column.default.kind === "none") return;
		onChange({ ...column, default: { ...column.default, value } });
	};

	return (
		<div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
			<div className="space-y-1.5">
				<Label htmlFor={`${inputId}-default-kind`}>Default</Label>
				<Select value={column.default.kind} onValueChange={handleKindChange}>
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
			{column.default.kind !== "none" && (
				<div className="space-y-1.5">
					<Label htmlFor={`${inputId}-default-value`}>
						{column.default.kind === "expression"
							? "Default expression"
							: "Default value"}
					</Label>
					{column.default.kind === "expression" ? (
						<Select
							value={defaultValue}
							onValueChange={(value) =>
								value && updateDefaultValue(value)
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
					) : literalKind === "boolean" ? (
						<Select
							value={defaultValue || "false"}
							onValueChange={(value) =>
								value && updateDefaultValue(value)
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
							value={defaultValue}
							inputMode={literalKind === "number" ? "decimal" : "text"}
							onChange={(event) =>
								updateDefaultValue(event.target.value)
							}
						/>
					)}
				</div>
			)}
		</div>
	);
}

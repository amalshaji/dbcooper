import {
	Combobox,
	ComboboxInput,
	ComboboxContent,
	ComboboxList,
	ComboboxItem,
} from "@/components/ui/combobox";
import { Code } from "@phosphor-icons/react";
import { isSqlFunction } from "@/lib/sqlFunctions";

interface FunctionComboboxProps {
	value: string;
	suggestedFunctions: string[];
	placeholder: string;
	onValueChange: (value: string, isFunction: boolean) => void;
	inputType?: "text" | "number";
}

export function FunctionCombobox({
	value,
	suggestedFunctions,
	placeholder,
	onValueChange,
	inputType = "text",
}: FunctionComboboxProps) {
	const handleInputChange = (newValue: string) => {
		// When typing, only set isRawSql if it exactly matches a suggested function
		// This prevents regular text values from being incorrectly flagged as raw SQL
		// Ensure we're passing the actual typed value, not something else
		if (typeof newValue !== "string") {
			console.warn("FunctionCombobox: Received non-string value", newValue);
			return;
		}
		const isFunction = suggestedFunctions.includes(newValue);
		onValueChange(newValue, isFunction);
	};

	const handleSelectFromDropdown = (newValue: string) => {
		// When selecting from dropdown, it's definitely a function
		if (!newValue) return;
		// Ensure we're passing the selected value, not something else
		if (typeof newValue !== "string") {
			console.warn("FunctionCombobox: Received non-string value from dropdown", newValue);
			return;
		}
		onValueChange(newValue, true);
	};

	return (
		<Combobox
			value={value}
			onValueChange={handleSelectFromDropdown}
		>
			<ComboboxInput
				type={inputType}
				value={value}
				onChange={(e) => handleInputChange(e.target.value)}
				placeholder={placeholder}
				className="flex-1 !rounded-md"
			/>
			<ComboboxContent className="!rounded-md">
				<ComboboxList>
					{suggestedFunctions.map((func) => (
						<ComboboxItem key={func} value={func}>
							<Code className="w-4 h-4 mr-2" />
							{func}
						</ComboboxItem>
					))}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}

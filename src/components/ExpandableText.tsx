import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CaretDown, CaretUp } from "@phosphor-icons/react";

const DEFAULT_TRUNCATE_LENGTH = 200;

interface ExpandableTextProps {
	value: string;
	isNull?: boolean;
	isJson?: boolean;
	truncateLength?: number;
	placeholder?: string;
}

export function ExpandableText({
	value,
	isNull = false,
	isJson = false,
	truncateLength = DEFAULT_TRUNCATE_LENGTH,
	placeholder = "NULL",
}: ExpandableTextProps) {
	const [isExpanded, setIsExpanded] = useState(false);

	const { displayValue, truncatedValue, isLong, remainingChars, remainingLines } =
		useMemo(() => {
			const displayValue = value;
			const isLong = displayValue.length > truncateLength;
			const shouldTruncate = isLong && !isExpanded;

			let truncatedValue = displayValue;
			let remainingChars = 0;
			let remainingLines = 0;

			if (shouldTruncate) {
				// Find the next newline after truncateLength, or use truncateLength if no newline
				const nextNewline = displayValue.indexOf('\n', truncateLength);
				const truncateAt = nextNewline !== -1 ? nextNewline : truncateLength;
				
				truncatedValue = displayValue.substring(0, truncateAt);
				const remainingText = displayValue.substring(truncateAt);
				remainingChars = remainingText.length;
				const newlineCount = (remainingText.match(/\n/g) || []).length;
				if (newlineCount > 0) {
					remainingLines = newlineCount;
				} else {
					remainingLines = Math.max(1, Math.ceil(remainingChars / 80));
				}
			} else if (isLong && isExpanded) {
				// Calculate what would be hidden if collapsed (for the button label)
				const nextNewline = displayValue.indexOf('\n', truncateLength);
				const truncateAt = nextNewline !== -1 ? nextNewline : truncateLength;
				
				const remainingText = displayValue.substring(truncateAt);
				remainingChars = remainingText.length;
				const newlineCount = (remainingText.match(/\n/g) || []).length;
				if (newlineCount > 0) {
					remainingLines = newlineCount;
				} else {
					remainingLines = Math.max(1, Math.ceil(remainingChars / 80));
				}
			}

			return {
				displayValue,
				truncatedValue: isExpanded ? displayValue : truncatedValue,
				isLong,
				remainingChars,
				remainingLines,
			};
		}, [value, truncateLength, isExpanded]);

	const useTextarea = isJson || displayValue.length > truncateLength;

	return (
		<div className="space-y-2">
			{useTextarea ? (
				<Textarea
					value={isNull ? "" : truncatedValue}
					disabled
					placeholder={isNull ? placeholder : ""}
					className={isJson ? "font-mono text-xs min-h-[80px]" : "min-h-[60px]"}
					readOnly
				/>
			) : (
				<Input
					value={isNull ? "" : truncatedValue}
					disabled
					placeholder={isNull ? placeholder : ""}
					className="flex-1"
					readOnly
				/>
			)}
			{isLong && (
				<div className="flex justify-center">
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-3 text-xs"
						onClick={() => setIsExpanded(!isExpanded)}
					>
						{isExpanded ? (
							<>
								<CaretUp className="w-3 h-3" />
								Collapse ({useTextarea ? `${remainingLines} line${remainingLines !== 1 ? "s" : ""}` : `${remainingChars} chars`})
							</>
						) : (
							<>
								<CaretDown className="w-3 h-3" />
								Show {useTextarea ? `${remainingLines} more line${remainingLines !== 1 ? "s" : ""}` : `${remainingChars} more chars`}
							</>
						)}
					</Button>
				</div>
			)}
		</div>
	);
}

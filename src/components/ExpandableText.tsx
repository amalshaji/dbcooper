import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CaretDown, CaretUp } from "@phosphor-icons/react";

const DEFAULT_TRUNCATE_LENGTH = 200;
const ESTIMATED_CHARS_PER_LINE = 80;

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

	const { truncatedValue, isLong, remainingChars, remainingLines } =
		useMemo(() => {
			const isLong = value.length > truncateLength;
			const shouldTruncate = isLong && !isExpanded;

			const calculateRemaining = () => {
				const nextNewline = value.indexOf('\n', truncateLength);
				const truncateAt = nextNewline !== -1 ? nextNewline : truncateLength;
				const remainingText = value.substring(truncateAt);
				const remainingChars = remainingText.length;
				const newlineCount = (remainingText.match(/\n/g) || []).length;
				// When truncating at a newline, the remaining text starts with that newline,
				// so newlineCount represents the actual number of lines remaining
				const remainingLines = newlineCount > 0
					? newlineCount
					: Math.max(1, Math.ceil(remainingChars / ESTIMATED_CHARS_PER_LINE));
				return { truncateAt, remainingChars, remainingLines };
			};

			let truncatedValue = value;
			let remainingChars = 0;
			let remainingLines = 0;

			if (shouldTruncate || (isLong && isExpanded)) {
				const calculated = calculateRemaining();
				remainingChars = calculated.remainingChars;
				remainingLines = calculated.remainingLines;
				if (shouldTruncate) {
					truncatedValue = value.substring(0, calculated.truncateAt);
				}
			}

			return {
				truncatedValue: isExpanded ? value : truncatedValue,
				isLong,
				remainingChars,
				remainingLines,
			};
		}, [value, truncateLength, isExpanded]);

	const useTextarea = isJson || isLong;

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

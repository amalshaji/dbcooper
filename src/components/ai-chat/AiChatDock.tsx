import {
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/utils";

const WIDTH_STORAGE_KEY = "dbcooper.aiChat.width";
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 320;
const MAX_WIDTH = 760;
const KEYBOARD_STEP = 16;

function clampWidth(width: number) {
	const max = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth * 0.6));
	return Math.round(Math.min(max, Math.max(MIN_WIDTH, width)));
}

function readStoredWidth() {
	const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
	return clampWidth(Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_WIDTH);
}

interface AiChatDockProps {
	open: boolean;
	panel: ReactNode;
	children: ReactNode;
}

/** Keeps the panel mounted after first open so a running question survives hiding it. */
export function AiChatDock({ open, panel, children }: AiChatDockProps) {
	const [width, setWidth] = useState(readStoredWidth);
	const [mounted, setMounted] = useState(open);
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

	if (open && !mounted) setMounted(true);

	const commitWidth = (next: number) => {
		const clamped = clampWidth(next);
		setWidth(clamped);
		localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
	};

	const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = { startX: event.clientX, startWidth: width };
	};

	const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag) return;
		setWidth(clampWidth(drag.startWidth + drag.startX - event.clientX));
	};

	const handlePointerUp = () => {
		if (!dragRef.current) return;
		dragRef.current = null;
		commitWidth(width);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "ArrowLeft") commitWidth(width + KEYBOARD_STEP);
		else if (event.key === "ArrowRight") commitWidth(width - KEYBOARD_STEP);
		else return;
		event.preventDefault();
	};

	return (
		<div className="flex min-h-0 min-w-0 flex-1">
			<div className="flex min-w-0 flex-1 flex-col">{children}</div>
			{mounted ? (
				<>
					<div
						role="separator"
						aria-orientation="vertical"
						aria-label="Resize Ask AI panel"
						aria-valuenow={width}
						aria-valuemin={MIN_WIDTH}
						aria-valuemax={MAX_WIDTH}
						tabIndex={0}
						onPointerDown={handlePointerDown}
						onPointerMove={handlePointerMove}
						onPointerUp={handlePointerUp}
						onLostPointerCapture={handlePointerUp}
						onKeyDown={handleKeyDown}
						className={cn(
							"w-1 shrink-0 cursor-col-resize border-l bg-transparent outline-none transition-colors hover:bg-primary/20 focus-visible:bg-primary/30",
							!open && "hidden",
						)}
					/>
					<aside
						aria-label="Ask AI"
						style={{ width }}
						className={cn(
							"flex min-h-0 shrink-0 flex-col bg-card/40",
							!open && "hidden",
						)}
					>
						{panel}
					</aside>
				</>
			) : null}
		</div>
	);
}

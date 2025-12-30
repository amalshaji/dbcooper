import { useState, useRef, useCallback } from "react";

interface CompareProps {
	/** First image (shown on the left/bottom) - typically light mode */
	firstImage: string;
	/** Second image (shown on the right/top) - typically dark mode */
	secondImage: string;
	/** First image alt text */
	firstImageAlt?: string;
	/** Second image alt text */
	secondImageAlt?: string;
	/** Initial slider position (0-100) */
	initialPosition?: number;
	/** Optional className for the container */
	className?: string;
	/** Enable autoplay animation */
	autoplay?: boolean;
	/** Autoplay duration in ms */
	autoplayDuration?: number;
}

export function Compare({
	firstImage,
	secondImage,
	firstImageAlt = "Light mode",
	secondImageAlt = "Dark mode",
	initialPosition = 50,
	className = "",
	autoplay = false,
	autoplayDuration = 3000,
}: CompareProps) {
	const [sliderPosition, setSliderPosition] = useState(initialPosition);
	const [isDragging, setIsDragging] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	const handleMove = useCallback((clientX: number) => {
		if (!containerRef.current) return;

		const rect = containerRef.current.getBoundingClientRect();
		const x = clientX - rect.left;
		const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
		setSliderPosition(percentage);
	}, []);

	const handleMouseDown = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(true);
		handleMove(e.clientX);
	};

	const handleMouseMove = (e: React.MouseEvent) => {
		if (!isDragging) return;
		e.stopPropagation();
		handleMove(e.clientX);
	};

	const handleMouseUp = () => {
		setIsDragging(false);
	};

	const handleMouseLeave = () => {
		setIsDragging(false);
	};

	const handleTouchStart = (e: React.TouchEvent) => {
		e.stopPropagation();
		setIsDragging(true);
		handleMove(e.touches[0].clientX);
	};

	const handleTouchMove = (e: React.TouchEvent) => {
		if (!isDragging) return;
		e.stopPropagation();
		handleMove(e.touches[0].clientX);
	};

	const handleTouchEnd = () => {
		setIsDragging(false);
	};

	// Autoplay animation
	const [animationDirection, setAnimationDirection] = useState<
		"forward" | "backward"
	>("forward");

	if (autoplay && !isDragging) {
		setTimeout(() => {
			if (animationDirection === "forward") {
				if (sliderPosition >= 90) {
					setAnimationDirection("backward");
				} else {
					setSliderPosition((prev) => Math.min(90, prev + 0.5));
				}
			} else {
				if (sliderPosition <= 10) {
					setAnimationDirection("forward");
				} else {
					setSliderPosition((prev) => Math.max(10, prev - 0.5));
				}
			}
		}, autoplayDuration / 160);
	}

	return (
		<div
			ref={containerRef}
			className={`relative overflow-hidden rounded-lg select-none cursor-ew-resize ${className}`}
			onMouseDown={handleMouseDown}
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
			onMouseLeave={handleMouseLeave}
			onTouchStart={handleTouchStart}
			onTouchMove={handleTouchMove}
			onTouchEnd={handleTouchEnd}
		>
			{/* First image (full width, underneath) */}
			<img
				src={firstImage}
				alt={firstImageAlt}
				className="w-full h-auto block"
				draggable={false}
			/>

			{/* Second image (clipped, on top) */}
			<div
				className="absolute inset-0 overflow-hidden"
				style={{ clipPath: `inset(0 0 0 ${sliderPosition}%)` }}
			>
				<img
					src={secondImage}
					alt={secondImageAlt}
					className="w-full h-auto block"
					draggable={false}
				/>
			</div>

			{/* Slider handle */}
			<div
				className="absolute top-0 bottom-0 w-1 bg-white shadow-lg z-10"
				style={{ left: `${sliderPosition}%`, transform: "translateX(-50%)" }}
			>
				{/* Handle grip */}
				<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center border-2 border-gray-200">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="text-gray-600"
					>
						<path d="M18 8L22 12L18 16" />
						<path d="M6 8L2 12L6 16" />
					</svg>
				</div>
			</div>

			{/* Labels */}
			<div className="absolute bottom-3 left-3 px-2 py-1 bg-black/60 text-white text-xs rounded">
				Light
			</div>
			<div className="absolute bottom-3 right-3 px-2 py-1 bg-black/60 text-white text-xs rounded">
				Dark
			</div>
		</div>
	);
}

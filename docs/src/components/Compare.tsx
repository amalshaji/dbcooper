import { useState, useRef, useCallback, useEffect } from "react";

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
	/** Whether to show dark mode */
	isDark?: boolean;
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
	isDark = false,
}: CompareProps) {
	const containerRef = useRef<HTMLDivElement>(null);


	const isFullscreen = className.includes('h-full');
	
	return (
		<div
			ref={containerRef}
			className={`relative overflow-hidden rounded-lg select-none cursor-default ${className}`}
		>
			{/* First image (full width, underneath) */}
			<img
				src={firstImage}
				alt={firstImageAlt}
				className={isFullscreen ? "w-full h-full block" : "w-full h-auto block"}
				draggable={false}
				style={isFullscreen ? { objectFit: 'contain' } : undefined}
			/>

			{/* Second image (clipped, on top) */}
			<div
				className="absolute inset-0 overflow-hidden"
				style={{ clipPath: `inset(0 0 0 ${isDark ? 0 : 100}%)` }}
			>
				<img
					src={secondImage}
					alt={secondImageAlt}
					className={isFullscreen ? "w-full h-full block" : "w-full h-auto block"}
					draggable={false}
					style={isFullscreen ? { objectFit: 'contain' } : undefined}
				/>
			</div>

		</div>
	);
}

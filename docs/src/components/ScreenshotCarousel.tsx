import { useState, useEffect } from "react";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import { Compare } from "./Compare";

interface ArrowProps {
	onClick?: () => void;
}

function PrevArrow({ onClick }: ArrowProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm flex items-center justify-center text-white/90 transition-all duration-200 hover:scale-105 opacity-0 group-hover/win:opacity-100"
			aria-label="Previous slide"
		>
			<svg
				className="w-4 h-4 sm:w-5 sm:h-5"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				strokeWidth={2}
				aria-hidden="true"
			>
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					d="M15.75 19.5L8.25 12l7.5-7.5"
				/>
			</svg>
		</button>
	);
}

function NextArrow({ onClick }: ArrowProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm flex items-center justify-center text-white/90 transition-all duration-200 hover:scale-105 opacity-0 group-hover/win:opacity-100"
			aria-label="Next slide"
		>
			<svg
				className="w-4 h-4 sm:w-5 sm:h-5"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				strokeWidth={2}
				aria-hidden="true"
			>
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					d="M8.25 4.5l7.5 7.5-7.5 7.5"
				/>
			</svg>
		</button>
	);
}

interface LightboxProps {
	lightImage: string;
	darkImage: string;
	alt: string;
	onClose: () => void;
	isDark: boolean;
}

function Lightbox({
	lightImage,
	darkImage,
	alt,
	onClose,
	isDark,
}: LightboxProps) {
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			document.body.style.overflow = "";
		};
	}, [onClose]);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center"
			role="dialog"
			aria-modal="true"
			aria-label="Image preview"
		>
			{/* Backdrop button for closing */}
			<button
				type="button"
				onClick={onClose}
				className="absolute inset-0 bg-black/90 backdrop-blur-sm cursor-default"
				aria-label="Close preview"
			/>
			<button
				type="button"
				onClick={onClose}
				className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
				aria-label="Close preview"
			>
				<svg
					className="w-6 h-6"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={2}
					aria-hidden="true"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M6 18L18 6M6 6l12 12"
					/>
				</svg>
			</button>
			<div className="relative z-10 w-[90vw] h-[90vh] rounded-lg shadow-2xl overflow-hidden flex items-center justify-center p-4">
				<Compare
					firstImage={lightImage}
					secondImage={darkImage}
					firstImageAlt={`${alt} - Light mode`}
					secondImageAlt={`${alt} - Dark mode`}
					initialPosition={50}
					className="w-full h-full"
					isDark={isDark}
				/>
			</div>
		</div>
	);
}

const baseSettings = {
	dots: true,
	infinite: true,
	speed: 500,
	slidesToShow: 1,
	slidesToScroll: 1,
	autoplay: true,
	autoplaySpeed: 5000,
	arrows: true,
	prevArrow: <PrevArrow />,
	nextArrow: <NextArrow />,
};

const screenshots = [
	{
		light: "/screenshots/simple-light.webp",
		dark: "/screenshots/simple-dark.webp",
		alt: "Table data view",
		label: "Table Data",
	},
	{
		light: "/screenshots/query-light.webp",
		dark: "/screenshots/query-dark.webp",
		alt: "SQL query editor",
		label: "Query Editor",
	},
	{
		light: "/screenshots/structure-light.webp",
		dark: "/screenshots/structure-dark.webp",
		alt: "Table structure view",
		label: "Table Structure",
	},
	{
		light: "/screenshots/cmd-light.webp",
		dark: "/screenshots/cmd-dark.webp",
		alt: "Command palette",
		label: "Command Palette",
	},
	{
		light: "/screenshots/visual-light.webp",
		dark: "/screenshots/visual-dark.webp",
		alt: "Schema visualizer",
		label: "Schema Visualizer",
	},
];

export function ScreenshotCarousel() {
	const [lightbox, setLightbox] = useState<{
		light: string;
		dark: string;
		alt: string;
	} | null>(null);
	const [isDark, setIsDark] = useState(false);
	const [current, setCurrent] = useState(0);

	useEffect(() => {
		// Check system theme preference
		const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
		setIsDark(dark);
	}, []);

	const toggleTheme = () => {
		setIsDark(!isDark);
	};

	const settings = {
		...baseSettings,
		beforeChange: (_: number, next: number) => setCurrent(next),
	};

	return (
		<>
			<div className="relative">
				{/* macOS window chrome */}
				<div className="win-chrome group/win">
					<div className="win-bar">
						<span className="win-dot" style={{ background: "#ff5f57" }} />
						<span className="win-dot" style={{ background: "#febc2e" }} />
						<span className="win-dot" style={{ background: "#28c840" }} />
						<span className="font-mono text-[11px] text-faint ml-2 truncate">
							DBcooper — {screenshots[current]?.label}
						</span>
						<div className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-faint">
							<span>light</span>
							<button
								type="button"
								onClick={toggleTheme}
								className="relative inline-flex h-4 w-7 items-center rounded-full bg-surface-2 border border-line transition-colors"
								aria-label="Toggle theme preview"
							>
								<span
									className="inline-block h-2.5 w-2.5 transform rounded-full bg-copper transition-transform"
									style={{
										transform: isDark
											? "translateX(13px)"
											: "translateX(2px)",
									}}
								/>
							</button>
							<span>dark</span>
						</div>
					</div>

					<Slider {...settings}>
						{screenshots.map((screenshot) => (
							<div key={screenshot.light}>
								<button
									type="button"
									onClick={() => setLightbox(screenshot)}
									className="w-full cursor-zoom-in bg-transparent border-0 p-0 block leading-[0]"
									aria-label={`View ${screenshot.alt} fullscreen`}
								>
									<Compare
										firstImage={screenshot.light}
										secondImage={screenshot.dark}
										firstImageAlt={`${screenshot.alt} - Light mode`}
										secondImageAlt={`${screenshot.alt} - Dark mode`}
										initialPosition={50}
										className="!rounded-none"
										isDark={isDark}
									/>
								</button>
							</div>
						))}
					</Slider>
				</div>
				<p className="mt-4 text-center font-mono text-[11px] text-faint">
					toggle theme to compare · click to zoom
				</p>
			</div>
			{lightbox && (
				<Lightbox
					lightImage={lightbox.light}
					darkImage={lightbox.dark}
					alt={lightbox.alt}
					onClose={() => setLightbox(null)}
					isDark={isDark}
				/>
			)}
		</>
	);
}

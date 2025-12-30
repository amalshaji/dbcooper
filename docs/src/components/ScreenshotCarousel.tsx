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
			className="absolute left-2 sm:left-0 top-1/2 -translate-y-1/2 sm:-translate-x-12 z-10 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-neutral-100/90 dark:bg-neutral-800/90 hover:bg-neutral-200 dark:hover:bg-neutral-700 flex items-center justify-center text-neutral-600 dark:text-neutral-300 transition-all duration-200 hover:scale-105 shadow-md"
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
			className="absolute right-2 sm:right-0 top-1/2 -translate-y-1/2 sm:translate-x-12 z-10 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-neutral-100/90 dark:bg-neutral-800/90 hover:bg-neutral-200 dark:hover:bg-neutral-700 flex items-center justify-center text-neutral-600 dark:text-neutral-300 transition-all duration-200 hover:scale-105 shadow-md"
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
			<div className="relative z-10 max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl overflow-hidden">
				<Compare
					firstImage={lightImage}
					secondImage={darkImage}
					firstImageAlt={`${alt} - Light mode`}
					secondImageAlt={`${alt} - Dark mode`}
					initialPosition={50}
					isDark={isDark}
				/>
			</div>
		</div>
	);
}

const settings = {
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
		light: "/screenshots/simple-light.png",
		dark: "/screenshots/simple-dark.png",
		alt: "Table data view",
		label: "Table Data",
	},
	{
		light: "/screenshots/query-light.png",
		dark: "/screenshots/query-dark.png",
		alt: "SQL query editor",
		label: "Query Editor",
	},
	{
		light: "/screenshots/structure-light.png",
		dark: "/screenshots/structure-dark.png",
		alt: "Table structure view",
		label: "Table Structure",
	},
	{
		light: "/screenshots/cmd-light.png",
		dark: "/screenshots/cmd-dark.png",
		alt: "Command palette",
		label: "Command Palette",
	},
	{
		light: "/screenshots/visual-light.png",
		dark: "/screenshots/visual-dark.png",
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

	useEffect(() => {
		// Check system theme preference
		const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
		setIsDark(dark);
	}, []);

	const toggleTheme = () => {
		setIsDark(!isDark);
	};

	return (
		<>
			<div className="relative sm:px-8 lg:px-14">
				<Slider {...settings}>
					{screenshots.map((screenshot) => (
						<div key={screenshot.light} className="">
							<button
								type="button"
								onClick={() => setLightbox(screenshot)}
								className="w-full cursor-pointer group bg-transparent border-0 p-0 block"
								aria-label={`Click to view ${screenshot.alt} in fullscreen`}
							>
								<div className="relative leading-[0] rounded-xl overflow-hidden">
									<Compare
										firstImage={screenshot.light}
										secondImage={screenshot.dark}
										firstImageAlt={`${screenshot.alt} - Light mode`}
										secondImageAlt={`${screenshot.alt} - Dark mode`}
										initialPosition={50}
										className="rounded-lg shadow-lg group-hover:shadow-xl transition-shadow"
										isDark={isDark}
									/>
									<div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-2 sm:px-3 py-1 bg-black/70 text-white text-xs sm:text-sm rounded-full">
										{screenshot.label}
									</div>
								</div>
							</button>
						</div>
					))}
				</Slider>
				<div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mt-6 text-center sm:text-left">
					<div className="flex items-center gap-2">
						<span className="text-xs text-neutral-600 dark:text-neutral-300">
							Light
						</span>
						<button
							type="button"
							onClick={toggleTheme}
							className="relative inline-flex h-5 w-9 items-center rounded-full bg-neutral-200 dark:bg-neutral-700 transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2"
							aria-label="Toggle theme view"
						>
							<span
								className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
									isDark ? "translate-x-5" : "translate-x-0.5"
								}`}
							/>
						</button>
						<span className="text-xs text-neutral-600 dark:text-neutral-300">
							Dark
						</span>
					</div>
					<span className="text-xs text-neutral-500 dark:text-neutral-400">
						Toggle to compare themes • Click for fullscreen
					</span>
				</div>
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

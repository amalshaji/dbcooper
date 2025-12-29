import { useState, useEffect } from "react";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";

interface ArrowProps {
	onClick?: () => void;
}

function PrevArrow({ onClick }: ArrowProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-12 z-10 w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 flex items-center justify-center text-neutral-600 dark:text-neutral-300 transition-all duration-200 hover:scale-105 shadow-md"
			aria-label="Previous slide"
		>
			<svg
				className="w-5 h-5"
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
			className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 z-10 w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 flex items-center justify-center text-neutral-600 dark:text-neutral-300 transition-all duration-200 hover:scale-105 shadow-md"
			aria-label="Next slide"
		>
			<svg
				className="w-5 h-5"
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
	src: string;
	alt: string;
	onClose: () => void;
}

function Lightbox({ src, alt, onClose }: LightboxProps) {
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
			<img
				src={src}
				alt={alt}
				className="relative z-10 max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl"
			/>
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
	autoplaySpeed: 4000,
	arrows: true,
	prevArrow: <PrevArrow />,
	nextArrow: <NextArrow />,
};

const screenshots = [
	{ src: "/images/dbcooper.png", alt: "DBcooper interface" },
	{ src: "/images/aggregate.png", alt: "Complex query" },
];

export function ScreenshotCarousel() {
	const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(
		null,
	);

	return (
		<>
			<div className="relative px-14">
				<Slider {...settings}>
					{screenshots.map((screenshot) => (
						<div key={screenshot.src}>
							<button
								type="button"
								onClick={() => setLightbox(screenshot)}
								className="w-full cursor-zoom-in"
								aria-label={`View ${screenshot.alt} in fullscreen`}
							>
								<img
									src={screenshot.src}
									alt={screenshot.alt}
									className="w-full rounded-lg hover:opacity-95 transition-opacity"
								/>
							</button>
						</div>
					))}
				</Slider>
			</div>
			{lightbox && (
				<Lightbox
					src={lightbox.src}
					alt={lightbox.alt}
					onClose={() => setLightbox(null)}
				/>
			)}
		</>
	);
}

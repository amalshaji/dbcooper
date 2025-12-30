import { useState } from "react";

const features = [
	{
		icon: (
			<svg
				className="w-6 h-6"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				strokeWidth={1.5}
				aria-hidden="true"
			>
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
				/>
			</svg>
		),
		title: "Multi-Database Support",
		description:
			"PostgreSQL, SQLite, Redis, and ClickHouse — all in one beautiful interface.",
		gradient: "from-violet-500 to-purple-600",
	},
	{
		icon: (
			<svg
				className="w-6 h-6"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				strokeWidth={1.5}
				aria-hidden="true"
			>
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z"
				/>
			</svg>
		),
		title: "Schema Visualizer",
		description:
			"Interactive ER diagrams to explore table relationships at a glance.",
		gradient: "from-pink-500 to-rose-500",
	},
	{
		icon: (
			<svg
				className="w-6 h-6"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				strokeWidth={1.5}
				aria-hidden="true"
			>
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
				/>
			</svg>
		),
		title: "AI-Powered SQL",
		description:
			"Generate queries from natural language. Just describe what you need.",
		gradient: "from-amber-500 to-orange-500",
	},
	{
		icon: (
			<svg
				className="w-6 h-6"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				strokeWidth={1.5}
				aria-hidden="true"
			>
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"
				/>
			</svg>
		),
		title: "Command Palette",
		description:
			"Navigate at the speed of thought with keyboard-first controls.",
		gradient: "from-cyan-500 to-blue-500",
	},
	{
		icon: (
			<svg
				className="w-6 h-6"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				strokeWidth={1.5}
				aria-hidden="true"
			>
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
				/>
			</svg>
		),
		title: "SSH Tunnel Support",
		description: "Connect securely to remote databases through SSH tunnels.",
		gradient: "from-emerald-500 to-teal-500",
	},
	{
		icon: (
			<svg
				className="w-6 h-6"
				fill="currentColor"
				viewBox="0 0 24 24"
				aria-hidden="true"
			>
				<path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
			</svg>
		),
		title: "Native macOS App",
		description:
			"Built with Tauri for a fast, lightweight, and secure experience.",
		gradient: "from-neutral-600 to-neutral-800",
	},
];

export function Features() {
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

	return (
		<section id="features" className="py-20">
			<div className="text-center mb-12">
				<h2 className="text-2xl font-semibold mb-3">Everything you need</h2>
				<p className="text-neutral-500 dark:text-neutral-400 max-w-md mx-auto">
					A powerful database client designed for developers who value
					simplicity and speed.
				</p>
			</div>

			<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
				{features.map((feature, index) => (
					<div
						key={feature.title}
						className="group relative p-5 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800 hover:border-neutral-200 dark:hover:border-neutral-700 transition-all duration-300"
						onMouseEnter={() => setHoveredIndex(index)}
						onMouseLeave={() => setHoveredIndex(null)}
					>
						{/* Gradient blob on hover */}
						<div
							className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-500`}
						/>

						{/* Icon */}
						<div
							className={`relative w-10 h-10 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center text-white mb-4 shadow-lg`}
							style={{
								transform:
									hoveredIndex === index
										? "scale(1.05) rotate(-2deg)"
										: "scale(1) rotate(0deg)",
								transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
							}}
						>
							{feature.icon}
						</div>

						{/* Content */}
						<h3 className="relative font-medium mb-1.5 text-neutral-900 dark:text-neutral-100">
							{feature.title}
						</h3>
						<p className="relative text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
							{feature.description}
						</p>
					</div>
				))}
			</div>
		</section>
	);
}

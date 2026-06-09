const features = [
	{
		title: "Multi-database support",
		description:
			"PostgreSQL, SQLite, Redis, and ClickHouse — every engine in one consistent interface. No context-switching between five different apps.",
		icon: (
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75"
			/>
		),
	},
	{
		title: "Schema visualizer",
		description:
			"Interactive ER diagrams render your table relationships automatically. See the shape of your data, not just the rows.",
		icon: (
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z"
			/>
		),
	},
	{
		title: "AI-powered SQL",
		description:
			"Describe what you need in plain English and watch the query stream into the editor — schema-aware, ready to run.",
		icon: (
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
			/>
		),
	},
	{
		title: "Command palette",
		description:
			"Jump to any table, connection, or action with a keystroke. Keyboard-first, mouse-optional — built for speed.",
		icon: (
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"
			/>
		),
	},
	{
		title: "SSH tunnel support",
		description:
			"Reach databases behind a bastion securely. Password or private key — configured once, connected instantly.",
		icon: (
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
			/>
		),
	},
	{
		title: "Native & lightweight",
		description:
			"Built with Tauri, not Electron. A few megabytes, instant startup, and your credentials never leave the machine.",
		icon: (
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M13 16.5l3-3m0 0l-3-3m3 3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z"
			/>
		),
	},
];

export function Features() {
	return (
		<section id="features" className="relative border-t border-line py-20 md:py-24">
			{/* section header */}
			<div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-12">
				<div>
					<p className="mono-kicker">§ 01 — Capabilities</p>
					<h2 className="font-display text-4xl md:text-5xl font-semibold tracking-tight mt-3">
						Everything you need,
						<br />
						<span className="italic text-copper">nothing you don't.</span>
					</h2>
				</div>
				<p className="text-soft max-w-xs text-sm leading-relaxed md:text-right md:pb-2">
					A focused tool for developers who'd rather query than configure.
				</p>
			</div>

			{/* spec-sheet index */}
			<div className="border-t border-line-strong">
				{features.map((feature, index) => (
					<div
						key={feature.title}
						className="spec-row group grid grid-cols-[auto_1fr] md:grid-cols-[3rem_minmax(0,16rem)_1fr_auto] items-baseline gap-x-5 gap-y-2 border-b border-line py-7 px-2 md:px-4"
					>
						{/* index number */}
						<span className="font-mono text-sm text-copper tabular-nums pt-0.5">
							{String(index + 1).padStart(2, "0")}
						</span>

						{/* title */}
						<h3 className="font-display text-xl md:text-[1.45rem] font-medium tracking-tight self-start">
							{feature.title}
						</h3>

						{/* description */}
						<p className="col-span-2 md:col-span-1 text-sm md:text-[0.95rem] text-soft leading-relaxed max-w-xl">
							{feature.description}
						</p>

						{/* icon */}
						<svg
							className="hidden md:block w-6 h-6 text-faint group-hover:text-copper transition-colors justify-self-end self-start mt-0.5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={1.4}
							aria-hidden="true"
						>
							{feature.icon}
						</svg>
					</div>
				))}
			</div>
		</section>
	);
}

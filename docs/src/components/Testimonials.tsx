const testimonials = [
	{ quote: "The CSV download option is nice", author: "Milind", role: "user" },
	{ quote: "Oh! We added this too?", author: "Kishan", role: "contributor" },
	{ quote: "Are you making money with this?", author: "My Mom", role: "investor" },
];

export function Testimonials() {
	return (
		<section className="relative border-t border-line py-14">
			<p className="mono-kicker mb-8">Unsolicited reviews</p>
			<div className="grid sm:grid-cols-3 gap-px bg-line border border-line">
				{testimonials.map((t) => (
					<figure key={t.author} className="bg-paper p-6 flex flex-col gap-4">
						<svg
							className="w-7 h-7 text-copper/40"
							viewBox="0 0 24 24"
							fill="currentColor"
							aria-hidden="true"
						>
							<path d="M9.5 5C6.46 5 4 7.46 4 10.5V19h7v-8H6.5C6.5 8.57 7.85 7 9.5 7V5zm9 0C15.46 5 13 7.46 13 10.5V19h7v-8h-4.5c0-1.43 1.35-3 3-3V5z" />
						</svg>
						<blockquote className="font-display text-lg leading-snug text-ink flex-1">
							{t.quote}
						</blockquote>
						<figcaption className="font-mono text-xs text-faint">
							— {t.author}, <span className="text-copper">{t.role}</span>
						</figcaption>
					</figure>
				))}
			</div>
		</section>
	);
}

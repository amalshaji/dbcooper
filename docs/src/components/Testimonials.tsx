const testimonials = [
	{
		quote: "The CSV download option is nice",
		author: "Milind",
		gradient: "from-violet-500 to-purple-600",
	},
	{
		quote: "Oh! We added this too?",
		author: "Kishan",
		gradient: "from-pink-500 to-rose-500",
	},
	{
		quote: "Are you making money with this?",
		author: "My Mom",
		gradient: "from-amber-500 to-orange-500",
	},
];

export function Testimonials() {
	return (
		<section className="py-12">
			<div className="flex flex-col sm:flex-row items-stretch justify-center gap-3">
				{testimonials.map((testimonial) => (
					<div
						key={testimonial.author}
						className="group relative flex items-center gap-3 px-4 py-3 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800 hover:border-neutral-200 dark:hover:border-neutral-700 transition-all duration-300"
					>
						<div
							className={`absolute inset-0 rounded-xl bg-gradient-to-br ${testimonial.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-500`}
						/>
						<div
							className={`relative w-7 h-7 rounded-full bg-gradient-to-br ${testimonial.gradient} flex items-center justify-center text-white text-xs font-medium shrink-0`}
						>
							{testimonial.author.charAt(0)}
						</div>
						<div className="relative">
							<p className="text-sm text-neutral-700 dark:text-neutral-300">
								"{testimonial.quote}"
							</p>
							<p className="text-xs text-neutral-400 dark:text-neutral-500">
								{testimonial.author}
							</p>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

import { useState } from "react";

const faqs = [
	{
		question: "Is DBcooper free?",
		answer:
			"Yes! DBcooper is completely free and open source. You can find the source code on GitHub.",
	},
	{
		question: "Which databases are supported?",
		answer:
			"Currently, DBcooper supports PostgreSQL, SQLite, Redis, and ClickHouse. More database support is planned for future releases.",
	},
	{
		question: "Does it work on Windows or Linux?",
		answer:
			"DBcooper is currently available only for macOS. Windows and Linux versions are being considered for future development.",
	},
	{
		question: "How do I connect via SSH tunnel?",
		answer:
			"When adding a new connection, enable the SSH tunnel option and provide your SSH host, port, username, and authentication method (password or private key).",
	},
	{
		question: "Is my data secure?",
		answer:
			"Absolutely. DBcooper runs entirely on your local machine. Your connection credentials and data never leave your computer. We don't collect any telemetry or analytics.",
	},
	{
		question: "How do I report bugs or request features?",
		answer:
			"Head over to our GitHub repository and open an issue. We appreciate all feedback and contributions from the community!",
	},
];

export function FAQ() {
	const [openIndex, setOpenIndex] = useState<number | null>(null);

	return (
		<section id="faq" className="py-20 border-t border-neutral-100 dark:border-neutral-800">
			<div className="text-center mb-12">
				<h2 className="text-2xl font-semibold mb-3">
					Frequently asked questions
				</h2>
				<p className="text-neutral-500 dark:text-neutral-400">
					Got questions? We've got answers.
				</p>
			</div>

			<div className="max-w-2xl mx-auto space-y-3">
				{faqs.map((faq, index) => (
					<div
						key={faq.question}
						className="group rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800 overflow-hidden transition-all duration-200"
					>
						<button
							type="button"
							onClick={() => setOpenIndex(openIndex === index ? null : index)}
							className="w-full flex items-center justify-between p-4 text-left hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors"
						>
							<span className="font-medium text-neutral-900 dark:text-neutral-100 pr-4">
								{faq.question}
							</span>
							<div
								className={`flex-shrink-0 w-6 h-6 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center transition-all duration-300 ${
									openIndex === index
										? "rotate-180 bg-neutral-900 dark:bg-white"
										: ""
								}`}
							>
								<svg
									className={`w-3 h-3 transition-colors ${
										openIndex === index
											? "text-white dark:text-neutral-900"
											: "text-neutral-500 dark:text-neutral-400"
									}`}
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									strokeWidth={2.5}
									aria-hidden="true"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										d="M19.5 8.25l-7.5 7.5-7.5-7.5"
									/>
								</svg>
							</div>
						</button>

						<div
							className={`overflow-hidden transition-all duration-300 ease-out ${
								openIndex === index ? "max-h-48" : "max-h-0"
							}`}
						>
							<div className="px-4 pb-4 text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
								{faq.answer}
							</div>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

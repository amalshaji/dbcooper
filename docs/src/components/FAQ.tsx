import { useState } from "react";

const faqs = [
	{
		question: "Is DBcooper free?",
		answer:
			"Yes — completely free and open source. The full source lives on GitHub under the MIT license.",
	},
	{
		question: "Which databases are supported?",
		answer:
			"PostgreSQL, SQLite, Redis, and ClickHouse today. More engines are planned for future releases.",
	},
	{
		question: "Does it work on Windows or Linux?",
		answer:
			"DBcooper is macOS-only for now. Windows and Linux builds are being considered.",
	},
	{
		question: "How do I connect via SSH tunnel?",
		answer:
			"When adding a connection, enable the SSH tunnel option and provide your SSH host, port, username, and authentication method (password or private key).",
	},
	{
		question: "Is my data secure?",
		answer:
			"Absolutely. DBcooper runs entirely on your machine — connection credentials and query results never leave your computer, and there's no telemetry.",
	},
	{
		question: "How do I report bugs or request features?",
		answer:
			"Open an issue on the GitHub repository. All feedback and contributions are welcome.",
	},
];

export function FAQ() {
	const [openIndex, setOpenIndex] = useState<number | null>(0);

	return (
		<section
			id="faq"
			className="relative border-t border-line py-20 md:py-24"
		>
			<div className="grid lg:grid-cols-[18rem_1fr] gap-10 lg:gap-16">
				<div>
					<p className="mono-kicker">§ 02 — Questions</p>
					<h2 className="font-display text-4xl md:text-5xl font-semibold tracking-tight mt-3">
						Frequently
						<br />
						<span className="italic text-copper">asked.</span>
					</h2>
				</div>

				<div className="border-t border-line-strong">
					{faqs.map((faq, index) => {
						const open = openIndex === index;
						return (
							<div key={faq.question} className="border-b border-line">
								<button
									type="button"
									onClick={() => setOpenIndex(open ? null : index)}
									className="w-full flex items-start justify-between gap-6 py-5 text-left group"
								>
									<span className="font-mono text-xs text-copper tabular-nums pt-1.5 shrink-0">
										{String(index + 1).padStart(2, "0")}
									</span>
									<span className="font-display text-lg md:text-xl font-medium flex-1 group-hover:text-copper transition-colors">
										{faq.question}
									</span>
									<span
										className={`shrink-0 mt-1 text-copper transition-transform duration-300 ${
											open ? "rotate-45" : ""
										}`}
									>
										<svg
											className="w-5 h-5"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											strokeWidth={1.6}
											aria-hidden="true"
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												d="M12 4.5v15m7.5-7.5h-15"
											/>
										</svg>
									</span>
								</button>
								<div
									className={`grid transition-all duration-300 ease-out ${
										open
											? "grid-rows-[1fr] opacity-100"
											: "grid-rows-[0fr] opacity-0"
									}`}
								>
									<div className="overflow-hidden">
										<p className="text-soft leading-relaxed pb-6 pl-[2.7rem] pr-8 max-w-2xl">
											{faq.answer}
										</p>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</section>
	);
}

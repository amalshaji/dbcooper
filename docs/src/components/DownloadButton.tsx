import { useState, useEffect } from "react";

interface Release {
	tag_name: string;
	published_at: string;
}

type InstallTab = "brew" | "manual";

export function DownloadButton() {
	const [latestRelease, setLatestRelease] = useState<Release | null>(null);
	const [installTab, setInstallTab] = useState<InstallTab>("brew");

	useEffect(() => {
		fetch("https://api.github.com/repos/amalshaji/dbcooper/releases/latest")
			.then((response) => response.json())
			.then((data: Release) => setLatestRelease(data))
			.catch(() => {});
	}, []);

	const tabClass = (tab: InstallTab) =>
		`px-3 py-1.5 rounded-md border font-mono text-[11px] transition-colors ${
			installTab === tab
				? "border-copper/40 bg-copper/10 text-copper"
				: "border-line bg-surface/40 text-faint hover:text-soft"
		}`;

	return (
		<div className="flex flex-col items-start gap-4">
			{/* install method tabs — Homebrew (default) or manual .dmg */}
			<div className="w-full max-w-md">
				<div className="mb-3 flex gap-1" role="tablist" aria-label="Install method">
					<button
						type="button"
						role="tab"
						aria-selected={installTab === "brew"}
						onClick={() => setInstallTab("brew")}
						className={tabClass("brew")}
					>
						Homebrew
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={installTab === "manual"}
						onClick={() => setInstallTab("manual")}
						className={tabClass("manual")}
					>
						Manual
					</button>
				</div>

				<div className="min-h-[118px]">
				{installTab === "brew" ? (
					<div className="w-full rounded-lg border border-line bg-surface/60 p-3 font-mono text-[11px] leading-relaxed text-soft">
						<span className="text-faint">
							# install with Homebrew (recommended)
						</span>
						<br />
						<span className="select-all">
							<span className="text-copper">$</span> brew install --cask --force
							amalshaji/taps/dbcooper
						</span>
					</div>
				) : (
					<div className="flex flex-col gap-3">
						<a
							href="https://github.com/amalshaji/dbcooper/releases/latest"
							target="_blank"
							className="btn-copper self-start"
						>
							<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
								<path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
							</svg>
							Download for macOS
						</a>
						<div className="w-full rounded-lg border border-line bg-surface/60 p-3 font-mono text-[11px] leading-relaxed text-soft">
							<span className="text-faint">
								# direct .dmg download — clear quarantine before first launch
							</span>
							<br />
							<span className="select-all">
								<span className="text-copper">$</span> xattr -cr
								/Applications/DBcooper.app
							</span>
						</div>
					</div>
				)}
				</div>
			</div>

			<div className="font-mono text-xs text-faint flex items-center gap-2 h-4">
				{latestRelease && (
					<>
						<span className="text-copper">{latestRelease.tag_name}</span>
						<span className="text-line-strong">·</span>
						<span>Apple Silicon · Free &amp; open source</span>
					</>
				)}
			</div>
		</div>
	);
}

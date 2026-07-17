import { ArrowLeft } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { SettingsForm } from "@/components/SettingsForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function Settings() {
	const navigate = useNavigate();

	return (
		<div className="workspace-canvas flex min-h-screen flex-col">
			<header
				data-tauri-drag-region
				className="app-titlebar flex h-12 shrink-0 select-none items-center border-b px-4 pl-24"
			>
				<Button variant="ghost" onClick={() => navigate("/")}>
					<ArrowLeft className="h-4 w-4" />
					Back
				</Button>
			</header>

			<main className="flex-1 overflow-auto p-5 md:p-8">
				<div className="mx-auto max-w-2xl">
					<div className="mb-5">
						<p className="section-label">DBcooper</p>
						<h1 className="mt-1 text-2xl font-semibold tracking-tight">
							Settings
						</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							Appearance, updates, and contextual AI.
						</p>
					</div>
					<Card className="workspace-panel">
						<CardHeader className="border-b py-4">
							<CardTitle className="text-sm">Application preferences</CardTitle>
						</CardHeader>
						<CardContent className="pt-5">
							<SettingsForm />
						</CardContent>
					</Card>
				</div>
			</main>
		</div>
	);
}

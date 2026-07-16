import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { ArrowLeft } from "@phosphor-icons/react";
import { handleDragStart } from "@/lib/windowDrag";
import { SettingsForm } from "@/components/SettingsForm";

export function Settings() {
	const navigate = useNavigate();

	return (
		<div className="flex min-h-screen flex-col bg-transparent">
			<header
				onMouseDown={handleDragStart}
				className="app-titlebar flex h-12 shrink-0 select-none items-center border-b px-4 pl-24"
			>
				<Button variant="ghost" onClick={() => navigate("/")}>
					<ArrowLeft className="h-4 w-4" />
					Back
				</Button>
			</header>

			<div className="flex-1 overflow-auto p-6 md:p-10">
				<div className="mx-auto max-w-3xl">
					<Card className="app-surface">
						<CardHeader>
							<CardTitle className="text-lg tracking-tight">Settings</CardTitle>
							<CardDescription>
								Appearance, updates, and contextual AI
							</CardDescription>
						</CardHeader>
						<CardContent>
							<SettingsForm />
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}

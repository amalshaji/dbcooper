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
		<div className="min-h-screen bg-background flex flex-col">
			<header
				onMouseDown={handleDragStart}
				className="h-12 shrink-0 flex items-center gap-2 px-4 pl-24 border-b bg-background select-none"
			>
				<Button variant="ghost" onClick={() => navigate("/")}>
					<ArrowLeft className="h-4 w-4" />
					Back
				</Button>
			</header>

			<div className="flex-1 p-8 overflow-auto text-lg">
				<div className="max-w-2xl mx-auto">
					<Card>
						<CardHeader>
							<CardTitle>Settings</CardTitle>
							<CardDescription>Configure your preferences</CardDescription>
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

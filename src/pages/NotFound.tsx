import { ArrowLeft } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFound() {
	const navigate = useNavigate();

	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-6">
			<div className="w-full max-w-sm text-center">
				<p className="font-mono text-7xl font-semibold tracking-tighter text-primary tabular-figures">
					404
				</p>
				<h1 className="mt-4 text-lg font-semibold tracking-tight">
					Page not found
				</h1>
				<p className="mt-1.5 text-sm text-muted-foreground">
					This route doesn&apos;t exist or has moved.
				</p>
				<Button className="mt-6" onClick={() => navigate("/")}>
					<ArrowLeft className="size-4" />
					Back to connections
				</Button>
			</div>
		</div>
	);
}

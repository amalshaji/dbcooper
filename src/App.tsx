import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { SettingsProvider } from "@/contexts/SettingsContext";

const Connections = lazy(() =>
	import("@/pages/Connections").then((module) => ({
		default: module.Connections,
	})),
);
const ConnectionDetails = lazy(() =>
	import("@/pages/ConnectionDetails").then((module) => ({
		default: module.ConnectionDetails,
	})),
);
const Settings = lazy(() =>
	import("@/pages/Settings").then((module) => ({ default: module.Settings })),
);
const NotFound = lazy(() =>
	import("@/pages/NotFound").then((module) => ({ default: module.NotFound })),
);

export function App() {
	return (
		<BrowserRouter>
			<ThemeProvider>
				<SettingsProvider>
					<Suspense
						fallback={
							<div className="flex h-screen items-center justify-center bg-background">
								<Spinner className="size-5" />
							</div>
						}
					>
						<Routes>
							<Route path="/" element={<Connections />} />
							<Route
								path="/connections/:uuid"
								element={<ConnectionDetails />}
							/>
							<Route path="/settings" element={<Settings />} />
							<Route path="*" element={<NotFound />} />
						</Routes>
					</Suspense>
					<Toaster />
				</SettingsProvider>
			</ThemeProvider>
		</BrowserRouter>
	);
}

export default App;

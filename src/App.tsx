import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Connections } from "@/pages/Connections";
import { ConnectionDetails } from "@/pages/ConnectionDetails";
import { Settings } from "@/pages/Settings";
import { NotFound } from "@/pages/NotFound";
import { Toaster } from "@/components/ui/sonner";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { ActiveConnectionsProvider } from "@/contexts/ActiveConnectionsContext";

export function App() {
  return (
    <BrowserRouter>
      <SettingsProvider>
        <ActiveConnectionsProvider>
          <div className="hidden">
            <ThemeSwitcher />
          </div>
          <Routes>
            <Route path="/" element={<Connections />} />
            <Route path="/connections/:uuid" element={<ConnectionDetails />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <Toaster />
        </ActiveConnectionsProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
}

export default App;

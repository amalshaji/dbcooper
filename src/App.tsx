import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Connections } from "@/pages/Connections";
import { ConnectionDetails } from "@/pages/ConnectionDetails";
import { Settings } from "@/pages/Settings";
import { NotFound } from "@/pages/NotFound";
import { Toaster } from "@/components/ui/sonner";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { SettingsProvider } from "@/contexts/SettingsContext";

export function App() {
  return (
    <BrowserRouter>
      <SettingsProvider>
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
      </SettingsProvider>
    </BrowserRouter>
  );
}

export default App;
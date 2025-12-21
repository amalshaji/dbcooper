import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Connections } from "@/pages/Connections";
import { ConnectionDetails } from "@/pages/ConnectionDetails";
import { Settings } from "@/pages/Settings";
import { NotFound } from "@/pages/NotFound";
import { Toaster } from "@/components/ui/sonner";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Connections />} />
        <Route path="/connections/:uuid" element={<ConnectionDetails />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}

export default App;
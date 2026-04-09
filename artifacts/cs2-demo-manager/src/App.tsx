import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppProvider } from "./context/AppContext";
import { Navbar } from "./components/Navbar";
import { StatusBar } from "./components/StatusBar";
import { HomePage } from "./pages/HomePage";
import { LibraryPage } from "./pages/LibraryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LicensePage } from "./pages/LicensePage";
import { getLicenseStatus } from "./services/licenseService";
import "./i18n/index";

const queryClient = new QueryClient();

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center text-center px-6">
      <div>
        <p className="text-white/20 text-6xl font-bold">404</p>
        <p className="text-white/40 mt-4 text-sm">Page not found</p>
      </div>
    </div>
  );
}

function AppRouter() {
  return (
    <div className="min-h-screen pt-14">
      <Navbar />
      <main>
        <Switch>
          <Route path="/library" component={LibraryPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/" component={HomePage} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <StatusBar />
    </div>
  );
}

function App() {
  const [licensed, setLicensed] = useState<boolean | null>(null);

  useEffect(() => {
    const status = getLicenseStatus();
    setLicensed(status === "active" || status === "offline_grace");
  }, []);

  if (licensed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0d1117]">
        <div className="w-8 h-8 border-2 border-orange-500/40 border-t-orange-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!licensed) {
    return (
      <LicensePage
        onActivated={() => {
          const status = getLicenseStatus();
          setLicensed(status === "active" || status === "offline_grace");
        }}
      />
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppRouter />
        </WouterRouter>
      </AppProvider>
    </QueryClientProvider>
  );
}

export default App;

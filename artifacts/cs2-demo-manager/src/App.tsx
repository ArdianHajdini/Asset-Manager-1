import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppProvider } from "./context/AppContext";
import { FaceitProvider } from "./context/FaceitContext";
import { Navbar } from "./components/Navbar";
import { StatusBar } from "./components/StatusBar";
import { HomePage } from "./pages/HomePage";
import { LibraryPage } from "./pages/LibraryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { FaceitPage } from "./pages/FaceitPage";
import { FaceitCallbackPage } from "./pages/FaceitCallbackPage";

const queryClient = new QueryClient();

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center text-center px-6">
      <div>
        <p className="text-white/20 text-6xl font-bold">404</p>
        <p className="text-white/40 mt-4 text-sm">Seite nicht gefunden</p>
      </div>
    </div>
  );
}

function Router() {
  return (
    <div className="min-h-screen pt-14">
      <Navbar />
      <main>
        <Switch>
          <Route path="/faceit" component={FaceitPage} />
          <Route path="/faceit/callback" component={FaceitCallbackPage} />
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
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <FaceitProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </FaceitProvider>
      </AppProvider>
    </QueryClientProvider>
  );
}

export default App;

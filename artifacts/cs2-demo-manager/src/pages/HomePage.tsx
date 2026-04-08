
import { useLocation } from "wouter";
import { Library, Settings, AlertCircle, CheckCircle } from "lucide-react";
import { DropZone } from "../components/DropZone";
import { useApp } from "../context/AppContext";
import { getCS2Status } from "../services/cs2Service";
import { cn } from "@/lib/utils";

export function HomePage() {
  const { settings, demos } = useApp();
  const [, navigate] = useLocation();
  const cs2Status = getCS2Status(settings.cs2Path);

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">

      {/* CS2 warning banner */}
      {cs2Status !== "found" && (
        <div className="mb-6 flex items-start gap-3 p-4 rounded-xl border border-amber-700/40 bg-amber-900/20">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-amber-300 text-sm font-medium">CS2 nicht konfiguriert</p>
            <p className="text-amber-200/60 text-xs mt-0.5">
              Damit Demos mit einem Klick gestartet werden können, muss der CS2-Pfad eingestellt sein.
            </p>
          </div>
          <button
            onClick={() => navigate("/settings")}
            className="text-amber-400 hover:text-amber-300 text-xs font-medium underline underline-offset-2 transition-colors"
          >
            Einstellungen
          </button>
        </div>
      )}

      {cs2Status === "found" && (
        <div className="mb-6 flex items-center gap-3 p-4 rounded-xl border border-green-700/30 bg-green-900/15">
          <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
          <p className="text-green-300 text-sm">CS2 gefunden — bereit zum Starten</p>
        </div>
      )}

      {/* Hero */}
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-white tracking-tight">Demo importieren</h1>
        <p className="text-white/45 text-sm mt-2">
          Ziehe eine .dem, .dem.gz oder .dem.zst Datei hier rein oder wähle sie per Knopfdruck aus.
        </p>
      </div>

      {/* Drop zone */}
      <DropZone onSuccess={() => navigate("/library")} />

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <button
          onClick={() => navigate("/library")}
          className="group flex items-center gap-3 p-5 rounded-xl border border-white/8 bg-white/3 hover:bg-white/6 hover:border-white/15 transition-all duration-150"
        >
          <div className="w-10 h-10 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center group-hover:bg-orange-500/20 transition-colors">
            <Library className="w-5 h-5 text-orange-400" />
          </div>
          <div className="text-left">
            <p className="text-white/80 font-semibold text-sm">Bibliothek öffnen</p>
            <p className="text-white/35 text-xs mt-0.5">
              {demos.length} {demos.length === 1 ? "Demo" : "Demos"} gespeichert
            </p>
          </div>
        </button>

        <button
          onClick={() => navigate("/settings")}
          className="group flex items-center gap-3 p-5 rounded-xl border border-white/8 bg-white/3 hover:bg-white/6 hover:border-white/15 transition-all duration-150"
        >
          <div className="w-10 h-10 rounded-xl bg-white/8 border border-white/15 flex items-center justify-center group-hover:bg-white/12 transition-colors">
            <Settings className="w-5 h-5 text-white/50" />
          </div>
          <div className="text-left">
            <p className="text-white/80 font-semibold text-sm">Einstellungen</p>
            <p className="text-white/35 text-xs mt-0.5">Pfade & Optionen</p>
          </div>
        </button>
      </div>

      {/* Status info */}
      <div className={cn(
        "mt-8 grid grid-cols-2 gap-3 text-center"
      )}>
        {[
          { label: "Demo-Ordner", value: settings.demoDirectory, mono: true },
          { label: "Auto-Entpacken", value: settings.autoExtractGz ? "Aktiviert" : "Deaktiviert", mono: false },
        ].map(({ label, value, mono }) => (
          <div key={label} className="p-3 rounded-lg bg-white/3 border border-white/6">
            <p className="text-white/35 text-xs">{label}</p>
            <p className={cn(
              "text-white/60 text-xs mt-1 truncate",
              mono ? "font-mono" : "font-medium"
            )}>
              {value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

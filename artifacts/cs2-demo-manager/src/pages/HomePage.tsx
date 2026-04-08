
import { useState } from "react";
import { useLocation } from "wouter";
import { Library, Settings, AlertCircle, CheckCircle, Download, Loader2 } from "lucide-react";
import { DropZone } from "../components/DropZone";
import { useApp } from "../context/AppContext";
import { getCS2Status } from "../services/cs2Service";
import { isTauri } from "../services/tauriBridge";
import { scanDownloadsFolder, processCandidates } from "../services/downloadsService";
import { cn } from "@/lib/utils";

export function HomePage() {
  const { settings, demos, setStatus, refreshDemos } = useApp();
  const [, navigate] = useLocation();
  const [scanning, setScanning] = useState(false);
  const cs2Status = getCS2Status(settings.cs2Path);

  async function handleScanDownloads() {
    const folder = settings.downloadsFolder;
    const replayFolder = settings.demoDirectory;

    if (!folder) {
      setStatus({ type: "error", message: "Kein Downloads-Ordner konfiguriert. Bitte in den Einstellungen festlegen." });
      navigate("/settings");
      return;
    }
    if (!replayFolder) {
      setStatus({ type: "error", message: "Kein CS2 Replay-Ordner konfiguriert. Bitte CS2 in den Einstellungen erkennen lassen." });
      navigate("/settings");
      return;
    }

    setScanning(true);
    try {
      const { candidates, errors } = await scanDownloadsFolder(folder);
      if (errors.length > 0) { setStatus({ type: "error", message: errors[0] }); return; }
      if (candidates.length === 0) {
        setStatus({ type: "info", message: "Im Downloads-Ordner wurde keine neue Demo gefunden." });
        return;
      }
      setStatus({ type: "info", message: `${candidates.length} Demo(s) gefunden — wird verarbeitet...` });
      const result = await processCandidates(candidates, replayFolder);
      await refreshDemos();
      const parts: string[] = [];
      if (result.processed.length > 0) {
        parts.push(`${result.processed.length} Demo(s) wurden im Replay-Ordner gespeichert.`);
        navigate("/library");
      }
      if (result.skipped.length > 0) parts.push(`${result.skipped.length} bereits vorhanden.`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} Fehler.`);
      setStatus({ type: result.processed.length > 0 ? "success" : "info", message: parts.join(" ") || "Keine neuen Demos." });
    } catch (err) {
      setStatus({ type: "error", message: String(err) });
    } finally {
      setScanning(false);
    }
  }

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

        {isTauri() ? (
          <button
            onClick={handleScanDownloads}
            disabled={scanning}
            className="group flex items-center gap-3 p-5 rounded-xl border border-orange-500/20 bg-orange-500/5 hover:bg-orange-500/10 hover:border-orange-500/35 transition-all duration-150 disabled:opacity-50"
          >
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center group-hover:bg-orange-500/25 transition-colors">
              {scanning
                ? <Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
                : <Download className="w-5 h-5 text-orange-400" />
              }
            </div>
            <div className="text-left">
              <p className="text-white/80 font-semibold text-sm">
                {scanning ? "Wird gescannt..." : "Downloads scannen"}
              </p>
              <p className="text-white/35 text-xs mt-0.5">
                {settings.downloadsFolder ? "Demos importieren" : "Downloads-Ordner konfigurieren"}
              </p>
            </div>
          </button>
        ) : (
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
        )}
      </div>

      {/* Settings quick link (when in Tauri mode, settings moved to a separate row) */}
      {isTauri() && (
        <div className="mt-3">
          <button
            onClick={() => navigate("/settings")}
            className="group flex items-center gap-3 p-4 w-full rounded-xl border border-white/8 bg-white/3 hover:bg-white/6 hover:border-white/15 transition-all duration-150"
          >
            <div className="w-8 h-8 rounded-lg bg-white/8 border border-white/15 flex items-center justify-center group-hover:bg-white/12 transition-colors">
              <Settings className="w-4 h-4 text-white/50" />
            </div>
            <div className="text-left">
              <p className="text-white/70 font-medium text-sm">Einstellungen</p>
              <p className="text-white/30 text-xs mt-0.5">CS2-Pfad, Replay-Ordner, Downloads-Ordner konfigurieren</p>
            </div>
          </button>
        </div>
      )}

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

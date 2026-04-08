import { useState } from "react";
import {
  Save, FolderOpen, Crosshair, Info, Search, Loader2, CheckCircle2,
  RefreshCw, FolderSearch, Download, Shield, Key, WifiOff,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useFaceit } from "../context/FaceitContext";
import { detectCS2Path, detectReplayFolder } from "../services/cs2Service";
import { isTauri, tauriOpenFolder } from "../services/tauriBridge";
import { tauriDetectDownloadsFolder } from "../services/tauriBridge";
import { scanDownloadsFolder, processCandidates } from "../services/downloadsService";
import { cn } from "@/lib/utils";

export function SettingsPage() {
  const { settings, updateSettings, setStatus, refreshDemos } = useApp();
  const { connection, disconnect } = useFaceit();

  const [form, setForm] = useState({ ...settings });
  const [saved, setSaved] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [detectingDownloads, setDetectingDownloads] = useState(false);
  const [scanning, setScanning] = useState(false);

  // ── Save ─────────────────────────────────────────────────────────────────
  async function handleSave() {
    updateSettings(form);
    setStatus({ type: "success", message: "Einstellungen gespeichert." });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // ── CS2 auto-detect ──────────────────────────────────────────────────────
  async function handleAutoDetect() {
    setDetecting(true);
    try {
      const result = await detectCS2Path();
      if (result) {
        const updated = {
          steamPath: result.steamPath,
          cs2Path: result.cs2Path,
          demoDirectory: result.replayFolder,
        };
        setForm((f) => ({ ...f, ...updated }));
        updateSettings(updated);
        await refreshDemos();
        setStatus({
          type: "success",
          message: `CS2 gefunden und gespeichert. Replay-Ordner: ${result.replayFolder}`,
        });
      } else {
        setStatus({ type: "error", message: "CS2 wurde nicht automatisch gefunden. Bitte den Pfad manuell eintragen." });
      }
    } catch {
      setStatus({ type: "error", message: "Fehler bei der automatischen Erkennung." });
    } finally {
      setDetecting(false);
    }
  }

  // ── Open replay folder ───────────────────────────────────────────────────
  async function handleOpenReplayFolder() {
    const folder = form.demoDirectory || settings.demoDirectory;
    if (!folder) { setStatus({ type: "error", message: "Kein Replay-Ordner konfiguriert." }); return; }
    try { await tauriOpenFolder(folder); } catch { setStatus({ type: "info", message: `Ordner: ${folder}` }); }
  }

  // ── Detect replay folder from steam path ─────────────────────────────────
  async function handleDetectReplayFolder() {
    const steam = form.steamPath;
    if (!steam) {
      setStatus({ type: "error", message: "Bitte erst den Steam-Pfad eintragen oder CS2 automatisch erkennen lassen." });
      return;
    }
    try {
      const folder = await detectReplayFolder(steam);
      if (folder) {
        setForm((f) => ({ ...f, demoDirectory: folder }));
        updateSettings({ demoDirectory: folder });
        await refreshDemos();
        setStatus({ type: "success", message: `Replay-Ordner gefunden und gespeichert: ${folder}` });
      }
    } catch {
      setStatus({ type: "error", message: "Replay-Ordner konnte nicht ermittelt werden." });
    }
  }

  // ── Refresh library ──────────────────────────────────────────────────────
  async function handleRefreshLibrary() {
    setRefreshing(true);
    try {
      await refreshDemos();
      setStatus({ type: "success", message: "Demo-Bibliothek aus dem Ordner neu geladen." });
    } catch {
      setStatus({ type: "error", message: "Fehler beim Laden der Demo-Bibliothek." });
    } finally {
      setRefreshing(false);
    }
  }

  // ── Auto-detect downloads folder ─────────────────────────────────────────
  async function handleAutoDetectDownloads() {
    if (!isTauri()) return;
    setDetectingDownloads(true);
    try {
      const folder = await tauriDetectDownloadsFolder();
      if (folder) {
        setForm((f) => ({ ...f, downloadsFolder: folder }));
        updateSettings({ downloadsFolder: folder });
        setStatus({ type: "success", message: `Downloads-Ordner erkannt: ${folder}` });
      } else {
        setStatus({ type: "error", message: "Downloads-Ordner konnte nicht automatisch erkannt werden." });
      }
    } catch {
      setStatus({ type: "error", message: "Fehler bei der Erkennung des Downloads-Ordners." });
    } finally {
      setDetectingDownloads(false);
    }
  }

  // ── Open downloads folder ─────────────────────────────────────────────────
  async function handleOpenDownloadsFolder() {
    const folder = form.downloadsFolder || settings.downloadsFolder;
    if (!folder) { setStatus({ type: "error", message: "Kein Downloads-Ordner konfiguriert." }); return; }
    try { await tauriOpenFolder(folder); } catch { setStatus({ type: "info", message: `Ordner: ${folder}` }); }
  }

  // ── Scan downloads folder ─────────────────────────────────────────────────
  async function handleScanDownloads() {
    const folder = form.downloadsFolder || settings.downloadsFolder;
    if (!folder) {
      setStatus({ type: "error", message: "Bitte zuerst einen Downloads-Ordner konfigurieren." });
      return;
    }
    const replayFolder = form.demoDirectory || settings.demoDirectory;
    if (!replayFolder) {
      setStatus({ type: "error", message: "Kein CS2 Replay-Ordner konfiguriert. Bitte CS2 zuerst einrichten." });
      return;
    }

    setScanning(true);
    try {
      const { candidates, errors } = await scanDownloadsFolder(folder);
      if (errors.length > 0) {
        setStatus({ type: "error", message: errors[0] });
        return;
      }
      if (candidates.length === 0) {
        setStatus({ type: "info", message: "Im Downloads-Ordner wurde keine neue Demo gefunden." });
        return;
      }

      setStatus({ type: "info", message: `${candidates.length} Demo-Datei(en) gefunden — wird verarbeitet...` });
      const result = await processCandidates(candidates, replayFolder);
      await refreshDemos();

      const parts: string[] = [];
      if (result.processed.length > 0) parts.push(`${result.processed.length} Demo(s) wurden im Replay-Ordner gespeichert.`);
      if (result.skipped.length > 0) parts.push(`${result.skipped.length} bereits vorhanden (übersprungen).`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} Fehler.`);

      setStatus({
        type: result.processed.length > 0 ? "success" : "info",
        message: parts.join(" ") || "Keine neuen Demos verarbeitet.",
      });
    } catch (err) {
      setStatus({ type: "error", message: String(err) });
    } finally {
      setScanning(false);
    }
  }

  // ── Folder / file pickers ────────────────────────────────────────────────
  async function handlePickFolder(field: "demoDirectory" | "downloadsFolder") {
    if (!isTauri()) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, multiple: false });
      if (dir && typeof dir === "string") setForm((f) => ({ ...f, [field]: dir }));
    } catch { /* dialog not available */ }
  }

  async function handlePickFile(field: "cs2Path") {
    if (!isTauri()) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const file = await open({ multiple: false, filters: [{ name: "Ausführbare Datei", extensions: ["exe"] }] });
      if (file && typeof file === "string") setForm((f) => ({ ...f, [field]: file }));
    } catch { /* dialog not available */ }
  }

  const labelClass = "block text-white/60 text-xs font-medium mb-2";

  function PathInput({ label, value, onChange, placeholder, onBrowseDir, onBrowseFile, hint }: {
    label: string; value: string; onChange: (v: string) => void;
    placeholder: string; onBrowseDir?: () => void; onBrowseFile?: () => void; hint?: string;
  }) {
    return (
      <div>
        <label className={labelClass}>{label}</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-orange-500/50 transition-colors font-mono"
          />
          {isTauri() && (onBrowseDir || onBrowseFile) && (
            <button
              onClick={onBrowseDir ?? onBrowseFile}
              title="Durchsuchen"
              className="px-3 py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 transition-all"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          )}
        </div>
        {hint && <p className="text-white/25 text-xs mt-2">{hint}</p>}
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Einstellungen</h1>
        <p className="text-white/40 text-sm mt-1">Pfade und Optionen konfigurieren</p>
      </div>

      <div className="space-y-6">

        {/* ── FACEIT-Status ─────────────────────────────────────────── */}
        <Section title="FACEIT-Verbindung" icon={Shield}>
          {connection ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {connection.avatar && (
                  <img src={connection.avatar} alt="" className="w-8 h-8 rounded-full" />
                )}
                <div>
                  <p className="text-white font-semibold text-sm">{connection.nickname}</p>
                  <p className="text-white/40 text-xs mt-0.5 flex items-center gap-1">
                    {connection.authMethod === "api_key" ? (
                      <><Key className="w-3 h-3" /> API-Schlüssel</>
                    ) : (
                      <><Shield className="w-3 h-3" /> OAuth</>
                    )}
                    {connection.elo && <> · {connection.elo} ELO</>}
                  </p>
                </div>
              </div>
              <button
                onClick={disconnect}
                className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/3 hover:bg-white/8 text-white/40 hover:text-white/70 text-xs transition-all"
              >
                Trennen
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <WifiOff className="w-4 h-4 text-white/25" />
              <div>
                <p className="text-white/50 text-sm">Nicht verbunden</p>
                <p className="text-white/25 text-xs mt-0.5">FACEIT-Seite öffnen, um Konto zu verbinden</p>
              </div>
            </div>
          )}
        </Section>

        {/* ── CS2-Pfad ─────────────────────────────────────────────── */}
        <Section title="CS2-Pfad" icon={Crosshair}>
          {isTauri() && (
            <button
              onClick={handleAutoDetect}
              disabled={detecting}
              className={cn(
                "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-all duration-150 mb-4",
                "border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20 text-orange-300",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {detecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {detecting ? "Suche..." : "CS2 automatisch erkennen"}
            </button>
          )}

          <PathInput
            label="Pfad zur cs2.exe"
            value={form.cs2Path}
            onChange={(v) => setForm((f) => ({ ...f, cs2Path: v }))}
            placeholder="C:\Program Files (x86)\Steam\...\game\bin\win64\cs2.exe"
            onBrowseFile={() => handlePickFile("cs2Path")}
          />

          <div className="mt-4">
            <PathInput
              label="Steam-Installationspfad"
              value={form.steamPath}
              onChange={(v) => setForm((f) => ({ ...f, steamPath: v }))}
              placeholder="C:\Program Files (x86)\Steam"
              onBrowseDir={() => {
                if (!isTauri()) return;
                import("@tauri-apps/plugin-dialog").then(({ open }) =>
                  open({ directory: true, multiple: false }).then((dir) => {
                    if (dir && typeof dir === "string") setForm((f) => ({ ...f, steamPath: dir }));
                  })
                );
              }}
            />
          </div>
        </Section>

        {/* ── CS2 Replay-Ordner ────────────────────────────────────── */}
        <Section title="CS2 Replay-Ordner" icon={FolderSearch}>
          <div className="mb-3 flex items-start gap-2 p-3 rounded-lg bg-orange-900/15 border border-orange-700/25">
            <Info className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
            <p className="text-orange-200/70 text-xs">
              CS2 lädt Demos per <span className="font-mono text-orange-200/90">playdemo replays/DATEINAME</span> relativ zum csgo-Ordner. Demos müssen im Replay-Ordner liegen.
            </p>
          </div>

          <PathInput
            label="Replay-Ordner (CS2 Demo-Speicherort)"
            value={form.demoDirectory}
            onChange={(v) => setForm((f) => ({ ...f, demoDirectory: v }))}
            placeholder="C:\...\Counter-Strike Global Offensive\game\csgo\replays"
            onBrowseDir={() => handlePickFolder("demoDirectory")}
          />

          {isTauri() && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={handleOpenReplayFolder}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white/50 hover:text-white/80 hover:bg-white/8 border border-white/10 transition-all"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Ordner öffnen
              </button>
              {form.steamPath && (
                <button
                  onClick={handleDetectReplayFolder}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white/50 hover:text-white/80 hover:bg-white/8 border border-white/10 transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Neu erkennen
                </button>
              )}
              <button
                onClick={handleRefreshLibrary}
                disabled={refreshing}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white/50 hover:text-white/80 hover:bg-white/8 border border-white/10 transition-all disabled:opacity-50"
              >
                {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Bibliothek neu einlesen
              </button>
            </div>
          )}
        </Section>

        {/* ── Downloads-Ordner ─────────────────────────────────────── */}
        <Section title="Downloads-Ordner" icon={Download}>
          <div className="mb-3 flex items-start gap-2 p-3 rounded-lg bg-blue-900/15 border border-blue-700/25">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-blue-200/70 text-xs">
              Der Downloads-Ordner wird nach <span className="font-mono text-blue-200/90">.dem</span>,{" "}
              <span className="font-mono text-blue-200/90">.dem.gz</span> und{" "}
              <span className="font-mono text-blue-200/90">.dem.zst</span> Dateien gescannt.
              Gefundene Demos werden automatisch entpackt und in den CS2 Replay-Ordner verschoben.
            </p>
          </div>

          <PathInput
            label="Downloads-Ordner"
            value={form.downloadsFolder}
            onChange={(v) => setForm((f) => ({ ...f, downloadsFolder: v }))}
            placeholder="C:\Users\Name\Downloads"
            onBrowseDir={() => handlePickFolder("downloadsFolder")}
            hint="Wird automatisch erkannt, wenn leer."
          />

          {isTauri() && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={handleAutoDetectDownloads}
                disabled={detectingDownloads}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white/50 hover:text-white/80 hover:bg-white/8 border border-white/10 transition-all disabled:opacity-50"
              >
                {detectingDownloads ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Ordner automatisch erkennen
              </button>
              <button
                onClick={handleOpenDownloadsFolder}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white/50 hover:text-white/80 hover:bg-white/8 border border-white/10 transition-all"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Ordner öffnen
              </button>
              <button
                onClick={handleScanDownloads}
                disabled={scanning}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-orange-300 hover:text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 transition-all disabled:opacity-50"
              >
                {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {scanning ? "Wird gescannt..." : "Downloads-Ordner scannen"}
              </button>
            </div>
          )}
        </Section>

        {/* ── Optionen ─────────────────────────────────────────────── */}
        <Section title="Optionen">
          <div className="space-y-4">
            <Toggle
              label="Automatisch entpacken"
              description=".dem.gz und .dem.zst Dateien werden beim Import automatisch zu .dem entpackt"
              value={form.autoExtractGz}
              onChange={(v) => setForm((f) => ({ ...f, autoExtractGz: v }))}
            />
            <Toggle
              label="Nach Import zur Bibliothek hinzufügen"
              description="Importierte Demos werden automatisch in der Bibliothek gespeichert"
              value={form.autoAddToLibrary}
              onChange={(v) => setForm((f) => ({ ...f, autoAddToLibrary: v }))}
            />
          </div>
        </Section>

        {/* Environment banners */}
        {!isTauri() && (
          <div className="flex items-start gap-3 p-4 rounded-xl border border-yellow-700/30 bg-yellow-900/15">
            <Info className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-300 text-sm font-medium">Browser-Vorschau aktiv</p>
              <p className="text-yellow-200/55 text-xs mt-1">
                Dateisystem-Zugriff, Ordner öffnen und CS2 starten sind nur in der Desktop-App verfügbar.
              </p>
            </div>
          </div>
        )}
        {isTauri() && (
          <div className="flex items-center gap-2 p-3 rounded-xl border border-green-700/25 bg-green-900/10">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <p className="text-green-300/80 text-xs">Desktop-App aktiv — alle Funktionen verfügbar.</p>
          </div>
        )}

        {/* Save */}
        <button
          onClick={handleSave}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all duration-150",
            saved
              ? "bg-green-600 text-white"
              : "bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-white"
          )}
        >
          <Save className="w-4 h-4" />
          {saved ? "Gespeichert!" : "Einstellungen speichern"}
        </button>
      </div>
    </div>
  );
}

// ── Helper components ────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: {
  title: string; icon?: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div className="p-5 rounded-xl border border-white/8 bg-white/3">
      <div className="flex items-center gap-2 mb-4">
        {Icon && <Icon className="w-4 h-4 text-orange-400" />}
        <h2 className="text-white font-semibold text-sm">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, description, value, onChange }: {
  label: string; description: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-white/70 text-sm font-medium">{label}</p>
        <p className="text-white/30 text-xs mt-0.5">{description}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={cn(
          "relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0",
          value ? "bg-orange-500" : "bg-white/15"
        )}
        aria-checked={value}
        role="switch"
      >
        <span
          className={cn(
            "absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform duration-200",
            value ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
    </div>
  );
}

import { useState } from "react";
import { Save, FolderOpen, Crosshair, Info, Search, Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import { useApp } from "../context/AppContext";
import { detectCS2Path } from "../services/cs2Service";
import { isTauri } from "../services/tauriBridge";
import { cn } from "@/lib/utils";

export function SettingsPage() {
  const { settings, updateSettings, setStatus, refreshDemos } = useApp();
  const [form, setForm] = useState({ ...settings });
  const [saved, setSaved] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function handleSave() {
    updateSettings(form);
    setStatus({ type: "success", message: "Einstellungen gespeichert." });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleAutoDetect() {
    setDetecting(true);
    try {
      const result = await detectCS2Path();
      if (result) {
        setForm((f) => ({ ...f, steamPath: result.steamPath, cs2Path: result.cs2Path }));
        setStatus({ type: "success", message: `CS2 gefunden: ${result.cs2Path}` });
      } else {
        setStatus({
          type: "error",
          message:
            "CS2 wurde nicht automatisch gefunden. Bitte den Pfad manuell eintragen.",
        });
      }
    } catch {
      setStatus({ type: "error", message: "Fehler bei der automatischen Erkennung." });
    } finally {
      setDetecting(false);
    }
  }

  async function handlePickFolder(field: "demoDirectory") {
    if (!isTauri()) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, multiple: false });
      if (dir && typeof dir === "string") {
        setForm((f) => ({ ...f, [field]: dir }));
      }
    } catch {
      // Dialog not available
    }
  }

  async function handlePickFile(field: "cs2Path") {
    if (!isTauri()) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const file = await open({
        multiple: false,
        filters: [{ name: "Ausführbare Datei", extensions: ["exe"] }],
      });
      if (file && typeof file === "string") {
        setForm((f) => ({ ...f, [field]: file }));
      }
    } catch {
      // Dialog not available
    }
  }

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

  const labelClass = "block text-white/60 text-xs font-medium mb-2";

  function PathInput({
    label,
    value,
    onChange,
    placeholder,
    onBrowseDir,
    onBrowseFile,
    hint,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    onBrowseDir?: () => void;
    onBrowseFile?: () => void;
    hint?: string;
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

        {/* Demo directory */}
        <Section title="Demo-Ordner" icon={FolderOpen}>
          <PathInput
            label="Speicherort für importierte Demos"
            value={form.demoDirectory}
            onChange={(v) => setForm((f) => ({ ...f, demoDirectory: v }))}
            placeholder="C:\CS2Demos"
            onBrowseDir={() => handlePickFolder("demoDirectory")}
            hint="Entpackte .dem-Dateien werden in diesem Ordner gespeichert."
          />
          {isTauri() && (
            <button
              onClick={handleRefreshLibrary}
              disabled={refreshing}
              className="mt-3 flex items-center gap-2 text-xs text-white/40 hover:text-white/70 transition-colors disabled:opacity-50"
            >
              {refreshing
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />
              }
              Bibliothek jetzt neu einlesen
            </button>
          )}
        </Section>

        {/* CS2 Path */}
        <Section title="CS2-Pfad" icon={Crosshair}>
          {/* Auto-detect button */}
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
              {detecting
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Search className="w-4 h-4" />
              }
              {detecting ? "Suche..." : "CS2 automatisch erkennen"}
            </button>
          )}

          <PathInput
            label="Pfad zur cs2.exe"
            value={form.cs2Path}
            onChange={(v) => setForm((f) => ({ ...f, cs2Path: v }))}
            placeholder="C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe"
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
                    if (dir && typeof dir === "string")
                      setForm((f) => ({ ...f, steamPath: dir }));
                  })
                );
              }}
            />
          </div>

          <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-blue-900/20 border border-blue-700/30">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-blue-300/70 text-xs">
              Typischer Pfad:{" "}
              <span className="font-mono text-blue-300/90">
                C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global
                Offensive\game\bin\win64\cs2.exe
              </span>
            </p>
          </div>
        </Section>

        {/* Options */}
        <Section title="Optionen">
          <div className="space-y-4">
            <Toggle
              label="Automatisch entpacken"
              description=".dem.gz Dateien werden beim Import automatisch zu .dem entpackt"
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

        {/* Tauri info banner */}
        {!isTauri() && (
          <div className="flex items-start gap-3 p-4 rounded-xl border border-yellow-700/30 bg-yellow-900/15">
            <Info className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-300 text-sm font-medium">Browser-Vorschau aktiv</p>
              <p className="text-yellow-200/55 text-xs mt-1">
                Dateisystem-Zugriff, Ordner öffnen und CS2 starten sind nur in der
                Desktop-App (Tauri) verfügbar. Im Browser werden Demos nur als Vorschau
                verwaltet.
              </p>
            </div>
          </div>
        )}

        {isTauri() && (
          <div className="flex items-center gap-2 p-3 rounded-xl border border-green-700/25 bg-green-900/10">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <p className="text-green-300/80 text-xs">
              Desktop-App aktiv — alle Funktionen verfügbar.
            </p>
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

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: React.ElementType;
  children: React.ReactNode;
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

function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
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

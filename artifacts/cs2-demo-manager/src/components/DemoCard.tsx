import { useState } from "react";
import {
  Play, FolderOpen, Pencil, Trash2, Check, X, Copy, Terminal, Loader2, MonitorOff
} from "lucide-react";
import type { Demo } from "../types/demo";
import { useApp } from "../context/AppContext";
import { formatFileSize, formatDate, openDemoFolder } from "../services/demoService";
import { launchDemoInCS2, buildPlaydemoCommand, buildPlaydemoArg, copyToClipboard, getCS2Status } from "../services/cs2Service";
import { isTauri, tauriIsCS2Running } from "../services/tauriBridge";
import { cn } from "@/lib/utils";

interface DemoCardProps {
  demo: Demo;
}

export function DemoCard({ demo }: DemoCardProps) {
  const { settings, renameDemo, deleteDemo, setStatus } = useApp();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(demo.displayName);
  const [showGuide, setShowGuide] = useState(false);
  const [showCS2Warning, setShowCS2Warning] = useState(false);
  const [cs2Opened, setCs2Opened] = useState(false);
  const [cmdCopied, setCmdCopied] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const cs2Status = getCS2Status(settings.cs2Path);
  const playdemoArg = buildPlaydemoArg(demo.filename);
  const consoleCmd = buildPlaydemoCommand(playdemoArg);

  async function handleLaunch() {
    if (cs2Status !== "found") {
      setStatus({
        type: "error",
        message: "CS2 wurde nicht gefunden. Bitte den CS2-Pfad in den Einstellungen festlegen.",
      });
      return;
    }

    setLaunching(true);
    setShowGuide(false);
    setShowCS2Warning(false);

    try {
      // ── Step 1: Check if CS2 is running (Tauri only) ──────────────────
      if (isTauri()) {
        let running = false;
        try {
          running = await tauriIsCS2Running();
        } catch (err) {
          console.warn("[CS2DM] CS2-Prozesscheck fehlgeschlagen:", err);
          running = true; // assume running if check fails, don't block user
        }

        if (!running) {
          console.log("[CS2DM] CS2 is not running — showing warning popup");
          setShowCS2Warning(true);
          setLaunching(false);
          return;
        }
      }

      // ── Step 2: Copy the console command to clipboard (always) ────────
      const copied = await copyToClipboard(consoleCmd);
      setCmdCopied(copied);

      console.log("[CS2DM] handleLaunch:", {
        filename: demo.filename,
        playdemoArg,
        consoleCmd,
        cs2Path: settings.cs2Path,
      });

      // ── Step 3: Try to open CS2 / Steam (best effort) ─────────────────
      let opened = false;
      try {
        const result = await launchDemoInCS2(demo.filename, settings.cs2Path);
        console.log("[CS2DM] Rust launch result:", result);
        opened = result === "launched";
      } catch (err) {
        console.warn("[CS2DM] Launch attempt failed:", err);
      }
      setCs2Opened(opened);

      // ── Step 4: Always show the step-by-step guide ────────────────────
      setShowGuide(true);
      setStatus({
        type: "info",
        message: opened
          ? "Befehl kopiert — öffne ~ in CS2 und füge ihn ein."
          : "Befehl kopiert. Öffne ~ in CS2 und füge ihn ein.",
      });
    } finally {
      setLaunching(false);
    }
  }

  async function handleOpenFolder() {
    try {
      await openDemoFolder(demo);
      if (!isTauri()) {
        setStatus({ type: "info", message: `Ordner: ${demo.directory}` });
      }
    } catch (err) {
      setStatus({ type: "info", message: String(err) });
    }
  }

  async function handleCopyCommand() {
    const ok = await copyToClipboard(consoleCmd);
    if (ok) {
      setStatus({ type: "success", message: "Befehl in Zwischenablage kopiert." });
    } else {
      setStatus({ type: "error", message: "Kopieren fehlgeschlagen. Bitte manuell kopieren." });
    }
  }

  async function handleRenameConfirm() {
    if (newName.trim() && newName.trim() !== demo.displayName) {
      try {
        await renameDemo(demo.id, newName.trim());
        setStatus({ type: "success", message: "Demo umbenannt." });
      } catch (err) {
        setStatus({ type: "error", message: `Umbenennen fehlgeschlagen: ${String(err)}` });
      }
    }
    setRenaming(false);
  }

  function handleRenameCancel() {
    setNewName(demo.displayName);
    setRenaming(false);
  }

  async function handleDelete() {
    const confirmed = confirm(
      `Demo „${demo.displayName}" ${isTauri() ? "löschen (Datei wird von der Festplatte gelöscht)?" : "aus der Bibliothek entfernen?"}`
    );
    if (!confirmed) return;
    setDeleting(true);
    try {
      await deleteDemo(demo.id);
      setStatus({ type: "info", message: `Demo „${demo.displayName}" ${isTauri() ? "gelöscht" : "entfernt"}.` });
    } catch (err) {
      setStatus({ type: "error", message: `Löschen fehlgeschlagen: ${String(err)}` });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {/* ── CS2-not-running modal ─────────────────────────────────────── */}
      {showCS2Warning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowCS2Warning(false)}
          />
          {/* Panel */}
          <div className="relative w-full max-w-sm rounded-2xl border border-white/12 bg-[#1a1a1a] shadow-2xl p-6">
            <div className="flex items-start gap-4">
              <div className="shrink-0 w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center">
                <MonitorOff className="w-5 h-5 text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-white font-semibold text-base mb-1">
                  CS2 ist nicht gestartet
                </h3>
                <p className="text-white/55 text-sm leading-relaxed">
                  Counter-Strike 2 muss geöffnet und im <strong className="text-white/80">Hauptmenü</strong> sein,
                  damit die Demo automatisch geladen werden kann.
                </p>
                <p className="text-white/40 text-xs mt-2">
                  Starte CS2, warte bis das Hauptmenü geladen ist, und klicke dann erneut auf „In CS2 öffnen".
                </p>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => {
                  setShowCS2Warning(false);
                  // Open CS2 via Steam without a demo (just get the game running)
                  window.open("steam://rungameid/730", "_blank");
                }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-white text-sm font-medium transition-colors"
              >
                CS2 starten
              </button>
              <button
                onClick={() => setShowCS2Warning(false)}
                className="px-4 py-2.5 rounded-xl bg-white/8 hover:bg-white/12 text-white/70 text-sm font-medium transition-colors"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Card ─────────────────────────────────────────────────────── */}
      <div className={cn(
        "group rounded-xl border border-white/8 bg-white/3 hover:bg-white/5 transition-all duration-200 overflow-hidden",
        deleting && "opacity-50 pointer-events-none"
      )}>
        <div className="p-4">
          {/* Header row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {renaming ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameConfirm();
                      if (e.key === "Escape") handleRenameCancel();
                    }}
                    className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-1 text-sm text-white focus:outline-none focus:border-orange-500/60"
                  />
                  <button onClick={handleRenameConfirm} className="text-green-400 hover:text-green-300 transition-colors">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={handleRenameCancel} className="text-red-400 hover:text-red-300 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <h3 className="text-white font-semibold text-sm truncate">{demo.displayName}</h3>
              )}
              <p className="text-white/35 text-xs mt-0.5 truncate font-mono">{demo.filename}</p>
            </div>

            {/* Inline action icons */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => { setRenaming(true); setNewName(demo.displayName); }}
                title="Umbenennen"
                className="p-1.5 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/8 transition-all"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleDelete}
                title={isTauri() ? "Datei löschen" : "Aus Bibliothek entfernen"}
                className="p-1.5 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all"
              >
                {deleting
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Trash2 className="w-3.5 h-3.5" />
                }
              </button>
            </div>
          </div>

          {/* Meta info */}
          <div className="flex items-center gap-4 mt-3">
            <span className="text-white/35 text-xs">{formatFileSize(demo.size)}</span>
            <span className="text-white/20 text-xs">•</span>
            <span className="text-white/35 text-xs">{formatDate(demo.modifiedAt)}</span>
            <span className="text-white/20 text-xs hidden sm:block">•</span>
            <span className="text-white/25 text-xs font-mono truncate hidden sm:block max-w-48">{demo.directory}</span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={handleLaunch}
              disabled={launching}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                "bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-white",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {launching
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Play className="w-3.5 h-3.5" />
              }
              {launching ? "Prüft CS2..." : "In CS2 öffnen"}
            </button>

            <button
              onClick={handleOpenFolder}
              title={isTauri() ? "Ordner in Explorer öffnen" : "Ordnerpfad anzeigen"}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium text-white/50 hover:text-white/80 hover:bg-white/8 transition-all"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Ordner
            </button>

            <button
              onClick={handleCopyCommand}
              title="playdemo-Befehl kopieren"
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium text-white/50 hover:text-white/80 hover:bg-white/8 transition-all"
            >
              <Copy className="w-3.5 h-3.5" />
              Befehl
            </button>
          </div>

          {/* Step-by-step guide — shown after button click when CS2 is running */}
          {showGuide && (
            <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10">
              <div className="flex items-start gap-2.5">
                <Terminal className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-white/80 text-xs font-semibold mb-2.5">
                    {cs2Opened ? "CS2 wird geöffnet — letzter Schritt:" : "Demo in CS2 starten:"}
                  </p>
                  <ol className="text-white/60 text-xs space-y-1.5 list-decimal list-inside">
                    <li>
                      Drücke <kbd className="px-1 py-0.5 bg-white/10 rounded text-white/70 font-mono text-[10px]">~</kbd> um die Konsole zu öffnen
                    </li>
                    <li>
                      Füge den Befehl ein{" "}
                      <kbd className="px-1 py-0.5 bg-white/10 rounded text-white/70 font-mono text-[10px]">Strg+V</kbd>
                      {cmdCopied && <span className="text-green-400 ml-1">(bereits kopiert ✓)</span>}
                    </li>
                    <li>Drücke <kbd className="px-1 py-0.5 bg-white/10 rounded text-white/70 font-mono text-[10px]">Enter</kbd></li>
                  </ol>
                  <div className="mt-2.5 flex items-center gap-2 bg-black/40 rounded-lg px-2.5 py-1.5">
                    <code className="flex-1 font-mono text-xs text-orange-300/90 truncate">
                      {consoleCmd}
                    </code>
                    <button
                      onClick={handleCopyCommand}
                      title="Nochmals kopieren"
                      className="shrink-0 text-white/30 hover:text-white/70 transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

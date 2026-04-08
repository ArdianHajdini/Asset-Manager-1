import { useState } from "react";
import {
  Play, FolderOpen, Pencil, Trash2, Check, X, Copy, Terminal, Loader2
} from "lucide-react";
import type { Demo } from "../types/demo";
import { useApp } from "../context/AppContext";
import { formatFileSize, formatDate, openDemoFolder } from "../services/demoService";
import { launchDemoInCS2, buildPlaydemoCommand, buildPlaydemoArg, copyToClipboard, getCS2Status } from "../services/cs2Service";
import { isTauri } from "../services/tauriBridge";
import { cn } from "@/lib/utils";

interface DemoCardProps {
  demo: Demo;
}

export function DemoCard({ demo }: DemoCardProps) {
  const { settings, renameDemo, deleteDemo, setStatus } = useApp();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(demo.displayName);
  const [showGuide, setShowGuide] = useState(false);
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
    setCs2Opened(false);
    setCmdCopied(false);

    try {
      // ── Step 1: Copy the console command to clipboard (always reliable) ──
      // This MUST happen before the launch attempt — the user needs it ready.
      const copied = await copyToClipboard(consoleCmd);
      setCmdCopied(copied);

      console.log("[CS2DM] handleLaunch:", {
        filename: demo.filename,
        playdemoArg,
        consoleCmd,
        cs2Path: settings.cs2Path,
      });

      // ── Step 2: Try to open CS2 / Steam (best effort) ─────────────────
      // spawn().is_ok() only proves a process was forked — it does NOT
      // guarantee that Steam forwarded +playdemo to CS2. We treat this
      // as "tried to open CS2" and always fall through to the guide.
      let opened = false;
      try {
        const result = await launchDemoInCS2(demo.filename, settings.cs2Path);
        console.log("[CS2DM] Rust launch result:", result);
        opened = result === "launched";
      } catch (err) {
        console.warn("[CS2DM] Launch attempt failed:", err);
      }
      setCs2Opened(opened);

      // ── Step 3: ALWAYS show the semi-automatic guide ───────────────────
      // We cannot verify that the demo actually started, so we always show
      // the instructions. The user just needs to press ~ and paste.
      setShowGuide(true);
      setStatus({
        type: "info",
        message: opened
          ? "CS2 wird geöffnet. Öffne ~ und füge den kopierten Befehl ein."
          : "Befehl kopiert. Starte CS2 und öffne die Konsole mit ~.",
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
            {launching ? "Öffnet..." : "In CS2 öffnen"}
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

        {/* Semi-automatic guide — always shown after button click */}
        {showGuide && (
          <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10">
            <div className="flex items-start gap-2.5">
              <Terminal className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-white/80 text-xs font-semibold mb-2.5">
                  {cs2Opened ? "CS2 wird geöffnet — fast fertig:" : "CS2 manuell starten:"}
                </p>

                <ol className="text-white/60 text-xs space-y-1.5 list-decimal list-inside">
                  {!cs2Opened && <li>Starte Counter-Strike 2</li>}
                  <li>Drücke <kbd className="px-1 py-0.5 bg-white/10 rounded text-white/70 font-mono text-[10px]">~</kbd> um die Konsole zu öffnen</li>
                  <li>
                    Füge den Befehl ein{" "}
                    <kbd className="px-1 py-0.5 bg-white/10 rounded text-white/70 font-mono text-[10px]">Strg+V</kbd>
                    {cmdCopied && <span className="text-green-400 ml-1">(bereits kopiert ✓)</span>}
                  </li>
                  <li>Drücke <kbd className="px-1 py-0.5 bg-white/10 rounded text-white/70 font-mono text-[10px]">Enter</kbd></li>
                </ol>

                {/* Command display with copy button */}
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
  );
}

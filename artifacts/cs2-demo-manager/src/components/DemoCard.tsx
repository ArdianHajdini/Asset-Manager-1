import { useState } from "react";
import {
  Play, FolderOpen, Pencil, Trash2, Check, X, Copy, AlertCircle, Loader2
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
  const [showFallback, setShowFallback] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const cs2Status = getCS2Status(settings.cs2Path);

  async function handleLaunch() {
    if (cs2Status !== "found") {
      setStatus({
        type: "error",
        message: "CS2 wurde nicht gefunden. Bitte den CS2-Pfad in den Einstellungen festlegen.",
      });
      return;
    }
    setLaunching(true);
    try {
      // Pass filename — cs2Service derives "replays/FILENAME" automatically.
      const result = await launchDemoInCS2(demo.filename, settings.cs2Path);
      if (result === "launched") {
        setStatus({ type: "success", message: `Demo gestartet: ${demo.displayName}` });
        setShowFallback(false);
      } else {
        setShowFallback(true);
        setStatus({
          type: "info",
          message:
            "Die Demo konnte nicht automatisch gestartet werden. Der Befehl wurde in die Zwischenablage kopiert.",
        });
      }
    } catch {
      setStatus({ type: "error", message: "Fehler beim Starten der Demo. Bitte prüfe den CS2-Pfad." });
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
    const cmd = buildPlaydemoCommand(buildPlaydemoArg(demo.filename));
    const ok = await copyToClipboard(cmd);
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
            {launching ? "Startet..." : "In CS2 öffnen"}
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

        {/* Manual fallback instructions */}
        {showFallback && (
          <div className="mt-4 p-3 rounded-lg bg-blue-900/30 border border-blue-700/40">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-blue-300 text-xs font-semibold mb-2">Demo manuell starten:</p>
                <ol className="text-blue-200/80 text-xs space-y-1 list-decimal list-inside">
                  <li>Starte Counter-Strike 2</li>
                  <li>Öffne die Entwicklerkonsole (Taste ~)</li>
                  <li>Füge den kopierten Befehl ein (Strg+V)</li>
                  <li>Drücke Enter</li>
                </ol>
                <div className="mt-2 bg-black/30 rounded px-2 py-1 font-mono text-xs text-white/60 truncate">
                  {buildPlaydemoCommand(buildPlaydemoArg(demo.filename))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

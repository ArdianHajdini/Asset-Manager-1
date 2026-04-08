import { useState } from "react";
import {
  Play, FolderOpen, Pencil, Trash2, Check, X, Copy, Loader2, Volume2, VolumeX, Info,
} from "lucide-react";
import type { Demo } from "../types/demo";
import { useApp } from "../context/AppContext";
import { formatFileSize, formatDate, openDemoFolder } from "../services/demoService";
import {
  buildPlaydemoArg,
  copyToClipboard,
  getCS2Status,
  verifyCS2PathExists,
  launchDemoInCS2,
} from "../services/cs2Service";
import type { LaunchOutcome } from "../services/cs2Service";
import {
  type VoiceMode,
  VOICE_OPTIONS,
  buildFullPlayCommand,
  voiceModeLabel,
} from "../services/voiceService";
import { isTauri } from "../services/tauriBridge";
import { cn } from "@/lib/utils";

interface DemoCardProps {
  demo: Demo;
}

export function DemoCard({ demo }: DemoCardProps) {
  const { settings, renameDemo, deleteDemo, setStatus } = useApp();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(demo.displayName);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("all");
  const [cmdCopied, setCmdCopied] = useState(false);
  const [lastCmd, setLastCmd] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<LaunchOutcome | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const cs2Status = getCS2Status(settings.cs2Path);
  const playdemoArg = buildPlaydemoArg(demo.filename);
  const fullCommand = buildFullPlayCommand(playdemoArg, voiceMode);

  // ── Copy command to clipboard ────────────────────────────────────────────
  async function handleCopyCommand() {
    const copied = await copyToClipboard(fullCommand);
    setCmdCopied(copied);
    setLastCmd(fullCommand);
    if (copied) {
      setStatus({ type: "success", message: "Befehl wurde in die Zwischenablage kopiert." });
      setTimeout(() => setCmdCopied(false), 3000);
    }
  }

  // ── Launch CS2 / Steam (best effort) ────────────────────────────────────
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
      // Verify cs2.exe path in Tauri mode
      if (isTauri()) {
        const exists = await verifyCS2PathExists(settings.cs2Path);
        if (!exists) {
          setStatus({
            type: "error",
            message: "CS2-Pfad ungültig (cs2.exe nicht gefunden). Bitte Einstellungen prüfen.",
          });
          setLaunching(false);
          return;
        }
      }

      // Always copy the command first
      await copyToClipboard(fullCommand);
      setCmdCopied(true);
      setLastCmd(fullCommand);

      let outcome: LaunchOutcome;
      try {
        outcome = await launchDemoInCS2(demo.filename, settings.cs2Path);
      } catch (err) {
        console.warn("[CS2DM] Launch attempt failed:", err);
        outcome = { status: "clipboard_fallback", method: "none", consoleCmd: fullCommand, steamUri: "" };
      }
      setLastOutcome(outcome);

      setStatus({
        type: "info",
        message: outcome.status === "launched"
          ? (outcome.note ?? "CS2 / Steam gestartet. Befehl in die Konsole einfügen.")
          : "Befehl kopiert — öffne CS2, drücke ~ und füge ein.",
      });
    } finally {
      setLaunching(false);
    }
  }

  // ── Rename ───────────────────────────────────────────────────────────────
  async function handleRenameConfirm() {
    if (!newName.trim() || newName === demo.displayName) {
      setRenaming(false);
      setNewName(demo.displayName);
      return;
    }
    try {
      await renameDemo(demo.id, newName.trim());
      setRenaming(false);
    } catch (err) {
      setStatus({ type: "error", message: `Umbenennen fehlgeschlagen: ${String(err)}` });
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteDemo(demo.id);
    } catch (err) {
      setStatus({ type: "error", message: `Löschen fehlgeschlagen: ${String(err)}` });
      setDeleting(false);
    }
  }

  // ── Open folder ──────────────────────────────────────────────────────────
  async function handleOpenFolder() {
    try {
      await openDemoFolder(demo);
    } catch {
      setStatus({ type: "info", message: `Ordner: ${demo.directory}` });
    }
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/3 hover:bg-white/5 transition-all duration-200 overflow-hidden">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            {renaming ? (
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 bg-white/8 border border-white/15 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500/60"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRenameConfirm(); if (e.key === "Escape") { setRenaming(false); setNewName(demo.displayName); } }}
                  autoFocus
                />
                <button onClick={handleRenameConfirm} className="text-green-400 hover:text-green-300 transition-colors"><Check className="w-4 h-4" /></button>
                <button onClick={() => { setRenaming(false); setNewName(demo.displayName); }} className="text-white/30 hover:text-white/60 transition-colors"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <p className="text-white font-semibold text-sm truncate">{demo.displayName}</p>
            )}
            <p className="text-white/35 text-xs font-mono mt-0.5 truncate">{demo.filename}</p>
          </div>
          {!renaming && (
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setRenaming(true)} title="Umbenennen" className="p-1.5 rounded-lg text-white/25 hover:text-white/60 hover:bg-white/8 transition-all"><Pencil className="w-3.5 h-3.5" /></button>
              <button onClick={handleOpenFolder} title="Ordner öffnen" className="p-1.5 rounded-lg text-white/25 hover:text-white/60 hover:bg-white/8 transition-all"><FolderOpen className="w-3.5 h-3.5" /></button>
              <button onClick={handleDelete} disabled={deleting} title="Löschen" className="p-1.5 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-900/20 transition-all disabled:opacity-40">
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-3 mb-4 text-white/30 text-xs">
          <span>{formatFileSize(demo.size)}</span>
          <span>·</span>
          <span>{formatDate(demo.modifiedAt)}</span>
        </div>

        {/* Voice mode selector */}
        <div className="mb-3">
          <p className="text-white/40 text-xs mb-2 flex items-center gap-1.5">
            <Volume2 className="w-3 h-3" />
            Voice-Modus
          </p>
          <div className="grid grid-cols-4 gap-1">
            {VOICE_OPTIONS.map((opt) => (
              <button
                key={opt.mode}
                onClick={() => setVoiceMode(opt.mode)}
                title={opt.notImplementedNote ?? opt.description}
                className={cn(
                  "relative px-2 py-1.5 rounded-lg border text-xs font-medium transition-all duration-150",
                  voiceMode === opt.mode
                    ? "border-orange-500/60 bg-orange-500/15 text-orange-300"
                    : "border-white/8 bg-white/3 text-white/40 hover:text-white/60 hover:border-white/15"
                )}
              >
                {opt.label}
                {!opt.implemented && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-yellow-500/80" title="Noch nicht vollständig implementiert" />
                )}
              </button>
            ))}
          </div>
          {/* Note for unimplemented modes */}
          {VOICE_OPTIONS.find((o) => o.mode === voiceMode)?.notImplementedNote && (
            <p className="mt-1.5 text-[10px] text-yellow-400/60 flex items-center gap-1">
              <Info className="w-3 h-3 shrink-0" />
              {VOICE_OPTIONS.find((o) => o.mode === voiceMode)?.notImplementedNote}
            </p>
          )}
        </div>

        {/* Command preview */}
        <div className="mb-3 flex items-center gap-2 bg-black/40 rounded-lg px-3 py-2">
          <code className="flex-1 font-mono text-xs text-orange-300/80 truncate">{fullCommand}</code>
          <button
            onClick={handleCopyCommand}
            title="Befehl kopieren"
            className="shrink-0 text-white/30 hover:text-orange-400 transition-colors"
          >
            {cmdCopied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {/* PRIMARY: copy command */}
          <button
            onClick={handleCopyCommand}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150",
              cmdCopied
                ? "bg-green-600 text-white"
                : "bg-white/8 hover:bg-white/15 border border-white/12 text-white/80 hover:text-white"
            )}
          >
            {cmdCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {cmdCopied ? "Kopiert!" : "Befehl kopieren"}
          </button>

          {/* SECONDARY: launch CS2 / Steam (best effort) */}
          {isTauri() ? (
            <button
              onClick={handleLaunch}
              disabled={launching || cs2Status !== "found"}
              title={cs2Status !== "found" ? "CS2 nicht konfiguriert" : "CS2 / Steam öffnen und Befehl kopieren"}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {launching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              In CS2 öffnen
            </button>
          ) : (
            <button
              onClick={handleCopyCommand}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/3 text-white/30 text-sm font-medium cursor-default select-none"
              title="Nur in der Desktop-App verfügbar"
            >
              <Play className="w-3.5 h-3.5" />
              In CS2 öffnen
              <span className="text-xs text-white/20">(nur Desktop)</span>
            </button>
          )}
        </div>

        {/* Copied command panel */}
        {lastCmd && (
          <div className="mt-3 p-3 rounded-lg bg-black/30 border border-white/6">
            <p className="text-white/40 text-xs mb-1.5 font-medium">Zuletzt kopierter Befehl</p>
            <p className="text-white/25 text-[10px] mb-1">
              1. CS2 öffnen → Konsole öffnen (Taste: <kbd className="px-1 py-0.5 bg-white/10 rounded font-mono text-[9px] text-white/60">~</kbd>)
            </p>
            <p className="text-white/25 text-[10px] mb-2">
              2. Befehl einfügen (<kbd className="px-1 py-0.5 bg-white/10 rounded font-mono text-[9px] text-white/60">Strg+V</kbd>) und Enter drücken
            </p>
            <div className="flex items-center gap-2 bg-black/40 rounded px-2.5 py-1.5">
              <code className="flex-1 font-mono text-[11px] text-orange-300/90 break-all">{lastCmd}</code>
              <button
                onClick={handleCopyCommand}
                title="Nochmals kopieren"
                className="shrink-0 text-white/30 hover:text-white/60 transition-colors"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
            {lastOutcome && (
              <p className="mt-1.5 text-[10px] text-white/30">
                Startmethode: <span className="text-white/50">{lastOutcome.method ?? "–"}</span>
                {" · "}
                Status: <span className={lastOutcome.status === "launched" ? "text-green-400/70" : "text-yellow-400/70"}>
                  {lastOutcome.status === "launched" ? "Gestartet" : "Nur Befehl kopiert"}
                </span>
              </p>
            )}
          </div>
        )}

        {/* Debug toggle */}
        {lastOutcome && (
          <div className="mt-2">
            <button
              onClick={() => setShowDebug((v) => !v)}
              className="text-[10px] text-white/20 hover:text-white/40 transition-colors"
            >
              {showDebug ? "▲ Debug" : "▼ Debug"}
            </button>
            {showDebug && (
              <pre className="mt-1 text-[9px] text-white/45 bg-black/50 p-2 rounded-lg overflow-x-auto leading-relaxed">
                {JSON.stringify({
                  isTauri: isTauri(),
                  cs2Path: settings.cs2Path,
                  demo: demo.filename,
                  voiceMode,
                  playdemoArg,
                  fullCommand,
                  outcome: lastOutcome,
                }, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

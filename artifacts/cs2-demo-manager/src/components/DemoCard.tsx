import { useState, useEffect } from "react";
import {
  FolderOpen, Pencil, Trash2, Check, X, Copy, Loader2,
  Volume2, Info, Users, ChevronDown, ChevronUp,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Demo } from "../types/demo";
import { useApp } from "../context/AppContext";
import { formatFileSize, formatDate, openDemoFolder } from "../services/demoService";
import { buildPlaydemoArg, copyToClipboard } from "../services/cs2Service";
import { getCachedPlayers, setCachedPlayers } from "../services/parsedPlayersCache";
import {
  type VoiceMode,
  VOICE_OPTIONS,
  buildFullPlayCommand,
  buildRosters,
  buildVoiceDebugInfo,
  getPlayersForMode,
  getPlayersToHear,
  playersWithEntityIds,
  playersMissingEntityIds,
  type DemoRosters,
} from "../services/voiceService";
import { isTauri, tauriParseDemoPlayers, type TauriDemoPlayer } from "../services/tauriBridge";
import { cn } from "@/lib/utils";

interface DemoCardProps {
  demo: Demo;
}

export function DemoCard({ demo }: DemoCardProps) {
  const { settings, renameDemo, deleteDemo, setStatus } = useApp();
  const { t } = useTranslation();

  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(demo.displayName);
  const [deleting, setDeleting] = useState(false);

  const [voiceMode, setVoiceMode] = useState<VoiceMode>("all");

  const [cmdCopied, setCmdCopied] = useState(false);
  const [lastCmd, setLastCmd] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  const [parsedPlayers, setParsedPlayers] = useState<TauriDemoPlayer[] | null>(() =>
    demo.filepath ? getCachedPlayers(demo.filepath) : null
  );
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [showPlayers, setShowPlayers] = useState(false);
  const playdemoArg = buildPlaydemoArg(demo.filename);

  const voiceModeLabel = (mode: VoiceMode): string => {
    const map: Record<VoiceMode, string> = {
      all: t("demo.voiceAll"),
      none: t("demo.voiceNone"),
      team_t: t("demo.voiceT"),
      team_ct: t("demo.voiceCT"),
    };
    return map[mode] ?? mode;
  };

  const rosters: DemoRosters | null = parsedPlayers ? buildRosters(parsedPlayers) : null;
  const playersForMode = getPlayersForMode(voiceMode, rosters);
  const playersToHear = getPlayersToHear(voiceMode, rosters);
  const knownPlayers = playersToHear ? playersWithEntityIds(playersToHear) : [];
  const missingPlayers = playersToHear ? playersMissingEntityIds(playersToHear) : [];
  const autoMuteAvailable =
    (voiceMode === "team_t" || voiceMode === "team_ct") && knownPlayers.length > 0;
  const fullCommand = buildFullPlayCommand(playdemoArg, voiceMode, playersToHear);

  useEffect(() => {
    if (!isTauri() || !demo.filepath) return;
    if (getCachedPlayers(demo.filepath) !== null) return;
    if (parsedPlayers !== null || parsing) return;
    setParsing(true);
    tauriParseDemoPlayers(demo.filepath)
      .then((players) => {
        setCachedPlayers(demo.filepath!, players);
        setParsedPlayers(players);
        setParseError(null);
      })
      .catch((err) => {
        setParseError(String(err));
        setParsedPlayers([]);
      })
      .finally(() => setParsing(false));
  }, [demo.filepath]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCopyCommand() {
    if (!fullCommand) {
      setStatus({ type: "error", message: t("demo.filterNotAvail") });
      return;
    }
    const copied = await copyToClipboard(fullCommand);
    setCmdCopied(copied);
    setLastCmd(fullCommand);
    if (copied) {
      setStatus({ type: "success", message: t("demo.commandCopied") });
      setTimeout(() => setCmdCopied(false), 3000);
    }
  }

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
      setStatus({ type: "error", message: t("demo.renameFailed", { error: String(err) }) });
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteDemo(demo.id);
    } catch (err) {
      setStatus({ type: "error", message: t("demo.deleteFailed", { error: String(err) }) });
      setDeleting(false);
    }
  }

  async function handleOpenFolder() {
    try {
      await openDemoFolder(demo);
    } catch {
      setStatus({ type: "info", message: t("demo.folderPath", { path: demo.directory }) });
    }
  }

  function teamLabel(teamNum: number): string {
    if (teamNum === 2) return "T";
    if (teamNum === 3) return "CT";
    return "?";
  }
  function teamColor(teamNum: number): string {
    if (teamNum === 2) return "text-yellow-400/80";
    if (teamNum === 3) return "text-blue-400/80";
    return "text-white/30";
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameConfirm();
                    if (e.key === "Escape") { setRenaming(false); setNewName(demo.displayName); }
                  }}
                  autoFocus
                />
                <button onClick={handleRenameConfirm} className="text-green-400 hover:text-green-300 transition-colors">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => { setRenaming(false); setNewName(demo.displayName); }} className="text-white/30 hover:text-white/60 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <p className="text-white font-semibold text-sm truncate">{demo.displayName}</p>
            )}
            <p className="text-white/35 text-xs font-mono mt-0.5 truncate">{demo.filename}</p>
          </div>
          {!renaming && (
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setRenaming(true)} title={t("demo.rename")} className="p-1.5 rounded-lg text-white/25 hover:text-white/60 hover:bg-white/8 transition-all">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={handleOpenFolder} title={t("demo.openFolder")} className="p-1.5 rounded-lg text-white/25 hover:text-white/60 hover:bg-white/8 transition-all">
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
              <button onClick={handleDelete} disabled={deleting} title={t("demo.delete")} className="p-1.5 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-900/20 transition-all disabled:opacity-40">
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
          {isTauri() && (
            <span className="ml-auto flex items-center gap-1">
              {parsing && <><Loader2 className="w-2.5 h-2.5 animate-spin" /><span className="text-white/20">{t("demo.analyzing")}</span></>}
              {!parsing && parsedPlayers && parsedPlayers.length > 0 && (
                <button
                  onClick={() => setShowPlayers((v) => !v)}
                  className="flex items-center gap-1 text-white/25 hover:text-white/55 transition-colors"
                >
                  <Users className="w-2.5 h-2.5" />
                  <span>{t("demo.players", { count: parsedPlayers.length })}</span>
                  {showPlayers ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                </button>
              )}
              {!parsing && parseError && (
                <span className="text-red-400/40 text-[10px]" title={parseError}>{t("demo.parseError")}</span>
              )}
            </span>
          )}
        </div>

        {/* Player list (collapsible) */}
        {showPlayers && rosters && (
          <div className="mb-4 p-3 rounded-lg bg-black/30 border border-white/6">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-yellow-400/60 text-[10px] font-bold uppercase tracking-wider mb-1.5">Team T</p>
                <div className="space-y-0.5">
                  {rosters.terrorists.map((p) => (
                    <div key={p.xuid || p.name} className="flex items-center gap-1.5">
                      <span className="text-white/55 text-[11px] truncate">{p.name}</span>
                      {p.entityId !== undefined
                        ? <span className="text-yellow-400/50 font-mono text-[9px]">#{p.entityId}</span>
                        : <span className="text-white/20 font-mono text-[9px]">–</span>
                      }
                    </div>
                  ))}
                  {rosters.terrorists.length === 0 && <p className="text-white/20 text-[11px]">—</p>}
                </div>
              </div>
              <div>
                <p className="text-blue-400/60 text-[10px] font-bold uppercase tracking-wider mb-1.5">Team CT</p>
                <div className="space-y-0.5">
                  {rosters.counterTerrorists.map((p) => (
                    <div key={p.xuid || p.name} className="flex items-center gap-1.5">
                      <span className="text-white/55 text-[11px] truncate">{p.name}</span>
                      {p.entityId !== undefined
                        ? <span className="text-blue-400/50 font-mono text-[9px]">#{p.entityId}</span>
                        : <span className="text-white/20 font-mono text-[9px]">–</span>
                      }
                    </div>
                  ))}
                  {rosters.counterTerrorists.length === 0 && <p className="text-white/20 text-[11px]">—</p>}
                </div>
              </div>
            </div>
            {parsedPlayers && parsedPlayers.length > 0 && (
              <div className="mt-2 pt-2 border-t border-white/5">
                <p className="text-white/20 text-[9px] font-mono">
                  T-Slots: [{rosters.terrorists.filter(p => p.entityId !== undefined).map(p => p.entityId).join(", ") || "–"}]
                  {" · "}
                  CT-Slots: [{rosters.counterTerrorists.filter(p => p.entityId !== undefined).map(p => p.entityId).join(", ") || "–"}]
                </p>
              </div>
            )}
          </div>
        )}

        {/* Voice mode selector */}
        <div className="mb-3">
          <p className="text-white/40 text-xs mb-2 flex items-center gap-1.5">
            <Volume2 className="w-3 h-3" />
            {t("demo.voiceMode")}
            {parsing && <Loader2 className="w-2.5 h-2.5 animate-spin text-white/20" />}
          </p>
          <div className="grid grid-cols-4 gap-1">
            {VOICE_OPTIONS.map((opt) => {
              const needsRoster = opt.mode === "team_t" || opt.mode === "team_ct";
              const hasRoster = needsRoster && rosters !== null;
              const dotStatus = !needsRoster
                ? "ok"
                : autoMuteAvailable && voiceMode === opt.mode && missingPlayers.length === 0
                  ? "full"
                  : autoMuteAvailable && voiceMode === opt.mode && missingPlayers.length > 0
                    ? "partial"
                    : hasRoster
                      ? "list"
                      : "none";
              return (
                <button
                  key={opt.mode}
                  onClick={() => setVoiceMode(opt.mode)}
                  title={voiceModeLabel(opt.mode)}
                  className={cn(
                    "relative px-2 py-1.5 rounded-lg border text-xs font-medium transition-all duration-150",
                    voiceMode === opt.mode
                      ? "border-orange-500/60 bg-orange-500/15 text-orange-300"
                      : "border-white/8 bg-white/3 text-white/40 hover:text-white/60 hover:border-white/15"
                  )}
                >
                  {voiceModeLabel(opt.mode)}
                  {dotStatus === "full" && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-400" title={t("demo.allDetected")} />
                  )}
                  {dotStatus === "partial" && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-yellow-400" title={t("demo.partialDetected")} />
                  )}
                  {dotStatus === "list" && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-700/80" title={t("demo.listAvail")} />
                  )}
                  {dotStatus === "none" && needsRoster && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-white/20" title={t("demo.notAnalyzed")} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Auto-mute status banner */}
          {(voiceMode === "team_t" || voiceMode === "team_ct") && rosters && (
            <div className={cn(
              "mt-2 px-2.5 py-1.5 rounded-lg border text-[10px] flex items-center gap-1.5",
              autoMuteAvailable
                ? missingPlayers.length > 0
                  ? "bg-yellow-900/20 border-yellow-700/30 text-yellow-300/80"
                  : "bg-green-900/20 border-green-700/30 text-green-300/80"
                : "bg-black/20 border-white/6 text-white/30"
            )}>
              <Info className="w-3 h-3 shrink-0" />
              {autoMuteAvailable
                ? missingPlayers.length > 0
                  ? t("demo.partialFilter", {
                      known: knownPlayers.length,
                      total: playersToHear?.length ?? 0,
                      missing: missingPlayers.length,
                    })
                  : t("demo.allPlayersHeard", { count: knownPlayers.length })
                : t("demo.filterNA")}
            </div>
          )}

          {/* Player list for selected mode */}
          {playersForMode && playersForMode.length > 0 && (
            <div className="mt-2 p-2 rounded-lg bg-black/25 border border-white/5">
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {playersForMode.map((p) => (
                  <span key={p.xuid} className="flex items-center gap-1 text-[10px]">
                    <span className={cn("font-mono text-[9px] font-bold", teamColor(p.teamNum))}>{teamLabel(p.teamNum)}</span>
                    <span className="text-white/50">{p.name}</span>
                    {p.entityId !== undefined && (
                      <span className="text-white/20 font-mono text-[8px]">#{p.entityId}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Command preview */}
        <div className="mb-3 flex items-center gap-2 bg-black/40 rounded-lg px-3 py-2">
          {fullCommand ? (
            <code className="flex-1 font-mono text-xs text-orange-300/80 truncate">{fullCommand}</code>
          ) : (
            <span className="flex-1 text-xs text-white/25 italic">{t("demo.filterUnavailable")}</span>
          )}
          <button
            onClick={handleCopyCommand}
            disabled={!fullCommand}
            title={fullCommand ? t("demo.copyCommand") : t("demo.filterUnavailable")}
            className="shrink-0 text-white/30 hover:text-orange-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {cmdCopied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyCommand}
            disabled={!fullCommand}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed",
              cmdCopied
                ? "bg-green-600 text-white"
                : "bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-white"
            )}
          >
            {cmdCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {cmdCopied ? t("demo.copied") : t("demo.copyCommand")}
          </button>
        </div>

        {/* Copied command panel */}
        {lastCmd && (
          <div className="mt-3 p-3 rounded-lg bg-black/30 border border-white/6">
            <p className="text-white/40 text-xs mb-1.5 font-medium">{t("demo.lastCopied")}</p>
            <p className="text-white/25 text-[10px] mb-1">
              {t("demo.openConsole")}{" "}
              <kbd className="px-1 py-0.5 bg-white/10 rounded font-mono text-[9px] text-white/60">~</kbd>)
            </p>
            <p className="text-white/25 text-[10px] mb-2">
              {t("demo.pasteCmd")}{" "}
              <kbd className="px-1 py-0.5 bg-white/10 rounded font-mono text-[9px] text-white/60">Ctrl+V</kbd>
              {t("demo.pressEnter")}
            </p>
            <div className="flex items-center gap-2 bg-black/40 rounded px-2.5 py-1.5">
              <code className="flex-1 font-mono text-[11px] text-orange-300/90 break-all">{lastCmd}</code>
              <button onClick={handleCopyCommand} title={t("demo.copyCommand")} className="shrink-0 text-white/30 hover:text-white/60 transition-colors">
                <Copy className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Debug toggle */}
        {parsedPlayers && parsedPlayers.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setShowDebug((v) => !v)}
              className="text-[10px] text-white/20 hover:text-white/40 transition-colors"
            >
              {showDebug ? "▲ Debug" : "▼ Debug"}
            </button>
            {showDebug && (() => {
              const dbg = buildVoiceDebugInfo(parsedPlayers ?? [], voiceMode, playersToHear ?? null);
              return (
                <pre className="mt-1 text-[9px] text-white/45 bg-black/50 p-2 rounded-lg overflow-x-auto leading-relaxed">
                  {JSON.stringify({
                    isTauri: isTauri(),
                    demo: demo.filename,
                    voiceMode,
                    fullCommand,
                    players: dbg.players,
                    bitmask: dbg.bitmask,
                  }, null, 2)}
                </pre>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import {
  Play, FolderOpen, Loader2, CheckCircle2,
  Calendar, Map, Copy, Check, Users, Volume2, Info, ExternalLink,
} from "lucide-react";
import type { FaceitHistoryItem } from "../types/faceit";
import { useFaceit } from "../context/FaceitContext";
import { useApp } from "../context/AppContext";
import {
  getMatchResult, getOpponentTeam, getOwnTeam, prettyMapName,
  formatMatchDate, getScoreString, getMatchDetails,
} from "../services/faceitMatchService";
import {
  findDownloadedDemo, faceitMatchUrl,
} from "../services/faceitDownloadService";
import {
  buildPlaydemoArg,
  copyToClipboard,
  launchDemoInCS2,
} from "../services/cs2Service";
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
import {
  isTauri,
  tauriParseDemoPlayers,
  type TauriDemoPlayer,
} from "../services/tauriBridge";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

interface MatchCardProps {
  match: FaceitHistoryItem;
}

export function MatchCard({ match }: MatchCardProps) {
  const { connection } = useFaceit();
  const { settings, setStatus } = useApp();
  const [, navigate] = useLocation();

  // Match details fetched lazily on hover (map name, demo availability on FACEIT)
  const [mapName, setMapName] = useState<string | null>(null);
  const [hasDemoOnFaceit, setHasDemoOnFaceit] = useState<boolean | null>(null);
  const [detailsChecked, setDetailsChecked] = useState(false);

  // Voice mode for copy-command
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("all");
  const [showDebug, setShowDebug] = useState(false);
  const [cmdCopied, setCmdCopied] = useState(false);
  const [launching, setLaunching] = useState(false);

  // Demo player parser (entity IDs for tv_listen_voice_indices)
  const [parsedPlayers, setParsedPlayers] = useState<TauriDemoPlayer[] | null>(null);
  const [parsing, setParsing] = useState(false);

  // Auto-parse on mount if this demo was already processed in a previous session
  useEffect(() => {
    if (!isTauri()) return;
    const existingDemo = findDownloadedDemo(match.match_id);
    if (!existingDemo?.filepath || parsedPlayers !== null || parsing) return;
    setParsing(true);
    tauriParseDemoPlayers(existingDemo.filepath)
      .then((players) => setParsedPlayers(players))
      .catch(() => setParsedPlayers([]))
      .finally(() => setParsing(false));
  }, [match.match_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!connection) return null;

  const playerId = connection.playerId;
  const result = getMatchResult(match, playerId);
  const opponent = getOpponentTeam(match, playerId);
  const ownTeam = getOwnTeam(match, playerId);
  const score = getScoreString(match, playerId);
  const dateStr = formatMatchDate(match.started_at);

  // Check if this match's demo is already in the local library
  const existingDemo = findDownloadedDemo(match.match_id);
  const isAlreadyProcessed = existingDemo !== null;

  // URL to open on FACEIT (match page where the user can download the demo manually)
  const matchUrl = faceitMatchUrl(match.match_id, match.faceit_url);

  // Build playdemo arg from already-processed demo file
  const playdemoArg = existingDemo
    ? buildPlaydemoArg(existingDemo.filename)
    : null;

  // Computed rosters from parsed .dem players — team split uses m_iTeamNum from demo only
  const rosters: DemoRosters | null = parsedPlayers ? buildRosters(parsedPlayers) : null;

  // Players displayed for the selected voice mode (T or CT)
  const playersForMode = getPlayersForMode(voiceMode, rosters);

  // Players to HEAR — their entityIds drive tv_listen_voice_indices
  const playersToHear = getPlayersToHear(voiceMode, rosters);

  // Players with and without resolved entity/slot IDs (for the selected mode)
  const knownPlayers = playersToHear ? playersWithEntityIds(playersToHear) : [];
  const missingPlayers = playersToHear ? playersMissingEntityIds(playersToHear) : [];

  // True when at least ONE player has a known slot → partial command is possible
  const autoMuteAvailable =
    (voiceMode === "team_t" || voiceMode === "team_ct") &&
    knownPlayers.length > 0;

  const fullCommand = playdemoArg
    ? buildFullPlayCommand(playdemoArg, voiceMode, playersToHear)
    : null;

  // ── Lazy-load match details (map name, demo availability on FACEIT) ────────
  async function checkMatchDetails() {
    if (detailsChecked || !connection) return;
    try {
      const details = await getMatchDetails(match.match_id, connection);
      setHasDemoOnFaceit(!!(details.demo_url && details.demo_url.length > 0));
      const rawMap = details.voting?.map?.pick?.[0] ?? null;
      if (rawMap) setMapName(prettyMapName(rawMap));
    } catch {
      setHasDemoOnFaceit(false);
    } finally {
      setDetailsChecked(true);
    }
  }

  // ── Copy command ──────────────────────────────────────────────────────────
  async function handleCopyCommand() {
    if (!fullCommand) {
      const msg = playdemoArg
        ? "Sprachfilter für diesen Modus nicht verfügbar — Demo-Daten fehlen."
        : "Demo wurde noch nicht verarbeitet — bitte zuerst den Downloads-Ordner scannen.";
      setStatus({ type: "error", message: msg });
      return;
    }
    const copied = await copyToClipboard(fullCommand);
    setCmdCopied(copied);
    if (copied) {
      setStatus({ type: "success", message: "Befehl wurde in die Zwischenablage kopiert." });
      setTimeout(() => setCmdCopied(false), 3000);
    }
  }

  // ── Launch CS2 + copy (best effort) ──────────────────────────────────────
  async function handleWatch() {
    if (!existingDemo) return;

    if (!isTauri()) {
      await handleCopyCommand();
      setStatus({
        type: "info",
        message: "Befehl kopiert. In CS2 starten ist nur in der Desktop-App verfügbar.",
      });
      return;
    }

    setLaunching(true);
    try {
      if (fullCommand) {
        await copyToClipboard(fullCommand);
        setCmdCopied(true);
      }
      const outcome = await launchDemoInCS2(existingDemo.filename, settings.cs2Path);
      setStatus({
        type: "info",
        message: outcome.status === "launched"
          ? (outcome.note ?? "CS2 / Steam gestartet. Befehl in die Konsole einfügen.")
          : "Befehl kopiert — öffne CS2, drücke ~ und füge ein.",
      });
    } catch {
      setStatus({
        type: "info",
        message: "CS2 konnte nicht gestartet werden. Befehl wurde kopiert — bitte manuell einfügen.",
      });
    } finally {
      setLaunching(false);
    }
  }

  // ── Team label / color helpers ────────────────────────────────────────────
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

  // ── Styling based on result ────────────────────────────────────────────────
  const resultColor =
    result === "win" ? "text-green-400" :
    result === "loss" ? "text-red-400" :
    "text-white/40";

  const resultLabel =
    result === "win" ? "Sieg" :
    result === "loss" ? "Niederlage" :
    "–";

  const statusBorder =
    result === "win" ? "border-l-2 border-l-green-500/30" :
    result === "loss" ? "border-l-2 border-l-red-500/30" :
    "border-l-2 border-l-white/8";

  return (
    <div
      className={cn(
        "rounded-xl border border-white/8 bg-white/3 hover:bg-white/5 transition-all duration-200 overflow-hidden",
        statusBorder
      )}
      onMouseEnter={checkMatchDetails}
    >
      <div className="p-4">

        {/* Header: result · score · date */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <span className={cn("text-xs font-bold uppercase tracking-widest", resultColor)}>
              {resultLabel}
            </span>
            {match.results && (
              <span className="text-white/70 text-sm font-mono font-bold">
                {score}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-white/30 text-xs">
            <Calendar className="w-3 h-3" />
            {dateStr}
          </div>
        </div>

        {/* Map + match type */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-1.5">
            <Map className="w-3 h-3 text-white/30" />
            <span className="text-white/55 text-xs font-mono font-semibold">
              {mapName ?? (detailsChecked ? "–" : match.competition_name)}
            </span>
          </div>
          <span className="text-white/20 text-xs">{match.match_id.slice(0, 8)}…</span>
        </div>

        {/* Teams row: ownTeam vs opponent */}
        <div className="flex items-center gap-2 mb-4 text-xs">
          {/* Own team */}
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-orange-400/70 font-semibold shrink-0">{ownTeam.nickname || "Team 1"}</span>
            <span className="text-white/20">
              ({ownTeam.players.slice(0, 5).map((p) => p.nickname).join(", ")})
            </span>
          </div>
          <span className="text-white/25 shrink-0 font-bold">vs</span>
          {/* Opponent */}
          <div className="flex items-center gap-1 min-w-0">
            <Users className="w-3 h-3 text-white/25 shrink-0" />
            <span className="text-white/50 font-semibold truncate">
              {opponent.nickname || opponent.players.slice(0, 2).map((p) => p.nickname).join(", ")}
            </span>
          </div>
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {/* Demo availability on FACEIT — shown before the demo is processed locally */}
          {detailsChecked && !isAlreadyProcessed && (
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full border",
              hasDemoOnFaceit
                ? "border-green-700/40 bg-green-900/20 text-green-400"
                : "border-white/8 bg-white/3 text-white/25"
            )}>
              {hasDemoOnFaceit ? "Demo auf FACEIT verfügbar" : "Keine Demo"}
            </span>
          )}
          {/* Demo is already in the local library */}
          {isAlreadyProcessed && (
            <span className="flex items-center gap-1 text-xs text-orange-400">
              <CheckCircle2 className="w-3 h-3" />
              Verarbeitet
            </span>
          )}
          {/* Parsing status */}
          {isAlreadyProcessed && isTauri() && parsing && (
            <span className="flex items-center gap-1 text-xs text-white/30">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              Analysiere Demo...
            </span>
          )}
          {isAlreadyProcessed && isTauri() && !parsing && parsedPlayers && parsedPlayers.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-white/30">
              <Users className="w-2.5 h-2.5" />
              {parsedPlayers.length} Spieler erkannt
            </span>
          )}
        </div>

        {/* Voice mode picker — visible when demo has been processed locally */}
        {isAlreadyProcessed && (
          <div className="mb-3 p-3 rounded-lg bg-black/30 border border-white/6">
            <p className="text-white/40 text-xs mb-2 flex items-center gap-1.5">
              <Volume2 className="w-3 h-3" />
              Voice-Modus
              {parsing && <Loader2 className="w-2.5 h-2.5 animate-spin text-white/20" />}
            </p>
            <div className="grid grid-cols-4 gap-1">
              {VOICE_OPTIONS.map((opt) => {
                const needsRoster = opt.mode === "team_t" || opt.mode === "team_ct";
                const hasRoster = needsRoster && rosters !== null;
                const isSelected = voiceMode === opt.mode;
                const dotStatus = !needsRoster
                  ? "ok"
                  : autoMuteAvailable && isSelected && missingPlayers.length === 0
                    ? "full"
                    : autoMuteAvailable && isSelected && missingPlayers.length > 0
                      ? "partial"
                      : hasRoster
                        ? "list"
                        : "none";
                return (
                  <button
                    key={opt.mode}
                    onClick={() => setVoiceMode(opt.mode)}
                    title={opt.description}
                    className={cn(
                      "relative px-2 py-1.5 rounded-lg border text-xs font-medium transition-all",
                      isSelected
                        ? "border-orange-500/60 bg-orange-500/15 text-orange-300"
                        : "border-white/8 bg-white/3 text-white/40 hover:text-white/60"
                    )}
                  >
                    {opt.label}
                    {dotStatus === "full" && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-400" title="Alle Spieler erkannt — automatische Stummschaltung aktiv" />
                    )}
                    {dotStatus === "partial" && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-yellow-400" title="Teilweise erkannt — Befehl wird mit bekannten Slots generiert" />
                    )}
                    {dotStatus === "list" && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-700/80" title="Spielerliste verfügbar" />
                    )}
                    {dotStatus === "none" && needsRoster && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-white/20" title="Demo noch nicht analysiert" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Auto-mute status banner */}
            {(voiceMode === "team_t" || voiceMode === "team_ct") && (
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
                    ? `Sprachfilter teilweise verfügbar: ${knownPlayers.length} von ${(playersToHear?.length ?? 0)} Spielern erkannt — ${missingPlayers.length} Spieler fehlen.`
                    : `${knownPlayers.length} Spieler werden automatisch gehört — Befehl unten kopieren.`
                  : rosters
                    ? "Sprachfilter für diese Demo nicht verfügbar."
                    : "Demo wird noch analysiert…"}
              </div>
            )}

            {/* Player list for selected team — demo data only (name + team + slot) */}
            {(voiceMode === "team_t" || voiceMode === "team_ct") && playersForMode && playersForMode.length > 0 && (
              <div className="mt-2 p-2 rounded-lg bg-black/25 border border-white/5">
                <p className="text-white/30 text-[10px] font-semibold mb-1 uppercase tracking-wider">
                  {voiceMode === "team_t" ? "Team T" : "Team CT"}
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {playersForMode.map((p) => (
                    <span key={p.xuid || p.name} className="flex items-center gap-1 text-[10px]">
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

            {fullCommand && (
              <div className="mt-2 flex items-center gap-2 bg-black/40 rounded px-2.5 py-1.5">
                <code className="flex-1 font-mono text-[11px] text-orange-300/80 truncate">{fullCommand}</code>
              </div>
            )}

            {/* Debug section */}
            {parsedPlayers && parsedPlayers.length > 0 && (
              <div className="mt-2">
                <button
                  onClick={() => setShowDebug((v) => !v)}
                  className="text-[10px] text-white/20 hover:text-white/40 transition-colors"
                >
                  {showDebug ? "▲ Debug" : "▼ Debug"}
                </button>
                {showDebug && (() => {
                  const dbg = buildVoiceDebugInfo(parsedPlayers, voiceMode, playersToHear ?? null);
                  return (
                    <pre className="mt-1 text-[9px] text-white/45 bg-black/50 p-2 rounded-lg overflow-x-auto leading-relaxed">
                      {JSON.stringify({ voiceMode, spieler: dbg.players, bitmask: dbg.bitmask }, null, 2)}
                    </pre>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">

          {/* "Auf FACEIT öffnen" — primary action, always visible */}
          <a
            href={matchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[#FF5500]/40 bg-[#FF5500]/8 hover:bg-[#FF5500]/18 text-[#FF5500]/80 hover:text-[#FF5500] text-sm font-medium transition-all"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Auf FACEIT öffnen
          </a>

          {/* Actions available after the demo has been processed locally */}
          {isAlreadyProcessed && (
            <>
              {/* Copy play command */}
              <button
                onClick={handleCopyCommand}
                disabled={!fullCommand && !!playdemoArg && (voiceMode === "team_t" || voiceMode === "team_ct")}
                title={!fullCommand && playdemoArg ? "Sprachfilter nicht verfügbar — Demo-Daten fehlen" : undefined}
                className={cn(
                  "flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed",
                  cmdCopied
                    ? "bg-green-600 text-white"
                    : "bg-white/8 hover:bg-white/15 border border-white/12 text-white/80 hover:text-white"
                )}
              >
                {cmdCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {cmdCopied ? "Kopiert!" : "Befehl kopieren"}
              </button>

              {/* Launch in CS2 (Tauri only) */}
              {isTauri() && (
                <button
                  onClick={handleWatch}
                  disabled={launching}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-white text-sm font-medium transition-colors disabled:opacity-40"
                >
                  {launching
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Play className="w-3.5 h-3.5" />}
                  In CS2 öffnen
                </button>
              )}

              <button
                onClick={() => navigate("/library")}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/30 hover:text-white/60 hover:bg-white/5 transition-all"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Bibliothek
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

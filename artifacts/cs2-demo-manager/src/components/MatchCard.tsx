import { useState, useEffect } from "react";
import {
  Download, Play, FolderOpen, Loader2, CheckCircle2, AlertCircle,
  Calendar, Map, Trophy, Copy, Check, Users, Volume2, Info,
} from "lucide-react";
import type { FaceitHistoryItem } from "../types/faceit";
import { useFaceit } from "../context/FaceitContext";
import { useApp } from "../context/AppContext";
import {
  getMatchResult, getOpponentTeam, getOwnTeam, prettyMapName,
  formatMatchDate, getScoreString, getMatchDetails,
} from "../services/faceitMatchService";
import {
  resolveDemoUrl, downloadFaceitDemo, demoDisplayName, findDownloadedDemo,
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
  getPlayersForMode,
  getPlayersToHear,
  hasEntityIds,
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
  const { connection, downloadStates, setDownloadState } = useFaceit();
  const { settings, setStatus, refreshDemos } = useApp();
  const [, navigate] = useLocation();

  // Demo/details state
  const [demoUrlChecked, setDemoUrlChecked] = useState(false);
  const [hasDemoUrl, setHasDemoUrl] = useState<boolean | null>(null);
  const [mapName, setMapName] = useState<string | null>(null);

  // Voice mode for copy-command
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("all");
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [cmdCopied, setCmdCopied] = useState(false);
  const [launching, setLaunching] = useState(false);

  // Demo player parser (entity IDs for tv_listen_voice_indices)
  const [parsedPlayers, setParsedPlayers] = useState<TauriDemoPlayer[] | null>(null);
  const [parsing, setParsing] = useState(false);

  // Auto-parse on mount if this demo was already downloaded in a previous session
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

  const dlState = downloadStates[match.match_id] ?? { status: "idle" };
  const existingDemo = findDownloadedDemo(match.match_id);
  const isAlreadyDownloaded = dlState.status === "done" || existingDemo !== null;

  // Build playdemo arg from downloaded demo file
  const downloadedDemo = existingDemo;
  const playdemoArg = downloadedDemo
    ? buildPlaydemoArg(downloadedDemo.filename)
    : dlState.demoPath
      ? buildPlaydemoArg(dlState.demoPath.split(/[\\/]/).pop() ?? "")
      : null;

  // Computed rosters from parsed .dem players
  const rosters: DemoRosters | null = parsedPlayers ? buildRosters(parsedPlayers) : null;
  const userXuid = settings.steamId || undefined;

  // Players displayed in the voice-mode player list
  const playersForMode = getPlayersForMode(voiceMode, rosters, userXuid);

  // Players to HEAR (their entityIds drive tv_listen_voice_indices)
  const playersToHear = getPlayersToHear(voiceMode, rosters, userXuid);

  // True when tv_listen_voice_indices can be generated
  const autoMuteAvailable =
    (voiceMode === "own_team" || voiceMode === "enemy") &&
    playersToHear !== null &&
    hasEntityIds(playersToHear);

  const fullCommand = playdemoArg
    ? buildFullPlayCommand(playdemoArg, voiceMode, playersToHear)
    : null;

  // ── Lazy-load demo details (map, availability) ───────────────────────────
  async function checkDemoAvailability() {
    if (demoUrlChecked || !connection) return;
    try {
      const details = await getMatchDetails(match.match_id, connection);
      setHasDemoUrl(!!(details.demo_url && details.demo_url.length > 0));
      const rawMap = details.voting?.map?.pick?.[0] ?? null;
      if (rawMap) setMapName(prettyMapName(rawMap));
    } catch {
      setHasDemoUrl(false);
    } finally {
      setDemoUrlChecked(true);
    }
  }

  // ── Download demo ────────────────────────────────────────────────────────
  async function handleDownload() {
    if (!connection) return;

    if (isTauri() && !settings.demoDirectory) {
      setStatus({
        type: "error",
        message: "Kein CS2 Replay-Ordner konfiguriert. Bitte CS2 in den Einstellungen automatisch erkennen lassen.",
      });
      return;
    }

    setDownloadState(match.match_id, { status: "downloading", progress: 0 });
    try {
      const details = await getMatchDetails(match.match_id, connection);

      // Extract map name while we have the details
      const rawMap = details.voting?.map?.pick?.[0] ?? null;
      if (rawMap) setMapName(prettyMapName(rawMap));

      const url = await resolveDemoUrl(match.match_id, connection, details);
      if (!url) {
        setDownloadState(match.match_id, {
          status: "error",
          error: "Für dieses Match ist keine Demo verfügbar.",
        });
        return;
      }

      const displayName = demoDisplayName(match.match_id, mapName ?? prettyMapName(rawMap));
      setDownloadState(match.match_id, { status: "downloading", progress: 10 });

      const demo = await downloadFaceitDemo(
        match.match_id,
        url,
        settings.demoDirectory,
        displayName,
        (phase, percent) => {
          setDownloadState(match.match_id, {
            status: phase === "extracting" ? "extracting" : "downloading",
            progress: percent,
          });
        }
      );

      if (demo) {
        setDownloadState(match.match_id, {
          status: "done",
          demoPath: demo.filepath,
          demoId: demo.id,
        });
        await refreshDemos();
        setStatus({
          type: "success",
          message: `Demo „${displayName}" wurde im Replay-Ordner gespeichert.`,
        });

        // Parse entity IDs from the freshly downloaded .dem file
        if (isTauri() && demo.filepath) {
          setParsing(true);
          tauriParseDemoPlayers(demo.filepath)
            .then((players) => setParsedPlayers(players))
            .catch(() => setParsedPlayers([]))
            .finally(() => setParsing(false));
        }
      } else {
        setDownloadState(match.match_id, { status: "done" });
        setStatus({
          type: "info",
          message: "Browser-Download gestartet. Demo muss manuell in den CS2 Replay-Ordner verschoben werden.",
        });
      }
    } catch (err) {
      setDownloadState(match.match_id, { status: "error", error: String(err) });
      setStatus({ type: "error", message: String(err) });
    }
  }

  // ── Copy command ─────────────────────────────────────────────────────────
  async function handleCopyCommand() {
    if (!fullCommand) {
      setStatus({ type: "error", message: "Demo wurde noch nicht verarbeitet — bitte zuerst herunterladen." });
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
    if (!downloadedDemo) return;

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
      const outcome = await launchDemoInCS2(downloadedDemo.filename, settings.cs2Path);
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

  // ── Styling based on result ───────────────────────────────────────────────
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
      onMouseEnter={checkDemoAvailability}
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
              {mapName ?? (demoUrlChecked ? "–" : match.competition_name)}
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

        {/* Demo status badges */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {demoUrlChecked && !isAlreadyDownloaded && (
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full border",
              hasDemoUrl
                ? "border-green-700/40 bg-green-900/20 text-green-400"
                : "border-white/8 bg-white/3 text-white/25"
            )}>
              {hasDemoUrl ? "Demo verfügbar" : "Keine Demo"}
            </span>
          )}
          {isAlreadyDownloaded && (
            <span className="flex items-center gap-1 text-xs text-orange-400">
              <CheckCircle2 className="w-3 h-3" />
              Heruntergeladen
            </span>
          )}
          {/* Parsing status */}
          {isAlreadyDownloaded && isTauri() && parsing && (
            <span className="flex items-center gap-1 text-xs text-white/30">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              Analysiere Demo...
            </span>
          )}
          {isAlreadyDownloaded && isTauri() && !parsing && parsedPlayers && parsedPlayers.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-white/30">
              <Users className="w-2.5 h-2.5" />
              {parsedPlayers.length} Spieler erkannt
            </span>
          )}
        </div>

        {/* Download error */}
        {dlState.status === "error" && dlState.error && (
          <div className="mb-3 flex items-start gap-2 p-2.5 rounded-lg bg-red-900/20 border border-red-700/30">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300/80 text-xs">{dlState.error}</p>
          </div>
        )}

        {/* Voice mode picker (only when demo is downloaded) */}
        {isAlreadyDownloaded && showVoicePicker && (
          <div className="mb-3 p-3 rounded-lg bg-black/30 border border-white/6">
            <p className="text-white/40 text-xs mb-2 flex items-center gap-1.5">
              <Volume2 className="w-3 h-3" />
              Voice-Modus
              {parsing && <Loader2 className="w-2.5 h-2.5 animate-spin text-white/20" />}
            </p>
            <div className="grid grid-cols-4 gap-1">
              {VOICE_OPTIONS.map((opt) => {
                const needsRoster = opt.mode === "own_team" || opt.mode === "enemy";
                const hasRoster = needsRoster && rosters !== null;
                const isSelected = voiceMode === opt.mode;
                const dotStatus = !needsRoster
                  ? "ok"
                  : autoMuteAvailable && isSelected
                    ? "auto"
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
                    {dotStatus === "auto" && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-400" title="Automatische Stummschaltung aktiv" />
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
            {(voiceMode === "own_team" || voiceMode === "enemy") && (
              <div className={cn(
                "mt-2 px-2.5 py-1.5 rounded-lg border text-[10px] flex items-center gap-1.5",
                autoMuteAvailable
                  ? "bg-green-900/20 border-green-700/30 text-green-300/80"
                  : "bg-black/20 border-white/6 text-white/30"
              )}>
                <Info className="w-3 h-3 shrink-0" />
                {autoMuteAvailable
                  ? `${playersToHear?.length ?? 0} Spieler werden automatisch gehört (Gegenseite stumm) — Befehl unten kopieren.`
                  : rosters
                    ? "Spieler-IDs nicht gefunden — Stummschaltung manuell über das CS2-Scoreboard."
                    : "Demo wird noch analysiert…"}
              </div>
            )}

            {/* Player list for own_team / enemy — prefer parsed data, fall back to FACEIT roster */}
            {(voiceMode === "own_team" || voiceMode === "enemy") && (
              <div className="mt-2 p-2 rounded-lg bg-black/25 border border-white/5">
                <p className="text-white/30 text-[10px] font-semibold mb-1 uppercase tracking-wider">
                  {voiceMode === "own_team" ? "Eigenes Team" : "Gegner"}
                </p>
                {playersForMode && playersForMode.length > 0 ? (
                  /* Parsed roster with slot numbers */
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
                ) : (
                  /* Fallback: FACEIT roster */
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                    {(voiceMode === "own_team" ? ownTeam : opponent).players.map((p) => (
                      <span key={p.nickname} className="text-white/55 text-[11px]">{p.nickname}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {fullCommand && (
              <div className="mt-2 flex items-center gap-2 bg-black/40 rounded px-2.5 py-1.5">
                <code className="flex-1 font-mono text-[11px] text-orange-300/80 truncate">{fullCommand}</code>
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {isAlreadyDownloaded ? (
            <>
              {/* Copy command — primary */}
              <button
                onClick={handleCopyCommand}
                className={cn(
                  "flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all",
                  cmdCopied
                    ? "bg-green-600 text-white"
                    : "bg-white/8 hover:bg-white/15 border border-white/12 text-white/80 hover:text-white"
                )}
              >
                {cmdCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {cmdCopied ? "Kopiert!" : "Befehl kopieren"}
              </button>

              {/* Voice toggle */}
              <button
                onClick={() => setShowVoicePicker((v) => !v)}
                className={cn(
                  "p-2 rounded-lg border text-xs transition-all",
                  showVoicePicker
                    ? "border-orange-500/50 bg-orange-500/10 text-orange-300"
                    : "border-white/10 text-white/30 hover:text-white/60 hover:border-white/20"
                )}
                title="Voice-Modus wählen"
              >
                <Volume2 className="w-3.5 h-3.5" />
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
          ) : dlState.status === "downloading" || dlState.status === "extracting" ? (
            <div className="flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-orange-400 animate-spin" />
              <div>
                <p className="text-orange-300 text-xs font-medium">
                  {dlState.status === "extracting" ? "Wird entpackt..." : "Wird heruntergeladen..."}
                </p>
                {dlState.progress !== undefined && (
                  <div className="w-32 h-1 mt-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-orange-500 transition-all duration-300"
                      style={{ width: `${dlState.progress}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Demo not downloaded yet — show download button */}
              {hasDemoUrl === false ? (
                <span className="text-white/25 text-xs px-3 py-2">Keine Demo verfügbar</span>
              ) : (
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-orange-500/50 bg-orange-500/10 hover:bg-orange-500/20 text-orange-300 text-sm font-medium transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  Demo herunterladen
                </button>
              )}
            </>
          )}

          {/* FACEIT link */}
          {match.faceit_url && (
            <a
              href={match.faceit_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/25 hover:text-white/55 hover:bg-white/5 transition-all"
            >
              <Trophy className="w-3.5 h-3.5" />
              FACEIT
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

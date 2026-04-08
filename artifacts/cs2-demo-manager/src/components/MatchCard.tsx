import { useState } from "react";
import {
  Download, Play, FolderOpen, Loader2, CheckCircle2, AlertCircle,
  Calendar, Map, Trophy, X, Users,
} from "lucide-react";
import type { FaceitHistoryItem } from "../types/faceit";
import { useFaceit } from "../context/FaceitContext";
import { useApp } from "../context/AppContext";
import {
  getMatchResult, getOpponentTeam, getOwnTeam, prettyMapName, formatMatchDate, getScoreString,
} from "../services/faceitMatchService";
import {
  resolveDemoUrl, downloadFaceitDemo, demoDisplayName, findDownloadedDemo,
} from "../services/faceitDownloadService";
import { getMatchDetails } from "../services/faceitMatchService";
import { launchDemoInCS2 } from "../services/cs2Service";
import { isTauri } from "../services/tauriBridge";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

interface MatchCardProps {
  match: FaceitHistoryItem;
}

export function MatchCard({ match }: MatchCardProps) {
  const { connection, downloadStates, setDownloadState } = useFaceit();
  const { settings, setStatus, refreshDemos } = useApp();
  const [, navigate] = useLocation();
  const [demoUrlChecked, setDemoUrlChecked] = useState(false);
  const [hasDemoUrl, setHasDemoUrl] = useState<boolean | null>(null);

  if (!connection) return null;

  const playerId = connection.playerId;
  const result = getMatchResult(match, playerId);
  const opponent = getOpponentTeam(match, playerId);
  const ownTeam = getOwnTeam(match, playerId);
  const mapRaw = match.competition_name?.toLowerCase().includes("de_") ? null : null;
  const score = getScoreString(match, playerId);
  const dateStr = formatMatchDate(match.started_at);

  const dlState = downloadStates[match.match_id] ?? { status: "idle" };
  const existingDemo = findDownloadedDemo(match.match_id);
  const isAlreadyDownloaded = dlState.status === "done" || existingDemo !== null;

  async function checkDemoAvailability() {
    if (demoUrlChecked || !connection) return;
    try {
      const details = await getMatchDetails(match.match_id, connection);
      setHasDemoUrl(!!(details.demo_url && details.demo_url.length > 0));
    } catch {
      setHasDemoUrl(false);
    } finally {
      setDemoUrlChecked(true);
    }
  }

  async function handleDownload() {
    if (!connection) return;

    // In Tauri mode: block if no replay folder is configured — demos must go
    // into the CS2 replay folder or CS2 won't find them.
    if (isTauri() && !settings.demoDirectory) {
      setStatus({
        type: "error",
        message:
          "Kein CS2 Replay-Ordner konfiguriert. Bitte die Einstellungen öffnen und CS2 automatisch erkennen lassen.",
      });
      return;
    }

    setDownloadState(match.match_id, { status: "downloading", progress: 0 });
    try {
      const details = await getMatchDetails(match.match_id, connection);
      const url = await resolveDemoUrl(match.match_id, connection, details);
      if (!url) {
        setDownloadState(match.match_id, {
          status: "error",
          error: "Für dieses Match ist keine Demo verfügbar.",
        });
        return;
      }

      const mapName = details.voting?.map?.pick?.[0] ?? null;
      const displayName = demoDisplayName(match.match_id, prettyMapName(mapName));

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
        setDownloadState(match.match_id, { status: "done", demoPath: demo.filepath, demoId: demo.id });
        await refreshDemos();
        setStatus({ type: "success", message: `Demo „${displayName}" in den CS2 Replay-Ordner heruntergeladen.` });
      } else {
        // Browser fallback — file downloaded to browser's Downloads folder
        setDownloadState(match.match_id, { status: "done" });
        setStatus({
          type: "info",
          message:
            "Browser-Download gestartet. Im Browser-Modus wird die Demo in deinen Downloads-Ordner gespeichert und muss manuell in den CS2 Replay-Ordner verschoben werden. Vollständiger Workflow (automatisch in Replay-Ordner + direkt spielbar) ist nur in der nativen Desktop-App verfügbar.",
        });
      }
    } catch (err) {
      setDownloadState(match.match_id, { status: "error", error: String(err) });
      setStatus({ type: "error", message: String(err) });
    }
  }

  async function handleWatch() {
    const demo = existingDemo;
    if (!demo) return;

    // Browser mode: can't control file location or launch CS2 reliably
    if (!isTauri()) {
      setStatus({
        type: "info",
        message:
          "Demo in CS2 starten ist nur in der nativen Desktop-App möglich. Im Browser: Starte CS2, öffne die Konsole und gib den playdemo-Befehl manuell ein.",
      });
      return;
    }

    // Use filename (not filepath) — cs2Service derives "replays/FILENAME" from it
    const result2 = await launchDemoInCS2(demo.filename, settings.cs2Path);
    if (result2 === "launched") {
      setStatus({ type: "success", message: `Demo wird über Steam in CS2 gestartet...` });
    } else {
      setStatus({
        type: "info",
        message: "CS2 konnte nicht automatisch gestartet werden. Befehl wurde in die Zwischenablage kopiert — in CS2-Konsole einfügen.",
      });
    }
  }

  function handleOpenInLibrary() {
    navigate("/library");
  }

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
        {/* Header: result badge + score + date */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            {/* Result badge */}
            <span className={cn("text-xs font-bold uppercase tracking-widest", resultColor)}>
              {resultLabel}
            </span>
            {/* Score */}
            {match.results && (
              <span className="text-white/60 text-sm font-mono font-semibold">
                {score}
              </span>
            )}
            {/* Competition name */}
            <span className="text-white/25 text-xs truncate max-w-40">
              {match.competition_name}
            </span>
          </div>
          {/* Date */}
          <div className="flex items-center gap-1.5 text-white/30 text-xs">
            <Calendar className="w-3 h-3" />
            {dateStr}
          </div>
        </div>

        {/* Teams row */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            {ownTeam.players.slice(0, 5).map((p) => (
              <span key={p.player_id ?? p.nickname} className="text-white/70 text-xs font-medium truncate">
                {p.nickname}
              </span>
            ))}
          </div>
          <span className="text-white/20 text-xs shrink-0">vs</span>
          <div className="flex items-center gap-1 min-w-0">
            <Users className="w-3 h-3 text-white/25 shrink-0" />
            <span className="text-white/40 text-xs font-medium truncate">
              {opponent.nickname || opponent.players.slice(0, 2).map((p) => p.nickname).join(", ")}
            </span>
          </div>
        </div>

        {/* Map + demo status */}
        <div className="flex items-center gap-3 mb-4">
          {match.competition_name && (
            <div className="flex items-center gap-1.5">
              <Map className="w-3 h-3 text-white/25" />
              <span className="text-white/35 text-xs font-mono">
                {match.competition_name}
              </span>
            </div>
          )}

          {/* Demo availability indicator */}
          {demoUrlChecked && (
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
        </div>

        {/* Download error */}
        {dlState.status === "error" && dlState.error && (
          <div className="mb-3 flex items-start gap-2 p-2.5 rounded-lg bg-red-900/20 border border-red-700/30">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300/80 text-xs">{dlState.error}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {isAlreadyDownloaded ? (
            <>
              {isTauri() ? (
                <button
                  onClick={handleWatch}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-white text-sm font-medium transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  In CS2 ansehen
                </button>
              ) : (
                <div
                  title="Nur in der nativen Desktop-App verfügbar"
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/3 text-white/25 text-sm font-medium cursor-not-allowed select-none"
                >
                  <Play className="w-3.5 h-3.5" />
                  In CS2 ansehen
                  <span className="text-xs text-white/20">(nur Desktop)</span>
                </div>
              )}
              <button
                onClick={handleOpenInLibrary}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium text-white/50 hover:text-white/80 hover:bg-white/8 transition-all"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                In Bibliothek
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
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-orange-500/50 bg-orange-500/10 hover:bg-orange-500/20 text-orange-300 text-sm font-medium transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              Demo herunterladen
            </button>
          )}

          <a
            href={match.faceit_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm text-white/30 hover:text-white/60 hover:bg-white/5 transition-all"
          >
            <Trophy className="w-3.5 h-3.5" />
            FACEIT
          </a>
        </div>
      </div>
    </div>
  );
}

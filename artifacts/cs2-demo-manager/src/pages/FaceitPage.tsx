import { useState } from "react";
import {
  RefreshCw, LogOut, Loader2, AlertCircle, User, Shield,
  Wifi, WifiOff, Info, Download, FolderSearch,
} from "lucide-react";
import { useFaceit } from "../context/FaceitContext";
import { useApp } from "../context/AppContext";
import { MatchCard } from "../components/MatchCard";
import { startOAuthFlow, FACEIT_CLIENT_ID } from "../services/faceitAuthService";
import { isTauri } from "../services/tauriBridge";
import { scanDownloadsFolder, processCandidates } from "../services/downloadsService";
import { cn } from "@/lib/utils";

export function FaceitPage() {
  const { connection, isConnected, matches, isLoadingMatches, matchError, refreshMatches, setConnection, disconnect } = useFaceit();
  const { settings, setStatus, refreshDemos, updateSettings } = useApp();

  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // ── Downloads-Ordner scannen ──────────────────────────────────────────────
  async function handleScanDownloads() {
    const folder = settings.downloadsFolder;
    const replayFolder = settings.demoDirectory;

    if (!folder) {
      setStatus({ type: "error", message: "Kein Downloads-Ordner konfiguriert. Bitte in den Einstellungen festlegen." });
      return;
    }
    if (!replayFolder) {
      setStatus({ type: "error", message: "Kein CS2 Replay-Ordner konfiguriert. Bitte CS2 in den Einstellungen erkennen lassen." });
      return;
    }

    setScanning(true);
    try {
      const { candidates, errors } = await scanDownloadsFolder(folder);
      if (errors.length > 0) { setStatus({ type: "error", message: errors[0] }); return; }
      if (candidates.length === 0) {
        setStatus({ type: "info", message: "Im Downloads-Ordner wurde keine neue Demo gefunden." });
        return;
      }
      setStatus({ type: "info", message: `${candidates.length} Demo(s) gefunden — wird verarbeitet...` });
      const result = await processCandidates(candidates, replayFolder);
      await refreshDemos();
      const parts: string[] = [];
      if (result.processed.length > 0) parts.push(`${result.processed.length} Demo(s) wurden im Replay-Ordner gespeichert.`);
      if (result.skipped.length > 0) parts.push(`${result.skipped.length} bereits vorhanden.`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} Fehler.`);
      setStatus({ type: result.processed.length > 0 ? "success" : "info", message: parts.join(" ") || "Keine neuen Demos." });
    } catch (err) {
      setStatus({ type: "error", message: String(err) });
    } finally {
      setScanning(false);
    }
  }

  async function handleOAuthConnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const conn = await startOAuthFlow();
      setConnection(conn);
      if (conn.steamId) {
        updateSettings({ steamId: conn.steamId });
      }
    } catch (err) {
      setConnectError(String(err));
    } finally {
      setConnecting(false);
    }
  }

  // ── Not connected ─────────────────────────────────────────────────────────
  if (!isConnected || !connection) {
    return (
      <div className="max-w-lg mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-10">
          <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-[#FF5500]/10 border border-[#FF5500]/30 flex items-center justify-center">
            <svg className="w-10 h-10 text-[#FF5500]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">FACEIT verbinden</h1>
          <p className="text-white/45 text-sm mt-2">
            Verbinde dein FACEIT-Konto, um deine CS2-Matches zu sehen und Demos zu verarbeiten.
          </p>
        </div>

        {/* OAuth button */}
        {FACEIT_CLIENT_ID ? (
          <>
            <button
              onClick={handleOAuthConnect}
              disabled={connecting}
              className="w-full flex items-center justify-center gap-3 py-3.5 rounded-xl font-semibold text-sm bg-[#FF5500] hover:bg-[#ff6620] active:bg-[#e64d00] text-white transition-all duration-150 mb-2 disabled:opacity-60 disabled:cursor-wait"
            >
              {connecting
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Shield className="w-4 h-4" />}
              {connecting
                ? (isTauri() ? "Warte auf Browser…" : "Verbinde…")
                : "Mit FACEIT anmelden"}
            </button>

            {connecting && isTauri() && (
              <p className="text-white/35 text-xs text-center mb-3">
                Der Browser wurde geöffnet — melde dich bei FACEIT an und kehre dann zur App zurück.
              </p>
            )}

            {connectError && (
              <div className="mb-3 flex items-start gap-2 p-3 rounded-lg bg-red-900/25 border border-red-700/35">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-red-300/90 text-xs">{connectError}</p>
              </div>
            )}

            {!connecting && (
              <div className="mt-2 flex items-start gap-2 p-3 rounded-xl border border-white/6 bg-white/2">
                <Info className="w-3 h-3 text-white/25 shrink-0 mt-0.5" />
                <p className="text-white/30 text-xs leading-relaxed">
                  Im FACEIT Developer Portal folgende Redirect URI eintragen:{" "}
                  <code className="text-white/55 font-mono">https://127.0.0.1:14523/callback</code>
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="mb-4 flex items-start gap-3 p-4 rounded-xl border border-yellow-700/30 bg-yellow-900/15">
            <Info className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-300 text-sm font-medium">OAuth nicht konfiguriert</p>
              <p className="text-yellow-200/55 text-xs mt-1">
                Für den OAuth-Login wird eine FACEIT App CLIENT_ID benötigt (VITE_FACEIT_CLIENT_ID).
              </p>
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="mt-8 p-4 rounded-xl border border-white/6 bg-white/2">
          <p className="text-white/40 text-xs font-medium mb-2">So funktioniert es:</p>
          <ul className="text-white/30 text-xs space-y-1.5">
            <li>① Letzte CS2-Matches werden geladen und angezeigt</li>
            <li>② „Auf FACEIT öffnen" — Match-Seite im Browser öffnen</li>
            <li>③ Demo dort manuell herunterladen</li>
            <li>④ „Downloads scannen" — Demo wird erkannt und verarbeitet</li>
            <li>⑤ Demo mit einem Klick in CS2 starten</li>
          </ul>
        </div>
      </div>
    );
  }

  // ── Connected ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div className="relative">
            {connection.avatar ? (
              <img
                src={connection.avatar}
                alt={connection.nickname}
                className="w-10 h-10 rounded-xl object-cover border border-white/10"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-[#FF5500]/15 border border-[#FF5500]/25 flex items-center justify-center">
                <User className="w-5 h-5 text-[#FF5500]" />
              </div>
            )}
            <div className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-green-500 border border-[#0d1117]" />
          </div>

          <div>
            <h1 className="text-lg font-bold text-white">{connection.nickname}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              {connection.skillLevel && (
                <span className="text-white/40 text-xs">
                  Level {connection.skillLevel}
                </span>
              )}
              {connection.elo && (
                <span className="text-white/25 text-xs">• {connection.elo} ELO</span>
              )}
              <span className={cn(
                "text-xs px-1.5 py-0.5 rounded border",
                connection.authMethod === "oauth"
                  ? "border-green-700/40 text-green-400 bg-green-900/15"
                  : "border-white/10 text-white/30"
              )}>
                {connection.authMethod === "oauth" ? "OAuth" : "API Key"}
              </span>
            </div>
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {/* Downloads-Ordner scannen (Tauri only) */}
          {isTauri() && (
            <button
              onClick={handleScanDownloads}
              disabled={scanning}
              title="Downloads-Ordner nach Demos durchsuchen und in den Replay-Ordner verarbeiten"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-orange-500/30 bg-orange-500/8 hover:bg-orange-500/18 text-orange-300/70 hover:text-orange-300 text-xs font-medium transition-all disabled:opacity-50"
            >
              {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderSearch className="w-3.5 h-3.5" />}
              Downloads scannen
            </button>
          )}
          <button
            onClick={refreshMatches}
            disabled={isLoadingMatches}
            title="Matches neu laden"
            className="p-2 rounded-xl border border-white/10 bg-white/3 hover:bg-white/8 text-white/40 hover:text-white/70 transition-all disabled:opacity-50"
          >
            {isLoadingMatches
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <RefreshCw className="w-4 h-4" />
            }
          </button>
          <button
            onClick={disconnect}
            title="Verbindung trennen"
            className="p-2 rounded-xl border border-red-900/40 bg-red-900/10 hover:bg-red-900/20 text-red-400/70 hover:text-red-400 transition-all"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Workflow hint banner */}
      {isTauri() && (
        <div className="mb-5 flex items-start gap-3 p-4 rounded-xl border border-white/8 bg-white/2">
          <Download className="w-4 h-4 text-white/30 shrink-0 mt-0.5" />
          <p className="text-white/35 text-xs">
            <span className="text-white/55 font-medium">Demo herunterladen: </span>
            Match-Seite auf FACEIT öffnen → Demo dort herunterladen → „Downloads scannen" drücken →
            Demo wird automatisch entpackt und in den Replay-Ordner verschoben.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 mb-6">
        <Wifi className="w-3.5 h-3.5 text-[#FF5500]" />
        <span className="text-white/40 text-sm">Letzte CS2-Matches</span>
        {!isLoadingMatches && matches.length > 0 && (
          <span className="text-white/20 text-sm">({matches.length})</span>
        )}
      </div>

      {/* Error state */}
      {matchError && (
        <div className="mb-5 flex items-start gap-3 p-4 rounded-xl border border-red-700/30 bg-red-900/15">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-300 text-sm font-medium">Fehler beim Laden der Matches</p>
            <p className="text-red-200/60 text-xs mt-1">{matchError}</p>
            <button
              onClick={refreshMatches}
              className="mt-2 text-red-400 hover:text-red-300 text-xs underline"
            >
              Erneut versuchen
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoadingMatches && matches.length === 0 && (
        <div className="flex flex-col items-center py-20">
          <Loader2 className="w-8 h-8 text-[#FF5500]/60 animate-spin mb-3" />
          <p className="text-white/35 text-sm">Matches werden geladen...</p>
        </div>
      )}

      {/* Empty state */}
      {!isLoadingMatches && !matchError && matches.length === 0 && (
        <div className="flex flex-col items-center py-20 text-center">
          <WifiOff className="w-12 h-12 text-white/10 mb-4" />
          <p className="text-white/40 text-sm font-medium">Keine Matches gefunden</p>
          <p className="text-white/20 text-xs mt-1">Spieler hat noch keine CS2-Partien auf FACEIT.</p>
        </div>
      )}

      {/* Match list */}
      {matches.length > 0 && (
        <div className="space-y-3">
          {matches.map((m) => (
            <MatchCard key={m.match_id} match={m} />
          ))}
        </div>
      )}
    </div>
  );
}

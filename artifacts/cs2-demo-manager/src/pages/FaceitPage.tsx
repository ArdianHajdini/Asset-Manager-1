import { useState } from "react";
import { RefreshCw, LogOut, Loader2, AlertCircle, User, Shield, Key, Wifi, WifiOff, Info, Download } from "lucide-react";
import { useFaceit } from "../context/FaceitContext";
import { useApp } from "../context/AppContext";
import { MatchCard } from "../components/MatchCard";
import { connectWithApiKey, startOAuthFlow, FACEIT_CLIENT_ID } from "../services/faceitAuthService";
import { isTauri } from "../services/tauriBridge";
import { scanDownloadsFolder, processCandidates } from "../services/downloadsService";
import { cn } from "@/lib/utils";

export function FaceitPage() {
  const { connection, isConnected, matches, isLoadingMatches, matchError, refreshMatches, setConnection, disconnect } = useFaceit();
  const { settings, setStatus, refreshDemos } = useApp();

  // Connection form state
  const [nickname, setNickname] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const [scanning, setScanning] = useState(false);

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

  async function handleApiKeyConnect() {
    if (!nickname.trim() || !apiKey.trim()) {
      setConnectError("Bitte gib deinen Nickname und den API-Schlüssel ein.");
      return;
    }
    setConnecting(true);
    setConnectError(null);
    try {
      const conn = await connectWithApiKey(nickname.trim(), apiKey.trim());
      setConnection(conn);
    } catch (err) {
      setConnectError(String(err));
    } finally {
      setConnecting(false);
    }
  }

  async function handleOAuthConnect() {
    try {
      await startOAuthFlow();
    } catch (err) {
      setConnectError(String(err));
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
            Verbinde dein FACEIT-Konto, um deine CS2-Matches zu sehen, Demos herunterzuladen und mit einem Klick zu starten.
          </p>
        </div>

        {/* OAuth button (if CLIENT_ID is configured) */}
        {FACEIT_CLIENT_ID ? (
          <button
            onClick={handleOAuthConnect}
            className="w-full flex items-center justify-center gap-3 py-3.5 rounded-xl font-semibold text-sm bg-[#FF5500] hover:bg-[#ff6620] active:bg-[#e64d00] text-white transition-all duration-150 mb-4"
          >
            <Shield className="w-4 h-4" />
            Mit FACEIT anmelden (OAuth)
          </button>
        ) : (
          <div className="mb-4 flex items-start gap-3 p-4 rounded-xl border border-yellow-700/30 bg-yellow-900/15">
            <Info className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-300 text-sm font-medium">OAuth nicht konfiguriert</p>
              <p className="text-yellow-200/55 text-xs mt-1">
                Für den OAuth-Login wird eine FACEIT App CLIENT_ID benötigt.
                Bitte verbinde dich stattdessen mit einem API-Schlüssel oder lies
                die <code className="text-yellow-300">faceit-integration-plan.md</code> für Setup-Anweisungen.
              </p>
            </div>
          </div>
        )}

        {/* API Key form toggle */}
        {!showApiKeyForm ? (
          <button
            onClick={() => setShowApiKeyForm(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-white/10 bg-white/3 hover:bg-white/8 text-white/60 hover:text-white/80 text-sm font-medium transition-all"
          >
            <Key className="w-4 h-4" />
            Mit API-Schlüssel verbinden
          </button>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-white/50 text-xs font-medium mb-1.5">
                FACEIT Nickname
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="dein_nickname"
                autoFocus
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#FF5500]/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-medium mb-1.5">
                FACEIT Data API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                onKeyDown={(e) => { if (e.key === "Enter") handleApiKeyConnect(); }}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#FF5500]/50 transition-colors font-mono"
              />
              <p className="text-white/25 text-xs mt-2">
                Schlüssel erhalten auf:{" "}
                <a
                  href="https://developers.faceit.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#FF5500]/80 hover:text-[#FF5500] underline"
                >
                  developers.faceit.com
                </a>
              </p>
            </div>

            {connectError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-900/25 border border-red-700/35">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-red-300/90 text-xs">{connectError}</p>
              </div>
            )}

            <button
              onClick={handleApiKeyConnect}
              disabled={connecting}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#FF5500] hover:bg-[#ff6620] text-white font-semibold text-sm transition-all disabled:opacity-50"
            >
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
              {connecting ? "Verbinde..." : "Verbinden"}
            </button>

            <button
              onClick={() => { setShowApiKeyForm(false); setConnectError(null); }}
              className="w-full py-2 text-white/30 hover:text-white/60 text-sm transition-colors"
            >
              Abbrechen
            </button>
          </div>
        )}

        {/* Info panel */}
        <div className="mt-8 p-4 rounded-xl border border-white/6 bg-white/2">
          <p className="text-white/40 text-xs font-medium mb-2">Was du nach dem Verbinden tun kannst:</p>
          <ul className="text-white/30 text-xs space-y-1">
            <li>• Letzte CS2-Matches anzeigen</li>
            <li>• Demos direkt aus der App herunterladen</li>
            <li>• .dem.gz automatisch entpacken</li>
            <li>• Demo mit einem Klick in CS2 starten</li>
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
              title="Downloads-Ordner nach Demos durchsuchen"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-orange-500/30 bg-orange-500/8 hover:bg-orange-500/18 text-orange-300/70 hover:text-orange-300 text-xs font-medium transition-all disabled:opacity-50"
            >
              {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
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

      <div className="flex items-center gap-2 mb-6">
        <Wifi className="w-3.5 h-3.5 text-[#FF5500]" />
        <span className="text-white/40 text-sm">Letzte CS2-Matches</span>
        {!isLoadingMatches && matches.length > 0 && (
          <span className="text-white/20 text-sm">({matches.length})</span>
        )}
      </div>

      {/* Browser info banner */}
      {!isTauri() && (
        <div className="mb-5 flex items-start gap-3 p-4 rounded-xl border border-blue-700/25 bg-blue-900/10">
          <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-blue-300/70 text-xs">
            <span className="text-blue-300 font-medium">Browser-Modus: </span>
            Downloads werden als normale Browser-Downloads ausgelöst. Für automatisches Speichern und
            direkten CS2-Start verwende die Desktop-App.
          </p>
        </div>
      )}

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
          {matches.map((match) => (
            <MatchCard key={match.match_id} match={match} />
          ))}
        </div>
      )}
    </div>
  );
}

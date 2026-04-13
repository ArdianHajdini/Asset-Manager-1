import { useState } from "react";
import { X, Skull, Crosshair, Eye, Gauge, Footprints, Users, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TauriDeathEvent, TauriDemoPlayer } from "../services/tauriBridge";
import { tauriParseDemoDeaths, tauriProbePawnProperties } from "../services/tauriBridge";
import { cn } from "@/lib/utils";

interface StatisticsModalProps {
  demoName: string;
  filepath: string;
  players: TauriDemoPlayer[];
  onClose: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getVerdict(d: TauriDeathEvent, t: (key: string) => string): { text: string; color: string } {
  if (!d.hasPosData) return { text: t("stats.verdictNone"), color: "text-white/40" };
  if (!d.wasEnemyInFov) return { text: t("stats.verdictOutsideFov"), color: "text-red-400" };
  if (d.shotBeforeStop) return { text: t("stats.verdictStillMoving"), color: "text-yellow-400" };
  if (d.crosshairErrorDeg > 45) return { text: t("stats.verdictCrosshairFar"), color: "text-orange-400" };
  if (d.crosshairErrorDeg < 15 && d.wasEnemyInFov) return { text: t("stats.verdictGoodAim"), color: "text-blue-400" };
  return { text: t("stats.verdictNone"), color: "text-white/40" };
}

function FightDiagram({ death, t }: { death: TauriDeathEvent; t: (key: string) => string }) {
  if (!death.hasPosData) return null;
  const W = 160, H = 120;
  const dx = death.killerPos[0] - death.victimPos[0];
  const dy = death.killerPos[1] - death.victimPos[1];
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const pad = 30;
  const cx = W / 2, cy = H / 2;
  const scale = Math.min((W - 2 * pad) / 2, (H - 2 * pad) / 2) / (dist / 2);
  const px1 = cx - (dx / 2) * scale;
  const py1 = cy + (dy / 2) * scale;
  const px2 = cx + (dx / 2) * scale;
  const py2 = cy - (dy / 2) * scale;

  return (
    <div className="flex flex-col items-center">
      <svg width={W} height={H} className="rounded-lg bg-black/30 border border-white/6">
        <line x1={px1} y1={py1} x2={px2} y2={py2} stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="4 3" />
        <circle cx={px1} cy={py1} r={5} fill="#3b82f6" />
        <text x={px1} y={py1 + 14} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize={8}>{t("stats.you")}</text>
        <circle cx={px2} cy={py2} r={5} fill="#ef4444" />
        <text x={px2} y={py2 - 8} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize={8}>{t("stats.enemy")}</text>
      </svg>
    </div>
  );
}

function MetricBadge({ label, value, color, icon }: { label: string; value: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 bg-white/3 rounded-lg px-2.5 py-2 min-w-0">
      <div className="flex items-center gap-1 text-white/35">
        {icon}
        <span className="text-[9px] uppercase tracking-wider truncate">{label}</span>
      </div>
      <span className={cn("text-xs font-bold", color)}>{value}</span>
    </div>
  );
}

function DeathCard({ death, t }: { death: TauriDeathEvent; t: (key: string) => string }) {
  const [showDebug, setShowDebug] = useState(false);
  const verdict = getVerdict(death, t);
  const crosshairColor = !death.hasPosData ? "text-white/20"
    : death.crosshairErrorDeg < 15 ? "text-green-400"
    : death.crosshairErrorDeg < 45 ? "text-yellow-400"
    : "text-red-400";
  const speedColor = death.victimSpeed < 10 ? "text-green-400"
    : death.victimSpeed < 60 ? "text-yellow-400"
    : "text-red-400";

  return (
    <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/6 bg-white/2">
        <span className="shrink-0 w-7 h-7 rounded-lg bg-white/8 flex items-center justify-center text-[11px] font-bold text-white/50">
          {death.round}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-white/80 text-sm font-medium truncate">{death.killerName}</span>
            {death.headshot && (
              <span className="shrink-0 px-1 py-0.5 rounded bg-red-500/20 text-red-400 text-[9px] font-bold uppercase">HS</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-white/30">
            <span className="font-mono">{death.weapon}</span>
            <span>·</span>
            <span>{formatTime(death.timeSeconds)}</span>
          </div>
        </div>
        <button
          onClick={() => setShowDebug(v => !v)}
          className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono text-white/20 hover:text-white/50 hover:bg-white/8 transition-all border border-white/8"
          title="Toggle debug info"
        >
          [debug]
        </button>
      </div>

      <div className="p-3 space-y-3">
        <div className="grid grid-cols-4 gap-1.5">
          <MetricBadge
            label={t("stats.crosshairError")}
            value={death.hasPosData ? `${death.crosshairErrorDeg.toFixed(1)}°` : "–"}
            color={crosshairColor}
            icon={<Crosshair className="w-2.5 h-2.5" />}
          />
          <MetricBadge
            label={t("stats.fov")}
            value={!death.hasPosData ? "–" : death.wasEnemyInFov ? t("stats.yes") : t("stats.no")}
            color={!death.hasPosData ? "text-white/20" : death.wasEnemyInFov ? "text-green-400" : "text-red-400"}
            icon={<Eye className="w-2.5 h-2.5" />}
          />
          <MetricBadge
            label={t("stats.speed")}
            value={death.hasPosData ? `${Math.round(death.victimSpeed)}` : "–"}
            color={death.hasPosData ? speedColor : "text-white/20"}
            icon={<Gauge className="w-2.5 h-2.5" />}
          />
          <MetricBadge
            label={t("stats.shotBeforeStop")}
            value={!death.hasPosData ? "–" : death.shotBeforeStop ? t("stats.yes") : t("stats.no")}
            color={!death.hasPosData ? "text-white/20" : death.shotBeforeStop ? "text-red-400" : "text-green-400"}
            icon={<Footprints className="w-2.5 h-2.5" />}
          />
        </div>

        {death.hasPosData && <FightDiagram death={death} t={t} />}

        {showDebug && (
          <div className="px-2.5 py-2 rounded-lg bg-black/40 border border-white/6 overflow-x-auto">
            <p className="text-[9px] font-mono text-white/40 whitespace-pre break-all leading-relaxed">
              {death.debugInfo || "(no debugInfo)"}
            </p>
          </div>
        )}

        <div className={cn("flex items-start gap-2 px-3 py-2 rounded-lg bg-white/3 border border-white/6", verdict.color)}>
          <Skull className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p className="text-xs leading-snug">{verdict.text}</p>
        </div>
      </div>
    </div>
  );
}

function teamBadge(teamNum: number) {
  if (teamNum === 2) return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-yellow-500/20 text-yellow-400">T</span>;
  if (teamNum === 3) return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-400">CT</span>;
  return null;
}

export function StatisticsModal({ demoName, filepath, players, onClose }: StatisticsModalProps) {
  const { t } = useTranslation();
  const [deaths, setDeaths] = useState<TauriDeathEvent[] | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<string | null>(null);
  const [probeLoading, setProbeLoading] = useState(false);

  const activePlayers = players.filter(p => p.teamNum === 2 || p.teamNum === 3);
  const tPlayers = activePlayers.filter(p => p.teamNum === 2);
  const ctPlayers = activePlayers.filter(p => p.teamNum === 3);

  async function handleSelectPlayer(name: string) {
    setSelectedPlayer(name);
    setLoading(true);
    setError(null);
    try {
      const result = await tauriParseDemoDeaths(filepath, name);
      setDeaths(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function copyAllDebug() {
    if (!deaths) return;
    const lines = deaths.map((d, i) =>
      `[${i + 1}] R${d.round} ${d.killerName}→${d.victimName} ${d.weapon}${d.headshot ? " HS" : ""} | ${d.debugInfo}`
    );
    const text = lines.join("\n");
    navigator.clipboard.writeText(text).catch(() => {
      prompt("Copy debug output:", text);
    });
  }

  function handleBack() {
    setDeaths(null);
    setSelectedPlayer(null);
    setError(null);
  }

  async function handleProbe() {
    setProbeLoading(true);
    setProbeResult(null);
    try {
      const result = await tauriProbePawnProperties(filepath);
      setProbeResult(result);
    } catch (err) {
      setProbeResult(`ERROR: ${String(err)}`);
    } finally {
      setProbeLoading(false);
    }
  }

  const showPlayerPicker = deaths === null && !loading;
  const showDeaths = deaths !== null && !loading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl border border-white/10 bg-[#0d1117] shadow-2xl overflow-hidden">

        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 shrink-0">
          <div className="flex items-center gap-2.5">
            {showDeaths ? (
              <button onClick={handleBack} className="p-1 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/8 transition-all mr-1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
            ) : (
              <Skull className="w-4 h-4 text-orange-400" />
            )}
            <div>
              <p className="text-white font-semibold text-sm">
                {showPlayerPicker ? t("stats.selectPlayer") : t("stats.title")}
              </p>
              <p className="text-white/35 text-xs font-mono truncate max-w-[260px]">
                {selectedPlayer ?? demoName}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/8 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-white/40">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm">{t("demo.statsLoading")}</p>
          </div>
        )}

        {error && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-red-400/70">
            <Skull className="w-8 h-8 mb-3 opacity-50" />
            <p className="text-sm">{t("demo.statsError")}</p>
            <p className="text-xs mt-1 text-white/20 max-w-xs text-center break-all">{error}</p>
          </div>
        )}

        {showPlayerPicker && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activePlayers.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-white/30">
                <Users className="w-8 h-8 mb-3 opacity-30" />
                <p className="text-sm">{t("stats.noPlayers")}</p>
              </div>
            )}

            {tPlayers.length > 0 && (
              <div>
                <p className="text-yellow-400/60 text-[10px] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-yellow-500/40 inline-block" />
                  {t("stats.teamT")}
                </p>
                <div className="space-y-1">
                  {tPlayers.map((p, i) => (
                    <button
                      key={`t-${i}`}
                      onClick={() => handleSelectPlayer(p.name)}
                      disabled={!p.name}
                      className={cn(
                        "w-full text-left rounded-xl border px-4 py-3 transition-all flex items-center gap-3",
                        "border-white/6 bg-white/2 hover:bg-white/5 hover:border-white/10",
                        !p.name && "opacity-40 cursor-not-allowed"
                      )}
                    >
                      {teamBadge(p.teamNum)}
                      <span className="text-white/80 text-sm font-medium truncate flex-1">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {ctPlayers.length > 0 && (
              <div>
                <p className="text-blue-400/60 text-[10px] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500/40 inline-block" />
                  {t("stats.teamCT")}
                </p>
                <div className="space-y-1">
                  {ctPlayers.map((p, i) => (
                    <button
                      key={`ct-${i}`}
                      onClick={() => handleSelectPlayer(p.name)}
                      disabled={!p.name}
                      className={cn(
                        "w-full text-left rounded-xl border px-4 py-3 transition-all flex items-center gap-3",
                        "border-white/6 bg-white/2 hover:bg-white/5 hover:border-white/10",
                        !p.name && "opacity-40 cursor-not-allowed"
                      )}
                    >
                      {teamBadge(p.teamNum)}
                      <span className="text-white/80 text-sm font-medium truncate flex-1">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          {/* Probe button — diagnostic tool to find correct property paths */}
          <div className="mt-4 pt-3 border-t border-white/5 flex flex-col gap-2">
            <button
              onClick={handleProbe}
              disabled={probeLoading}
              className="w-full text-[10px] font-mono text-white/20 hover:text-white/50 hover:bg-white/5 rounded-lg px-3 py-2 transition-all border border-white/6 flex items-center justify-center gap-2"
            >
              {probeLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {probeLoading ? "probing pawn entities…" : "[probe pawn properties]"}
            </button>
            {probeResult !== null && (
              <div className="relative">
                <pre className="text-[9px] font-mono text-white/50 bg-white/3 border border-white/6 rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-all leading-relaxed">
                  {probeResult || "(no output)"}
                </pre>
                <button
                  onClick={() => navigator.clipboard.writeText(probeResult).catch(() => prompt("Copy:", probeResult))}
                  className="absolute top-2 right-2 text-[8px] font-mono text-white/30 hover:text-white/60 hover:bg-white/8 px-1.5 py-0.5 rounded border border-white/8 transition-all"
                >
                  copy
                </button>
                <button
                  onClick={() => setProbeResult(null)}
                  className="absolute top-2 right-10 text-[8px] font-mono text-white/30 hover:text-white/60 hover:bg-white/8 px-1.5 py-0.5 rounded border border-white/8 transition-all"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>
        )}

        {showDeaths && deaths.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-white/30">
            <Skull className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">{t("stats.noDeaths")}</p>
            <p className="text-xs mt-1 text-white/20">{t("stats.noDeathsHint")}</p>
          </div>
        )}

        {showDeaths && deaths.length > 0 && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="flex justify-end">
              <button
                onClick={copyAllDebug}
                className="px-2 py-1 rounded text-[9px] font-mono text-white/20 hover:text-white/50 hover:bg-white/8 transition-all border border-white/8"
                title="Copy all debug info to clipboard"
              >
                [copy all debug]
              </button>
            </div>
            {deaths.map((d, i) => (
              <DeathCard key={i} death={d} t={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

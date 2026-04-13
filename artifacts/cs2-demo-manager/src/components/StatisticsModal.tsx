import { useState } from "react";
import { X, Skull, Crosshair, Eye, Gauge, Footprints, Users, Loader2, Target } from "lucide-react";
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

// CS2 map metadata: world-to-radar pixel transform.
// Formula: radarX = (worldX - posX) / scale,  radarY = (posY - worldY) / scale
const MAP_META: Record<string, { posX: number; posY: number; scale: number }> = {
  de_dust2:    { posX: -2476, posY: 3239, scale: 4.4 },
  de_mirage:   { posX: -3230, posY: 1713, scale: 5.0 },
  de_inferno:  { posX: -2087, posY: 3870, scale: 4.9 },
  de_nuke:     { posX: -3453, posY: 2887, scale: 7.0 },
  de_overpass: { posX: -4831, posY: 1781, scale: 5.2 },
  de_ancient:  { posX: -2953, posY: 2164, scale: 5.0 },
  de_anubis:   { posX: -2796, posY: 3328, scale: 5.22 },
  de_vertigo:  { posX: -3168, posY: 1762, scale: 4.0 },
  de_cache:    { posX: -2000, posY: 3250, scale: 5.5 },
  de_train:    { posX: -2450, posY: 2923, scale: 4.9 },
};

function getVerdict(d: TauriDeathEvent, t: (key: string) => string): { text: string; color: string } {
  if (!d.hasPosData) return { text: t("stats.verdictNone"), color: "text-white/40" };

  if (d.playerIsKiller) {
    // Kill event — assess the player's aim from killer perspective
    if (!d.wasEnemyInFov) return { text: t("stats.verdictOutsideFov"), color: "text-orange-400" };
    if (d.crosshairErrorDeg < 10) return { text: t("stats.verdictGoodAim"), color: "text-green-400" };
    if (d.crosshairErrorDeg < 30) return { text: t("stats.verdictGoodAim"), color: "text-blue-400" };
    return { text: t("stats.verdictNone"), color: "text-white/40" };
  }

  // Death event
  if (!d.wasEnemyInFov) return { text: t("stats.verdictOutsideFov"), color: "text-red-400" };
  if (d.shotBeforeStop) return { text: t("stats.verdictStillMoving"), color: "text-yellow-400" };
  if (d.crosshairErrorDeg > 45) return { text: t("stats.verdictCrosshairFar"), color: "text-orange-400" };
  if (d.crosshairErrorDeg < 15) return { text: t("stats.verdictGoodAim"), color: "text-blue-400" };
  return { text: t("stats.verdictNone"), color: "text-white/40" };
}

/**
 * Top-down fight diagram with optional CS2 map radar background and FOV cone.
 *
 * Coordinate convention:
 *  - CS2 yaw=0 → east (+X world) → SVG right (+svgX)
 *  - CS2 yaw=90 → north (+Y world) → SVG up (-svgY)  [Y is inverted in SVG]
 *  - So: svgDX = cos(yaw_rad), svgDY = -sin(yaw_rad)
 *        svgAngle = -yaw_deg  (for SVG-angle functions where 0=right, 90=down)
 */
function MapDiagram({ death }: { death: TauriDeathEvent }) {
  const [imgLoaded, setImgLoaded] = useState(true);

  if (!death.hasPosData) return null;

  const isKill = death.playerIsKiller;

  // "player" = the tracked player. "enemy" = the opponent.
  const playerPos = isKill ? death.killerPos : death.victimPos;
  const enemyPos  = isKill ? death.victimPos : death.killerPos;
  const playerYaw = isKill ? death.killerEyeYaw : death.victimEyeYaw;
  const playerColor = isKill ? "#22c55e" : "#3b82f6";
  const playerColorFov = isKill ? "rgba(34,197,94,0.18)" : "rgba(59,130,246,0.18)";
  const playerColorFovStroke = isKill ? "rgba(34,197,94,0.45)" : "rgba(59,130,246,0.45)";

  const SIZE = 260;

  // World space midpoint between the two positions
  const wcx = (playerPos[0] + enemyPos[0]) / 2;
  const wcy = (playerPos[1] + enemyPos[1]) / 2;

  const dist = Math.sqrt(
    (playerPos[0] - enemyPos[0]) ** 2 + (playerPos[1] - enemyPos[1]) ** 2
  );

  // Show a region ≥ 300 and ≤ 3000 world units across, with 25% padding around the fight
  const halfExtentWorld = Math.max(200, Math.min(1800, dist * 0.75));
  const svgPerWorld = SIZE / (2 * halfExtentWorld);

  function worldToSVG(wx: number, wy: number): [number, number] {
    return [
      (wx - wcx) * svgPerWorld + SIZE / 2,
      -(wy - wcy) * svgPerWorld + SIZE / 2,
    ];
  }

  const [px, py] = worldToSVG(playerPos[0], playerPos[1]);
  const [ex, ey] = worldToSVG(enemyPos[0], enemyPos[1]);

  // FOV cone: 90° total (45° half-angle)
  const coneLen = Math.min(80, dist * svgPerWorld * 0.7);
  const fovHalf = 45 * (Math.PI / 180);
  const yawRad = playerYaw * (Math.PI / 180);
  // SVG angle = -yaw  (Y-axis inverted)
  const svgBaseAngle = -yawRad;
  const la = svgBaseAngle - fovHalf;
  const ra = svgBaseAngle + fovHalf;
  const lx = px + Math.cos(la) * coneLen;
  const ly = py + Math.sin(la) * coneLen;
  const rx = px + Math.cos(ra) * coneLen;
  const ry = py + Math.sin(ra) * coneLen;

  // Map radar image (1024×1024 covering the whole map)
  const mapMeta = death.mapName ? MAP_META[death.mapName] : undefined;
  let imageX = 0, imageY = 0, imageSize = 0;
  let hasMapImage = false;
  if (mapMeta && imgLoaded && death.mapName) {
    // Radar-pixel coordinates of world midpoint
    const mrx = (wcx - mapMeta.posX) / mapMeta.scale;
    const mry = (mapMeta.posY - wcy) / mapMeta.scale;
    // SVG pixels per radar pixel
    const svgPerRadar = svgPerWorld * mapMeta.scale;
    imageSize = 1024 * svgPerRadar;
    imageX = SIZE / 2 - mrx * svgPerRadar;
    imageY = SIZE / 2 - mry * svgPerRadar;
    hasMapImage = true;
  }

  const radarUrl = death.mapName
    ? `https://unpkg.com/csgo-overviews/maps/${death.mapName}_radar.png`
    : null;

  // Truncate enemy name for label
  const enemyLabel = isKill
    ? (death.victimName || "enemy").slice(0, 12)
    : (death.killerName || "enemy").slice(0, 12);

  return (
    <div className="flex flex-col items-center gap-1.5">
      {death.mapName && (
        <p className="text-[9px] uppercase tracking-widest text-white/25 font-mono">
          {death.mapName}
        </p>
      )}
      <svg
        width={SIZE} height={SIZE}
        className="rounded-xl border border-white/8 overflow-hidden"
        style={{ background: "#060b10" }}
      >
        <defs>
          <pattern id="mapgrid" width="26" height="26" patternUnits="userSpaceOnUse">
            <path d="M 26 0 L 0 0 0 26" fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="1" />
          </pattern>
          <clipPath id="svgClip">
            <rect width={SIZE} height={SIZE} />
          </clipPath>
        </defs>

        {/* Grid fallback background */}
        <rect width={SIZE} height={SIZE} fill="url(#mapgrid)" />

        {/* Map radar image */}
        {radarUrl && hasMapImage && (
          <image
            href={radarUrl}
            x={imageX} y={imageY}
            width={imageSize} height={imageSize}
            preserveAspectRatio="none"
            opacity={0.5}
            clipPath="url(#svgClip)"
            onError={() => setImgLoaded(false)}
          />
        )}

        {/* FOV cone from player position */}
        <polygon
          points={`${px},${py} ${lx},${ly} ${rx},${ry}`}
          fill={playerColorFov}
          stroke={playerColorFovStroke}
          strokeWidth="1"
          strokeLinejoin="round"
        />

        {/* Dashed line between the two positions */}
        <line
          x1={px} y1={py} x2={ex} y2={ey}
          stroke="rgba(255,255,255,0.10)"
          strokeWidth="1"
          strokeDasharray="5 4"
        />

        {/* Enemy dot */}
        <circle cx={ex} cy={ey} r={5.5} fill="#ef4444" />
        <text
          x={ex} y={ey - 10}
          textAnchor="middle"
          fill="rgba(255,100,100,0.85)"
          fontSize={9}
          fontWeight="bold"
          style={{ fontFamily: "monospace" }}
        >
          {enemyLabel}
        </text>

        {/* Player dot */}
        <circle cx={px} cy={py} r={6.5} fill={playerColor} />
        <text
          x={px} y={py + 17}
          textAnchor="middle"
          fill={isKill ? "rgba(34,197,94,0.85)" : "rgba(80,140,255,0.85)"}
          fontSize={9}
          fontWeight="bold"
          style={{ fontFamily: "monospace" }}
        >
          YOU
        </text>

        {/* Distance label bottom-right */}
        <text
          x={SIZE - 6} y={SIZE - 6}
          textAnchor="end"
          fill="rgba(255,255,255,0.20)"
          fontSize={8.5}
          style={{ fontFamily: "monospace" }}
        >
          {Math.round(dist)} u
        </text>
      </svg>
    </div>
  );
}

function MetricBadge({
  label, value, color, icon,
}: {
  label: string; value: string; color: string; icon: React.ReactNode;
}) {
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
  const isKill = death.playerIsKiller;

  const crosshairColor = !death.hasPosData ? "text-white/20"
    : death.crosshairErrorDeg < 15 ? "text-green-400"
    : death.crosshairErrorDeg < 45 ? "text-yellow-400"
    : "text-red-400";

  // For deaths: victim speed tells if they were moving before dying.
  // For kills: same field = how fast the victim (enemy) was moving.
  const speedColor = death.victimSpeed < 10 ? "text-green-400"
    : death.victimSpeed < 60 ? "text-yellow-400"
    : "text-red-400";

  const headerBg = isKill
    ? "bg-emerald-950/30 border-emerald-500/10"
    : "bg-red-950/20 border-red-500/8";

  return (
    <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
      {/* Card header */}
      <div className={cn("flex items-center gap-2.5 px-4 py-3 border-b border-white/6", headerBg)}>
        <span className="shrink-0 w-7 h-7 rounded-lg bg-white/8 flex items-center justify-center text-[11px] font-bold text-white/50">
          {death.round}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {isKill ? (
              <>
                <Target className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="text-emerald-300/90 text-sm font-medium truncate">{death.victimName}</span>
              </>
            ) : (
              <>
                <Skull className="w-3 h-3 text-red-400 shrink-0" />
                <span className="text-white/80 text-sm font-medium truncate">{death.killerName}</span>
              </>
            )}
            {death.headshot && (
              <span className="shrink-0 px-1 py-0.5 rounded bg-red-500/20 text-red-400 text-[9px] font-bold uppercase">HS</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-white/30">
            <span className="font-mono">{death.weapon}</span>
            <span>·</span>
            <span>{formatTime(death.timeSeconds)}</span>
            {isKill ? (
              <span className="text-emerald-500/50">kill</span>
            ) : (
              <span className="text-red-500/50">death</span>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowDebug(v => !v)}
          className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono text-white/20 hover:text-white/50 hover:bg-white/8 transition-all border border-white/8"
          title="Toggle debug info"
        >
          [dbg]
        </button>
      </div>

      {/* Metrics */}
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
            label={isKill ? "enemy spd" : t("stats.speed")}
            value={death.hasPosData ? `${Math.round(death.victimSpeed)}` : "–"}
            color={death.hasPosData ? speedColor : "text-white/20"}
            icon={<Gauge className="w-2.5 h-2.5" />}
          />
          <MetricBadge
            label={isKill ? "moving" : t("stats.shotBeforeStop")}
            value={!death.hasPosData ? "–" : death.shotBeforeStop ? t("stats.yes") : t("stats.no")}
            color={!death.hasPosData ? "text-white/20"
              : isKill
                ? (death.shotBeforeStop ? "text-yellow-400" : "text-white/40")
                : (death.shotBeforeStop ? "text-red-400" : "text-green-400")}
            icon={<Footprints className="w-2.5 h-2.5" />}
          />
        </div>

        {death.hasPosData && <MapDiagram death={death} />}

        {showDebug && (
          <div className="px-2.5 py-2 rounded-lg bg-black/40 border border-white/6 overflow-x-auto">
            <p className="text-[9px] font-mono text-white/40 whitespace-pre break-all leading-relaxed">
              {death.debugInfo || "(no debugInfo)"}
            </p>
          </div>
        )}

        <div className={cn(
          "flex items-start gap-2 px-3 py-2 rounded-lg bg-white/3 border border-white/6",
          verdict.color
        )}>
          {isKill
            ? <Target className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            : <Skull className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          }
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
      `[${i + 1}] R${d.round} ${d.playerIsKiller ? "KILL" : "DEATH"} ${d.killerName}→${d.victimName} ${d.weapon}${d.headshot ? " HS" : ""} | ${d.debugInfo}`
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

  const killCount = deaths ? deaths.filter(d => d.playerIsKiller).length : 0;
  const deathCount = deaths ? deaths.filter(d => !d.playerIsKiller).length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl border border-white/10 bg-[#0d1117] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 shrink-0">
          <div className="flex items-center gap-2.5">
            {showDeaths ? (
              <button
                onClick={handleBack}
                className="p-1 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/8 transition-all mr-1"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
            ) : (
              <Skull className="w-4 h-4 text-orange-400" />
            )}
            <div>
              <p className="text-white font-semibold text-sm">
                {showPlayerPicker ? t("stats.selectPlayer") : t("stats.title")}
              </p>
              <p className="text-white/35 text-xs font-mono truncate max-w-[260px]">
                {showDeaths && deaths && deaths.length > 0
                  ? `${deathCount} deaths · ${killCount} kills · ${selectedPlayer}`
                  : (selectedPlayer ?? demoName)
                }
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/8 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-white/40">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm">{t("demo.statsLoading")}</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-red-400/70">
            <Skull className="w-8 h-8 mb-3 opacity-50" />
            <p className="text-sm">{t("demo.statsError")}</p>
            <p className="text-xs mt-1 text-white/20 max-w-xs text-center break-all">{error}</p>
          </div>
        )}

        {/* Player picker */}
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

            {/* Probe button — diagnostic tool */}
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
                    className="absolute top-2 right-10 text-[8px] font-mono text-white/30 hover:text-white/60 hover:bg-white/8 px-1.5 py-0.5 rounded border border-white/8 transition-all"
                  >
                    copy
                  </button>
                  <button
                    onClick={() => setProbeResult(null)}
                    className="absolute top-2 right-2 text-[8px] font-mono text-white/30 hover:text-white/60 hover:bg-white/8 px-1.5 py-0.5 rounded border border-white/8 transition-all"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {showDeaths && deaths.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-white/30">
            <Skull className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">{t("stats.noDeaths")}</p>
            <p className="text-xs mt-1 text-white/20">{t("stats.noDeathsHint")}</p>
          </div>
        )}

        {/* Events list */}
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

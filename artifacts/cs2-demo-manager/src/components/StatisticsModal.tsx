import { useState, useMemo } from "react";
import { X, Skull, Crosshair, Zap, AlertTriangle, BarChart2, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TauriDeathEvent } from "../services/tauriBridge";
import { cn } from "@/lib/utils";

interface StatisticsModalProps {
  demoName: string;
  deaths: TauriDeathEvent[];
  onClose: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function weaponIcon(weapon: string): string {
  const pistols = ["glock", "usp_silencer", "p250", "deagle", "cz75a", "fiveseven", "tec9", "revolver", "dual"];
  const rifles = ["ak47", "m4a1", "m4a1_silencer", "sg556", "aug", "famas", "galil", "ssg08", "awp", "g3sg1", "scar20"];
  const smgs = ["mp9", "mac10", "mp7", "mp5sd", "ump45", "bizon", "p90"];
  const heavy = ["nova", "xm1014", "mag7", "sawedoff", "m249", "negev"];
  const w = weapon.toLowerCase();
  if (pistols.some(p => w.includes(p))) return "🔫";
  if (rifles.some(r => w.includes(r))) return "🎯";
  if (smgs.some(s => w.includes(s))) return "⚡";
  if (heavy.some(h => w.includes(h))) return "💣";
  if (w === "knife" || w.includes("knife") || w.includes("bayonet")) return "🔪";
  if (w === "he_grenade" || w === "hegrenade") return "💥";
  return "⚔️";
}

function CrosshairMeter({ deg, hasPosData }: { deg: number; hasPosData: boolean }) {
  if (!hasPosData) return <span className="text-white/20 text-[10px]">–</span>;
  const clamped = Math.min(deg, 180);
  const color = deg < 15 ? "text-green-400" : deg < 45 ? "text-yellow-400" : "text-red-400";
  return (
    <span className={cn("font-mono text-xs font-bold", color)}>
      {deg.toFixed(1)}°
    </span>
  );
}

function MapView2D({ deaths }: { deaths: TauriDeathEvent[] }) {
  const withPos = deaths.filter(d => d.hasPosData);
  if (withPos.length === 0) return null;

  const allX = withPos.flatMap(d => [d.victimPos[0], d.killerPos[0]]);
  const allY = withPos.flatMap(d => [d.victimPos[1], d.killerPos[1]]);
  const minX = Math.min(...allX), maxX = Math.max(...allX);
  const minY = Math.min(...allY), maxY = Math.max(...allY);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const pad = 16;
  const W = 240, H = 240;

  const toSvg = (x: number, y: number) => ({
    cx: pad + ((x - minX) / rangeX) * (W - 2 * pad),
    cy: pad + (1 - (y - minY) / rangeY) * (H - 2 * pad),
  });

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div className="mt-4">
      <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2 flex items-center gap-1">
        <MapPin className="w-3 h-3" /> Position Map
      </p>
      <div className="flex justify-center">
        <svg
          width={W}
          height={H}
          className="rounded-lg bg-black/40 border border-white/8"
          style={{ maxWidth: "100%" }}
        >
          {withPos.map((d, i) => {
            const v = toSvg(d.victimPos[0], d.victimPos[1]);
            const k = toSvg(d.killerPos[0], d.killerPos[1]);
            const isHovered = hoveredIdx === i;
            return (
              <g key={i} onMouseEnter={() => setHoveredIdx(i)} onMouseLeave={() => setHoveredIdx(null)}>
                {/* Line from killer to victim */}
                <line
                  x1={k.cx} y1={k.cy} x2={v.cx} y2={v.cy}
                  stroke={isHovered ? "rgba(249,115,22,0.5)" : "rgba(255,255,255,0.08)"}
                  strokeWidth={isHovered ? 1.5 : 1}
                />
                {/* Killer dot (orange) */}
                <circle cx={k.cx} cy={k.cy} r={isHovered ? 4 : 3} fill="#f97316" opacity={isHovered ? 0.9 : 0.5} />
                {/* Victim dot (red) */}
                <circle cx={v.cx} cy={v.cy} r={isHovered ? 5 : 3.5} fill={d.headshot ? "#ef4444" : "#dc2626"} opacity={isHovered ? 1 : 0.7} />
                {isHovered && (
                  <text x={v.cx + 6} y={v.cy - 4} fill="white" fontSize={8} opacity={0.8}>
                    R{d.round} {d.killerName}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-white/30">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Victim</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" /> Killer</span>
      </div>
    </div>
  );
}

export function StatisticsModal({ demoName, deaths, onClose }: StatisticsModalProps) {
  const { t } = useTranslation();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [showMap, setShowMap] = useState(false);

  const selected = selectedIdx !== null ? deaths[selectedIdx] : null;

  const stats = useMemo(() => {
    if (deaths.length === 0) return null;
    const withPos = deaths.filter(d => d.hasPosData);
    const headshots = deaths.filter(d => d.headshot).length;
    const avgCrosshair = withPos.length > 0
      ? withPos.reduce((s, d) => s + d.crosshairErrorDeg, 0) / withPos.length
      : null;
    const avgSpeed = withPos.length > 0
      ? withPos.reduce((s, d) => s + d.victimSpeed, 0) / withPos.length
      : null;
    const worstKiller = deaths.reduce<Record<string, number>>((acc, d) => {
      acc[d.killerName] = (acc[d.killerName] ?? 0) + 1;
      return acc;
    }, {});
    const topKiller = Object.entries(worstKiller).sort((a, b) => b[1] - a[1])[0];
    return { headshots, avgCrosshair, avgSpeed, topKiller };
  }, [deaths]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl border border-white/10 bg-[#0d1117] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 shrink-0">
          <div className="flex items-center gap-2.5">
            <Skull className="w-4 h-4 text-orange-400" />
            <div>
              <p className="text-white font-semibold text-sm">{t("stats.title")}</p>
              <p className="text-white/35 text-xs font-mono truncate max-w-[260px]">{demoName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/8 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Empty state */}
        {deaths.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-white/30">
            <Skull className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">{t("stats.noDeaths")}</p>
            <p className="text-xs mt-1 text-white/20">{t("stats.noDeathsHint")}</p>
          </div>
        )}

        {deaths.length > 0 && (
          <div className="flex-1 overflow-y-auto">

            {/* Summary stats */}
            {stats && (
              <div className="grid grid-cols-2 gap-3 p-4 border-b border-white/6">
                <div className="bg-white/3 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Skull className="w-3 h-3 text-red-400" />
                    <span className="text-white/40 text-[10px] uppercase tracking-wider">{t("stats.deaths")}</span>
                  </div>
                  <p className="text-white font-bold text-xl">{deaths.length}</p>
                </div>
                <div className="bg-white/3 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Crosshair className="w-3 h-3 text-orange-400" />
                    <span className="text-white/40 text-[10px] uppercase tracking-wider">{t("stats.headshots")}</span>
                  </div>
                  <p className="text-white font-bold text-xl">{stats.headshots}<span className="text-white/30 text-sm font-normal ml-1">/ {deaths.length}</span></p>
                </div>
                {stats.avgCrosshair !== null && (
                  <div className="bg-white/3 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <AlertTriangle className="w-3 h-3 text-yellow-400" />
                      <span className="text-white/40 text-[10px] uppercase tracking-wider">{t("stats.avgCrosshair")}</span>
                    </div>
                    <p className={cn("font-bold text-xl", stats.avgCrosshair < 20 ? "text-green-400" : stats.avgCrosshair < 45 ? "text-yellow-400" : "text-red-400")}>
                      {stats.avgCrosshair.toFixed(1)}°
                    </p>
                  </div>
                )}
                {stats.avgSpeed !== null && (
                  <div className="bg-white/3 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Zap className="w-3 h-3 text-blue-400" />
                      <span className="text-white/40 text-[10px] uppercase tracking-wider">{t("stats.avgSpeed")}</span>
                    </div>
                    <p className="text-white font-bold text-xl">{Math.round(stats.avgSpeed)}<span className="text-white/30 text-sm font-normal ml-1">u/s</span></p>
                  </div>
                )}
                {stats.topKiller && (
                  <div className="col-span-2 bg-white/3 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <BarChart2 className="w-3 h-3 text-purple-400" />
                      <span className="text-white/40 text-[10px] uppercase tracking-wider">{t("stats.topKiller")}</span>
                    </div>
                    <p className="text-white font-semibold text-sm truncate">
                      {stats.topKiller[0]}
                      <span className="text-white/30 text-xs font-normal ml-1.5">{stats.topKiller[1]}x</span>
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Map toggle */}
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <p className="text-white/40 text-[10px] uppercase tracking-wider">{t("stats.deathList")}</p>
              {deaths.some(d => d.hasPosData) && (
                <button
                  onClick={() => setShowMap(v => !v)}
                  className={cn(
                    "flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border transition-all",
                    showMap
                      ? "border-orange-500/40 bg-orange-500/10 text-orange-300"
                      : "border-white/8 text-white/30 hover:text-white/50"
                  )}
                >
                  <MapPin className="w-3 h-3" />
                  {t("stats.mapView")}
                </button>
              )}
            </div>

            {/* 2D Map view */}
            {showMap && <div className="px-4"><MapView2D deaths={deaths} /></div>}

            {/* Death list */}
            <div className="px-4 pb-4 mt-1 space-y-1">
              {deaths.map((d, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedIdx(selectedIdx === i ? null : i)}
                  className={cn(
                    "w-full text-left rounded-xl border px-3 py-2.5 transition-all",
                    selectedIdx === i
                      ? "border-orange-500/30 bg-orange-500/8"
                      : "border-white/6 bg-white/2 hover:bg-white/4 hover:border-white/10"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    {/* Round badge */}
                    <span className="shrink-0 w-6 h-6 rounded-lg bg-white/8 flex items-center justify-center text-[10px] font-bold text-white/50">
                      {d.round}
                    </span>

                    {/* Weapon + killer */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base leading-none">{weaponIcon(d.weapon)}</span>
                        <span className="text-white/80 text-xs font-medium truncate">{d.killerName}</span>
                        {d.headshot && (
                          <span className="shrink-0 px-1 py-0.5 rounded bg-red-500/20 text-red-400 text-[9px] font-bold uppercase">HS</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-white/30">
                        <span className="font-mono">{d.weapon}</span>
                        <span>·</span>
                        <span>{formatTime(d.timeSeconds)}</span>
                      </div>
                    </div>

                    {/* Crosshair error */}
                    <div className="shrink-0 text-right">
                      <CrosshairMeter deg={d.crosshairErrorDeg} hasPosData={d.hasPosData} />
                      {d.hasPosData && (
                        <p className={cn("text-[9px] mt-0.5", d.wasEnemyInFov ? "text-green-400/60" : "text-white/20")}>
                          {d.wasEnemyInFov ? "In FOV" : "Off FOV"}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {selectedIdx === i && (
                    <div className="mt-3 pt-2.5 border-t border-white/8 grid grid-cols-3 gap-2">
                      <div>
                        <p className="text-white/30 text-[9px] uppercase tracking-wider mb-0.5">Round</p>
                        <p className="text-white text-xs font-semibold">{d.round}</p>
                      </div>
                      <div>
                        <p className="text-white/30 text-[9px] uppercase tracking-wider mb-0.5">Time</p>
                        <p className="text-white text-xs font-mono">{formatTime(d.timeSeconds)}</p>
                      </div>
                      <div>
                        <p className="text-white/30 text-[9px] uppercase tracking-wider mb-0.5">Tick</p>
                        <p className="text-white/50 text-[10px] font-mono">{d.tick}</p>
                      </div>

                      {d.hasPosData && (
                        <>
                          <div>
                            <p className="text-white/30 text-[9px] uppercase tracking-wider mb-0.5">Speed</p>
                            <p className={cn("text-xs font-semibold", d.shotBeforeStop ? "text-yellow-400" : "text-green-400")}>
                              {Math.round(d.victimSpeed)}<span className="text-white/30 font-normal text-[9px] ml-0.5">u/s</span>
                            </p>
                          </div>
                          <div>
                            <p className="text-white/30 text-[9px] uppercase tracking-wider mb-0.5">Crosshair Δ</p>
                            <CrosshairMeter deg={d.crosshairErrorDeg} hasPosData={d.hasPosData} />
                          </div>
                          <div>
                            <p className="text-white/30 text-[9px] uppercase tracking-wider mb-0.5">Eye Angles</p>
                            <p className="text-white/40 text-[10px] font-mono">
                              {d.victimEyeYaw.toFixed(0)}° / {d.victimEyePitch.toFixed(0)}°
                            </p>
                          </div>
                          <div className="col-span-3">
                            <p className="text-white/30 text-[9px] uppercase tracking-wider mb-0.5">Victim pos</p>
                            <p className="text-white/35 text-[10px] font-mono">
                              X:{d.victimPos[0].toFixed(0)} Y:{d.victimPos[1].toFixed(0)} Z:{d.victimPos[2].toFixed(0)}
                            </p>
                          </div>
                        </>
                      )}

                      {!d.hasPosData && (
                        <div className="col-span-3">
                          <p className="text-white/20 text-[10px] italic">{t("stats.noPosData")}</p>
                        </div>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>

          </div>
        )}

      </div>
    </div>
  );
}

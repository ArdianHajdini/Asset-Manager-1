import { useState } from "react";
import {
  X, Skull, Crosshair, Eye, Gauge, Footprints,
  Users, Loader2, Target, ChevronDown,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TauriDeathEvent, TauriDemoPlayer, MapRadarInfo } from "../services/tauriBridge";
import {
  tauriParseDemoDeaths,
  tauriGetMapRadarInfo,
  tauriProbePawnProperties,
  isTauri,
} from "../services/tauriBridge";
import { useApp } from "../context/AppContext";
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

/**
 * Rule-based per-fight analysis text.
 * Returns a short sentence summarising what happened, focused on the selected player.
 */
function getExplanation(d: TauriDeathEvent): { text: string; color: string } {
  if (!d.hasPosData) {
    return { text: "No position data recorded for this event.", color: "text-white/35" };
  }

  const isKill = d.playerIsKiller;
  const parts: string[] = [];

  if (!d.wasEnemyInFov) {
    parts.push(
      isKill
        ? "Enemy was outside your FOV — lucky flick or sound cue."
        : "Enemy was outside your FOV — you were caught off-guard from a blind angle."
    );
  } else {
    if (d.crosshairErrorDeg < 5) {
      parts.push("Perfect crosshair placement on the enemy.");
    } else if (d.crosshairErrorDeg < 15) {
      parts.push(isKill ? "Good crosshair placement." : "Crosshair was close — small aim advantage to the enemy.");
    } else if (d.crosshairErrorDeg < 35) {
      parts.push(
        isKill
          ? "Crosshair was slightly off — still connected."
          : "Crosshair was off-target, giving the enemy the aim advantage."
      );
    } else {
      parts.push(
        isKill
          ? "Wide crosshair — great flick or they walked into it."
          : "Crosshair was far from enemy — you were exposed to a bad angle."
      );
    }
  }

  if (d.shotBeforeStop) {
    parts.push(isKill ? "Enemy was moving when shot." : "You were still moving when shot — affected your accuracy.");
  } else {
    parts.push(isKill ? "Enemy was stationary." : "You were stationary — good positioning discipline.");
  }

  // Extra context from enriched event data
  if (d.penetratedObjects > 0) {
    parts.push(isKill ? `Wallbang through ${d.penetratedObjects} surface(s).` : `You were wallbanged through ${d.penetratedObjects} surface(s).`);
  }
  if (d.isTradeKill) {
    parts.push(isKill ? "This was a trade kill — your teammate was avenged." : "Trade death — your kill was quickly traded.");
  }
  if (!isKill && d.isVictimBlinded) {
    parts.push("You were flashed when you died.");
  }
  if (isKill && d.isKillerBlinded) {
    parts.push("You made this kill while flashed.");
  }
  if (!isKill && d.isVictimAirborne) {
    parts.push("You were airborne — hard to control and easy to hit.");
  }
  if (isKill && d.isKillerAirborne) {
    parts.push("You made this kill while airborne.");
  }
  if (d.assisterName) {
    parts.push(`Assist by ${d.assisterName}.`);
  }

  const color =
    !d.wasEnemyInFov
      ? isKill ? "text-orange-300" : "text-red-400"
      : d.crosshairErrorDeg < 15
        ? "text-green-400"
        : d.crosshairErrorDeg < 35
          ? "text-yellow-400"
          : "text-orange-400";

  return { text: parts.join(" "), color };
}

// ─────────────────────────────────────────
//  Map diagram — real radar or relative fallback
// ─────────────────────────────────────────

function MapDiagram({
  event,
  radarUrl,
  radarInfo,
  lowerRadarUrl,
}: {
  event: TauriDeathEvent;
  radarUrl: string | null;
  radarInfo: MapRadarInfo | null;
  lowerRadarUrl?: string | null;
}) {
  if (!event.hasPosData) return null;

  const isKill = event.playerIsKiller;
  const playerPos = isKill ? event.killerPos : event.victimPos;
  const enemyPos  = isKill ? event.victimPos : event.killerPos;
  const playerYaw = isKill ? event.killerEyeYaw : event.victimEyeYaw;
  const playerColor = isKill ? "#22c55e" : "#3b82f6";
  const fovFill   = isKill ? "rgba(34,197,94,0.15)"  : "rgba(59,130,246,0.15)";
  const fovStroke = isKill ? "rgba(34,197,94,0.55)"  : "rgba(59,130,246,0.55)";
  const enemyLabel = (isKill ? event.victimName : event.killerName || "enemy").slice(0, 11);
  const worldDist = Math.sqrt(
    (playerPos[0] - enemyPos[0]) ** 2 + (playerPos[1] - enemyPos[1]) ** 2
  );

  const SIZE = 280;

  const yawRad    = playerYaw * (Math.PI / 180);
  const svgAngle  = -yawRad;
  const fovHalf   = 45 * (Math.PI / 180);

  // ── Real radar image path ──────────────────────────────────────
  if (radarUrl && radarInfo) {
    // Radar level is always determined by the victim's position (the death/fight location),
    // regardless of which player we're tracking, to correctly represent where the kill happened.
    const fightZ = event.victimPos[2];
    const useUpper =
      !radarInfo.thresholdZ ||
      fightZ >= radarInfo.thresholdZ ||
      !lowerRadarUrl ||
      !radarInfo.lowerPosX;

    const activeRadarUrl = useUpper ? radarUrl : (lowerRadarUrl ?? radarUrl);
    const activePosX  = useUpper ? radarInfo.posX  : (radarInfo.lowerPosX  ?? radarInfo.posX);
    const activePosY  = useUpper ? radarInfo.posY  : (radarInfo.lowerPosY  ?? radarInfo.posY);
    const activeScale = useUpper ? radarInfo.scale : (radarInfo.lowerScale ?? radarInfo.scale);
    const activeRadarSize = useUpper
      ? (radarInfo.radarSize ?? 1024)
      : (radarInfo.lowerRadarSize ?? radarInfo.radarSize ?? 1024);
    const levelLabel = !useUpper ? " — lower" : "";

    // Corrected cs-demo-manager formula: scaledX = (worldX − posX) / scale × (SIZE / radarSize)
    const rx = (p: number[]) => (p[0] - activePosX) / activeScale * (SIZE / activeRadarSize);
    const ry = (p: number[]) => (activePosY - p[1]) / activeScale * (SIZE / activeRadarSize);

    const px = rx(playerPos);
    const py = ry(playerPos);
    const ex = rx(enemyPos);
    const ey = ry(enemyPos);

    // Assister position (if present)
    const hasAssister = !!event.assisterName && (event.assisterPos[0] !== 0 || event.assisterPos[1] !== 0);
    const ax = hasAssister ? rx(event.assisterPos) : 0;
    const ay = hasAssister ? ry(event.assisterPos) : 0;
    const assisterLabel = event.assisterName.slice(0, 9);

    const svgDist = Math.sqrt((px - ex) ** 2 + (py - ey) ** 2);
    const coneLen = Math.max(18, Math.min(55, svgDist * 0.7));
    const lookLen = coneLen * 1.35;

    const lx = px + Math.cos(svgAngle - fovHalf) * coneLen;
    const ly = py + Math.sin(svgAngle - fovHalf) * coneLen;
    const rx2 = px + Math.cos(svgAngle + fovHalf) * coneLen;
    const ry2 = py + Math.sin(svgAngle + fovHalf) * coneLen;
    const lookX = px + Math.cos(svgAngle) * lookLen;
    const lookY = py + Math.sin(svgAngle) * lookLen;

    return (
      <div className="flex flex-col items-center gap-1.5">
        {event.mapName && (
          <p className="text-[9px] uppercase tracking-widest text-white/25 font-mono">
            {event.mapName}{levelLabel}
          </p>
        )}
        <svg
          width={SIZE} height={SIZE}
          className="rounded-xl border border-white/10 overflow-hidden"
        >
          <image href={activeRadarUrl} x={0} y={0} width={SIZE} height={SIZE} preserveAspectRatio="xMidYMid meet" />
          <rect x={0} y={0} width={SIZE} height={SIZE} fill="rgba(0,0,0,0.38)" />

          {/* Engagement line */}
          <line x1={px} y1={py} x2={ex} y2={ey}
            stroke="rgba(255,255,255,0.22)" strokeWidth="1" strokeDasharray="4 3" />

          {/* FOV cone */}
          <polygon points={`${px},${py} ${lx},${ly} ${rx2},${ry2}`}
            fill={fovFill} stroke={fovStroke} strokeWidth="1" strokeLinejoin="round" />
          <line x1={px} y1={py} x2={lookX} y2={lookY}
            stroke={fovStroke} strokeWidth="1.5" />

          {/* Enemy */}
          <circle cx={ex} cy={ey} r={7.5} fill="none" stroke="rgba(239,68,68,0.45)" strokeWidth="1.5" />
          <circle cx={ex} cy={ey} r={4}   fill="#ef4444" />
          <text x={ex} y={ey - 11} textAnchor="middle"
            fill="rgba(255,130,130,1)" fontSize={9} fontWeight="bold"
            style={{ fontFamily: "monospace", filter: "drop-shadow(0 1px 2px #000)" }}>
            {enemyLabel}
          </text>

          {/* Assister (purple dot, rendered when assister position is available) */}
          {hasAssister && (
            <>
              <line x1={ax} y1={ay} x2={ex} y2={ey}
                stroke="rgba(168,85,247,0.35)" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={ax} cy={ay} r={6} fill="none" stroke="rgba(168,85,247,0.50)" strokeWidth="1.5" />
              <circle cx={ax} cy={ay} r={3} fill="#a855f7" />
              <text x={ax} y={ay - 9} textAnchor="middle"
                fill="rgba(200,150,255,1)" fontSize={8} fontWeight="bold"
                style={{ fontFamily: "monospace", filter: "drop-shadow(0 1px 2px #000)" }}>
                {assisterLabel}
              </text>
            </>
          )}

          {/* Player */}
          <circle cx={px} cy={py} r={9} fill="none"
            stroke={isKill ? "rgba(34,197,94,0.45)" : "rgba(59,130,246,0.45)"} strokeWidth="1.5" />
          <circle cx={px} cy={py} r={4.5} fill={playerColor} />
          <text x={px} y={py + 17} textAnchor="middle"
            fill={isKill ? "rgba(34,197,94,1)" : "rgba(100,160,255,1)"}
            fontSize={9} fontWeight="bold"
            style={{ fontFamily: "monospace", filter: "drop-shadow(0 1px 2px #000)" }}>
            YOU
          </text>

          {/* Distance */}
          <text x={SIZE - 5} y={13} textAnchor="end"
            fill="rgba(255,255,255,0.55)" fontSize={8.5}
            style={{ fontFamily: "monospace" }}>
            {Math.round(worldDist)} u
          </text>
        </svg>
      </div>
    );
  }

  // ── Fallback: relative diagram (no radar available) ───────────
  const HALF = SIZE / 2;
  const wcx = (playerPos[0] + enemyPos[0]) / 2;
  const wcy = (playerPos[1] + enemyPos[1]) / 2;
  const halfExtent = Math.max(200, Math.min(1800, worldDist * 0.75));
  const svgPerWorld = SIZE / (2 * halfExtent);

  function w2s(wx: number, wy: number): [number, number] {
    return [(wx - wcx) * svgPerWorld + HALF, -(wy - wcy) * svgPerWorld + HALF];
  }
  const [px, py] = w2s(playerPos[0], playerPos[1]);
  const [ex, ey] = w2s(enemyPos[0], enemyPos[1]);

  const coneLen = Math.min(72, worldDist * svgPerWorld * 0.65);
  const lx = px + Math.cos(svgAngle - fovHalf) * coneLen;
  const ly = py + Math.sin(svgAngle - fovHalf) * coneLen;
  const rx2 = px + Math.cos(svgAngle + fovHalf) * coneLen;
  const ry2 = py + Math.sin(svgAngle + fovHalf) * coneLen;
  const lookX = px + Math.cos(svgAngle) * coneLen * 1.3;
  const lookY = py + Math.sin(svgAngle) * coneLen * 1.3;

  return (
    <div className="flex flex-col items-center gap-1.5">
      {event.mapName && (
        <p className="text-[9px] uppercase tracking-widest text-white/25 font-mono">
          {event.mapName} — relative view
        </p>
      )}
      <svg
        width={SIZE} height={SIZE}
        className="rounded-xl border border-white/10 overflow-hidden"
        style={{ background: "#0a1214" }}
      >
        <line x1={HALF} y1={0} x2={HALF} y2={SIZE} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        <line x1={0} y1={HALF} x2={SIZE} y2={HALF} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />

        {/* FOV cone */}
        <polygon points={`${px},${py} ${lx},${ly} ${rx2},${ry2}`}
          fill={fovFill} stroke={fovStroke} strokeWidth="1" strokeLinejoin="round" />
        <line x1={px} y1={py} x2={lookX} y2={lookY} stroke={fovStroke} strokeWidth="1.5" />

        {/* Engagement line */}
        <line x1={px} y1={py} x2={ex} y2={ey}
          stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="5 4" />

        {/* Enemy */}
        <circle cx={ex} cy={ey} r={7}  fill="none" stroke="rgba(239,68,68,0.3)"  strokeWidth="1.5" />
        <circle cx={ex} cy={ey} r={4}  fill="#ef4444" />
        <text x={ex} y={ey - 10} textAnchor="middle"
          fill="rgba(255,100,100,0.9)" fontSize={9} fontWeight="bold"
          style={{ fontFamily: "monospace" }}>
          {enemyLabel}
        </text>

        {/* Player */}
        <circle cx={px} cy={py} r={8} fill="none"
          stroke={isKill ? "rgba(34,197,94,0.3)" : "rgba(59,130,246,0.3)"} strokeWidth="1.5" />
        <circle cx={px} cy={py} r={4.5} fill={playerColor} />
        <text x={px} y={py + 17} textAnchor="middle"
          fill={isKill ? "rgba(34,197,94,0.9)" : "rgba(80,140,255,0.9)"}
          fontSize={9} fontWeight="bold"
          style={{ fontFamily: "monospace" }}>
          YOU
        </text>

        {/* Distance */}
        <text x={SIZE - 5} y={13} textAnchor="end"
          fill="rgba(255,255,255,0.2)" fontSize={8.5}
          style={{ fontFamily: "monospace" }}>
          {Math.round(worldDist)} u
        </text>
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────
//  Metric badge
// ─────────────────────────────────────────

function MetricBadge({ label, value, color, icon }: {
  label: string; value: string; color: string; icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1 bg-white/3 rounded-lg px-2 py-2 min-w-0">
      <div className="flex items-center gap-1 text-white/35">
        {icon}
        <span className="text-[9px] uppercase tracking-wider truncate">{label}</span>
      </div>
      <span className={cn("text-xs font-bold", color)}>{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────
//  Per-event card (kill or death)
// ─────────────────────────────────────────

function EventCard({ event, radarUrl, radarInfo, lowerRadarUrl, t }: {
  event: TauriDeathEvent;
  radarUrl: string | null;
  radarInfo: MapRadarInfo | null;
  lowerRadarUrl?: string | null;
  t: (key: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isKill = event.playerIsKiller;
  const explanation = getExplanation(event);
  const opponentName = isKill ? event.victimName : event.killerName;

  const crosshairColor = !event.hasPosData ? "text-white/20"
    : event.crosshairErrorDeg < 10 ? "text-green-400"
    : event.crosshairErrorDeg < 25 ? "text-yellow-400"
    : "text-red-400";

  const speedVal = isKill ? event.killerSpeed : event.victimSpeed;
  const speedColor = speedVal < 10 ? "text-green-400"
    : speedVal < 60 ? "text-yellow-400"
    : "text-red-400";

  const headerBg = isKill
    ? "bg-emerald-950/30 border-emerald-500/10"
    : "bg-red-950/20 border-red-500/8";

  // Badge pills shown in the event header
  const badges: { label: string; cls: string }[] = [];
  if (event.headshot) badges.push({ label: "HS", cls: "bg-red-500/20 text-red-400" });
  if (event.penetratedObjects > 0) badges.push({ label: `🧱×${event.penetratedObjects}`, cls: "bg-orange-500/20 text-orange-400" });
  if (event.isTradeKill) badges.push({ label: "⚖️ Trade", cls: "bg-purple-500/20 text-purple-300" });
  if (isKill && event.isKillerAirborne) badges.push({ label: "✈️ Air", cls: "bg-sky-500/20 text-sky-300" });
  if (!isKill && event.isVictimAirborne) badges.push({ label: "✈️ Airborne", cls: "bg-sky-500/20 text-sky-300" });
  if (isKill && event.isKillerBlinded) badges.push({ label: "👁️ Blinded", cls: "bg-yellow-500/20 text-yellow-300" });
  if (!isKill && event.isVictimBlinded) badges.push({ label: "👁️ Flashed", cls: "bg-yellow-500/20 text-yellow-300" });

  return (
    <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
      {/* Header — click to expand/collapse radar */}
      <button
        onClick={() => setExpanded(v => !v)}
        className={cn(
          "w-full flex items-center gap-2.5 px-4 py-3 border-b border-white/6 text-left transition-all hover:bg-white/2",
          headerBg
        )}
      >
        <span className="shrink-0 w-7 h-7 rounded-lg bg-white/8 flex items-center justify-center text-[11px] font-bold text-white/50">
          R{event.round}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isKill
              ? <Target className="w-3 h-3 text-emerald-400 shrink-0" />
              : <Skull  className="w-3 h-3 text-red-400    shrink-0" />}
            <span className={cn(
              "text-sm font-medium truncate",
              isKill ? "text-emerald-300/90" : "text-white/80"
            )}>
              {opponentName}
            </span>
            {badges.map((b, i) => (
              <span key={i} className={cn("shrink-0 px-1 py-0.5 rounded text-[9px] font-bold uppercase", b.cls)}>{b.label}</span>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-white/30">
            <span className="font-mono">{event.weapon}</span>
            <span>·</span>
            <span>{formatTime(event.timeSeconds)}</span>
            <span className={isKill ? "text-emerald-500/60" : "text-red-500/60"}>
              {isKill ? "kill" : "death"}
            </span>
            {event.assisterName && (
              <>
                <span>·</span>
                <span className="text-violet-400/60">assist: {event.assisterName}</span>
              </>
            )}
          </div>
        </div>
        <ChevronDown className={cn(
          "w-3.5 h-3.5 text-white/20 transition-transform shrink-0",
          expanded && "rotate-180"
        )} />
      </button>

      {/* Metrics — always visible */}
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-4 gap-1.5">
          <MetricBadge
            label={t("stats.crosshairError")}
            value={event.hasPosData ? `${event.crosshairErrorDeg.toFixed(1)}°` : "–"}
            color={crosshairColor}
            icon={<Crosshair className="w-2.5 h-2.5" />}
          />
          <MetricBadge
            label={t("stats.fov")}
            value={!event.hasPosData ? "–" : event.wasEnemyInFov ? t("stats.yes") : t("stats.no")}
            color={!event.hasPosData ? "text-white/20" : event.wasEnemyInFov ? "text-green-400" : "text-red-400"}
            icon={<Eye className="w-2.5 h-2.5" />}
          />
          <MetricBadge
            label={isKill ? "my speed" : t("stats.speed")}
            value={event.hasPosData ? `${Math.round(speedVal)}` : "–"}
            color={event.hasPosData ? speedColor : "text-white/20"}
            icon={<Gauge className="w-2.5 h-2.5" />}
          />
          <MetricBadge
            label={isKill ? "moving" : t("stats.shotBeforeStop")}
            value={!event.hasPosData ? "–" : event.shotBeforeStop ? t("stats.yes") : t("stats.no")}
            color={!event.hasPosData ? "text-white/20"
              : isKill
                ? (event.shotBeforeStop ? "text-yellow-400" : "text-white/40")
                : (event.shotBeforeStop ? "text-red-400"   : "text-green-400")}
            icon={<Footprints className="w-2.5 h-2.5" />}
          />
        </div>

        {/* Rule-based explanation */}
        <div className={cn(
          "flex items-start gap-2 px-3 py-2 rounded-lg bg-white/3 border border-white/6",
          explanation.color
        )}>
          {isKill
            ? <Target className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            : <Skull  className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
          <p className="text-xs leading-snug">{explanation.text}</p>
        </div>

        {/* Radar map — shown when card is expanded */}
        {expanded && event.hasPosData && (
          <MapDiagram event={event} radarUrl={radarUrl} radarInfo={radarInfo} lowerRadarUrl={lowerRadarUrl} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
//  Per-demo summary statistics row
// ─────────────────────────────────────────

function SummaryStats({ events }: { events: TauriDeathEvent[] }) {
  const kills  = events.filter(e =>  e.playerIsKiller);
  const deaths = events.filter(e => !e.playerIsKiller);

  const hs = kills.filter(e => e.headshot).length;
  const hsPercent = kills.length > 0 ? Math.round(hs / kills.length * 100) : 0;
  const kd = deaths.length > 0
    ? (kills.length / deaths.length).toFixed(2)
    : kills.length > 0 ? "∞" : "0.00";

  // Average victim speed across death events (how fast the player was moving when they died)
  const deathSpeeds = deaths.filter(e => e.hasPosData).map(e => e.victimSpeed);
  const avgSpeed = deathSpeeds.length > 0
    ? Math.round(deathSpeeds.reduce((s, v) => s + v, 0) / deathSpeeds.length)
    : 0;

  // Top kill weapon
  const weaponMap: Record<string, number> = {};
  kills.forEach(e => { weaponMap[e.weapon] = (weaponMap[e.weapon] ?? 0) + 1; });
  const topWeapon = Object.entries(weaponMap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  // Most frequent killer (of deaths)
  const killerMap: Record<string, number> = {};
  deaths.forEach(e => { killerMap[e.killerName] = (killerMap[e.killerName] ?? 0) + 1; });
  const topKiller = Object.entries(killerMap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  return (
    <div className="grid grid-cols-5 gap-1.5 px-4 py-3 border-b border-white/8 bg-white/[0.01] shrink-0">
      <div className="flex flex-col items-center">
        <span className="text-[9px] text-white/25 uppercase tracking-wider">K / D</span>
        <span className="text-sm font-bold text-white/75">{kills.length}/{deaths.length}</span>
        <span className="text-[9px] text-white/25 font-mono">{kd}</span>
      </div>
      <div className="flex flex-col items-center">
        <span className="text-[9px] text-white/25 uppercase tracking-wider">HS%</span>
        <span className="text-sm font-bold text-white/75">{hsPercent}%</span>
        <span className="text-[9px] text-white/25 font-mono">{hs} hs</span>
      </div>
      <div className="flex flex-col items-center">
        <span className="text-[9px] text-white/25 uppercase tracking-wider">Avg Spd</span>
        <span className="text-sm font-bold text-white/75">{avgSpeed}</span>
        <span className="text-[9px] text-white/25 font-mono">u/s</span>
      </div>
      <div className="flex flex-col items-center overflow-hidden">
        <span className="text-[9px] text-white/25 uppercase tracking-wider">Top Gun</span>
        <span className="text-xs font-bold text-white/75 truncate max-w-full text-center">{topWeapon}</span>
      </div>
      <div className="flex flex-col items-center overflow-hidden">
        <span className="text-[9px] text-white/25 uppercase tracking-wider">Top Killer</span>
        <span className="text-xs font-bold text-white/75 truncate max-w-full text-center" title={topKiller}>
          {topKiller.slice(0, 9)}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
//  Team badge helper
// ─────────────────────────────────────────

function teamBadge(teamNum: number) {
  if (teamNum === 2) return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-yellow-500/20 text-yellow-400">T</span>;
  if (teamNum === 3) return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-400">CT</span>;
  return null;
}

// ─────────────────────────────────────────
//  Main modal
// ─────────────────────────────────────────

export function StatisticsModal({ demoName, filepath, players, onClose }: StatisticsModalProps) {
  const { t } = useTranslation();
  const { settings } = useApp();

  // All events (kills + deaths) for the selected player
  const [allEvents, setAllEvents] = useState<TauriDeathEvent[] | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [tab, setTab] = useState<"deaths" | "kills">("deaths");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Radar — one per demo (same map for all events)
  const [radarInfo, setRadarInfo] = useState<MapRadarInfo | null>(null);
  const [radarUrl, setRadarUrl] = useState<string | null>(null);
  const [lowerRadarUrl, setLowerRadarUrl] = useState<string | null>(null);

  // Debug probe
  const [probeResult, setProbeResult] = useState<string | null>(null);
  const [probeLoading, setProbeLoading] = useState(false);

  const activePlayers = players.filter(p => p.teamNum === 2 || p.teamNum === 3);

  const filteredEvents = allEvents
    ? allEvents.filter(e => tab === "kills" ? e.playerIsKiller : !e.playerIsKiller)
    : null;

  const killCount  = allEvents ? allEvents.filter(e =>  e.playerIsKiller).length : 0;
  const deathCount = allEvents ? allEvents.filter(e => !e.playerIsKiller).length : 0;

  async function handleSelectPlayer(name: string) {
    setSelectedPlayer(name);
    setLoading(true);
    setError(null);
    setAllEvents(null);
    setRadarInfo(null);
    setRadarUrl(null);
    setLowerRadarUrl(null);

    try {
      const result = await tauriParseDemoDeaths(filepath, name);
      setAllEvents(result);

      // Load radar image(s) for this map (silently ignore failure — falls back to relative view)
      const mapName = result.length > 0 ? result[0].mapName : "";
      if (mapName && settings.steamPath && isTauri()) {
        try {
          const info = await tauriGetMapRadarInfo(settings.steamPath, mapName);
          setRadarInfo(info);
          const { convertFileSrc } = await import("@tauri-apps/api/core");
          setRadarUrl(convertFileSrc(info.radarPath));
          // Load lower-level radar for two-level maps (Nuke, Vertigo, etc.)
          if (info.lowerRadarPath) {
            setLowerRadarUrl(convertFileSrc(info.lowerRadarPath));
          }
        } catch {
          // Radar not available — fallback diagram will be used automatically
        }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleBack() {
    setAllEvents(null);
    setSelectedPlayer(null);
    setError(null);
    setRadarInfo(null);
    setRadarUrl(null);
    setLowerRadarUrl(null);
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

  function copyAllDebug() {
    if (!allEvents) return;
    const lines = allEvents.map((d, i) =>
      `[${i + 1}] R${d.round} ${d.playerIsKiller ? "KILL" : "DEATH"} ${d.killerName}→${d.victimName} ${d.weapon}${d.headshot ? " HS" : ""} | ${d.debugInfo}`
    );
    navigator.clipboard.writeText(lines.join("\n")).catch(() => {
      prompt("Copy debug output:", lines.join("\n"));
    });
  }

  const showPlayerPicker = allEvents === null && !loading && !error;
  const showEvents       = allEvents !== null && !loading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl border border-white/10 bg-[#0d1117] shadow-2xl overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 shrink-0">
          <div className="flex items-center gap-2.5">
            {allEvents !== null ? (
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
                {selectedPlayer
                  ? `${deathCount} deaths · ${killCount} kills · ${selectedPlayer}`
                  : demoName}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/8 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-white/40">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm">{t("demo.statsLoading")}</p>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-red-400/70">
            <Skull className="w-8 h-8 mb-3 opacity-50" />
            <p className="text-sm">{t("demo.statsError")}</p>
            <p className="text-xs mt-1 text-white/20 max-w-xs text-center break-all">{error}</p>
            <button onClick={() => setError(null)}
              className="mt-4 text-[10px] text-white/30 hover:text-white/60 hover:bg-white/8 px-3 py-1.5 rounded-lg border border-white/8 transition-all">
              back
            </button>
          </div>
        )}

        {/* ── Player picker ── */}
        {showPlayerPicker && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activePlayers.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-white/30">
                <Users className="w-8 h-8 mb-3 opacity-30" />
                <p className="text-sm">{t("stats.noPlayers")}</p>
              </div>
            )}

            {/* Terrorists */}
            {activePlayers.filter(p => p.teamNum === 2).length > 0 && (
              <div>
                <p className="text-yellow-400/60 text-[10px] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-yellow-500/40 inline-block" />
                  {t("stats.teamT")}
                </p>
                <div className="space-y-1">
                  {activePlayers.filter(p => p.teamNum === 2).map((p, i) => (
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

            {/* Counter-Terrorists */}
            {activePlayers.filter(p => p.teamNum === 3).length > 0 && (
              <div>
                <p className="text-blue-400/60 text-[10px] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500/40 inline-block" />
                  {t("stats.teamCT")}
                </p>
                <div className="space-y-1">
                  {activePlayers.filter(p => p.teamNum === 3).map((p, i) => (
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

            {/* Debug probe */}
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
                    className="absolute top-2 right-10 text-[8px] font-mono text-white/30 hover:text-white/60 hover:bg-white/8 px-1.5 py-0.5 rounded border border-white/8 transition-all">
                    copy
                  </button>
                  <button
                    onClick={() => setProbeResult(null)}
                    className="absolute top-2 right-2 text-[8px] font-mono text-white/30 hover:text-white/60 hover:bg-white/8 px-1.5 py-0.5 rounded border border-white/8 transition-all">
                    ✕
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Events view ── */}
        {showEvents && (
          <>
            {/* Per-demo summary stats */}
            {allEvents && allEvents.length > 0 && (
              <SummaryStats events={allEvents} />
            )}

            {/* Kills / Deaths tab bar */}
            <div className="flex shrink-0 border-b border-white/8 px-5 pt-3 gap-1 items-end">
              <button
                onClick={() => setTab("deaths")}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-all",
                  tab === "deaths"
                    ? "border-red-500 text-red-400 bg-red-950/20"
                    : "border-transparent text-white/40 hover:text-white/60 hover:bg-white/4"
                )}
              >
                <span className="flex items-center gap-1.5">
                  <Skull className="w-3 h-3" />
                  Deaths
                  <span className="px-1.5 py-0.5 rounded-full bg-white/8 text-[10px] font-bold text-white/50">
                    {deathCount}
                  </span>
                </span>
              </button>
              <button
                onClick={() => setTab("kills")}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-all",
                  tab === "kills"
                    ? "border-emerald-500 text-emerald-400 bg-emerald-950/20"
                    : "border-transparent text-white/40 hover:text-white/60 hover:bg-white/4"
                )}
              >
                <span className="flex items-center gap-1.5">
                  <Target className="w-3 h-3" />
                  Kills
                  <span className="px-1.5 py-0.5 rounded-full bg-white/8 text-[10px] font-bold text-white/50">
                    {killCount}
                  </span>
                </span>
              </button>
              <div className="flex-1" />
              {allEvents && allEvents.length > 0 && (
                <button
                  onClick={copyAllDebug}
                  className="mb-1.5 px-2 py-1 rounded text-[9px] font-mono text-white/15 hover:text-white/40 hover:bg-white/8 transition-all border border-white/6"
                  title="Copy all debug info"
                >
                  [dbg]
                </button>
              )}
            </div>

            {/* Event cards */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {filteredEvents && filteredEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-white/30">
                  {tab === "deaths"
                    ? <Skull  className="w-8 h-8 mb-3 opacity-30" />
                    : <Target className="w-8 h-8 mb-3 opacity-30" />}
                  <p className="text-sm">
                    {tab === "deaths" ? t("stats.noDeaths") : "No kills recorded in this demo."}
                  </p>
                  <p className="text-xs mt-1 text-white/20">
                    {tab === "deaths"
                      ? t("stats.noDeathsHint")
                      : "Try switching to the Deaths tab."}
                  </p>
                </div>
              ) : (
                filteredEvents?.map((event, i) => (
                  <EventCard
                    key={i}
                    event={event}
                    radarUrl={radarUrl}
                    radarInfo={radarInfo}
                    lowerRadarUrl={lowerRadarUrl}
                    t={t}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

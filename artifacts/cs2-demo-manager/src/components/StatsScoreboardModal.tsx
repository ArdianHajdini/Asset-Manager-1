import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Download, AlertCircle } from "lucide-react";
import {
  tauriParseDemoStats,
  tauriWriteStatsDebug,
  type TauriDemoStats,
  type TauriPlayerStats,
} from "../services/tauriBridge";
import { cn } from "@/lib/utils";

interface StatsScoreboardModalProps {
  demoName: string;
  filepath: string;
  onClose: () => void;
}

type SideFilter = "all" | "t" | "ct";
type SortKey =
  | "name" | "kills" | "deaths" | "assists" | "kd" | "adr" | "hs"
  | "kast" | "entryK" | "entryD" | "utility";

interface DerivedRow {
  raw: TauriPlayerStats;
  kd: number;
  adr: number;
  hsPct: number | null;   // null when not available for the active side filter
  kastPct: number | null; // null when not available for the active side filter
}

function deriveRow(p: TauriPlayerStats, side: SideFilter): DerivedRow {
  const kills = side === "all" ? p.kills : side === "t" ? p.tKills : p.ctKills;
  const deaths = side === "all" ? p.deaths : side === "t" ? p.tDeaths : p.ctDeaths;
  const damage = side === "all" ? p.damageDealt : side === "t" ? p.tDamage : p.ctDamage;
  const rounds = side === "all"
    ? p.roundsPlayed
    : side === "t"
      ? p.tRounds
      : p.ctRounds;

  const kd = deaths === 0 ? kills : kills / deaths;
  const adr = rounds === 0 ? 0 : damage / rounds;

  // HS% and KAST% are computed in Rust over OVERALL kills / OVERALL rounds and
  // we don't have side-split breakdowns for them. To avoid mixing side-filtered
  // kills/deaths/ADR with overall HS%/KAST% in the same row (which would
  // mislead the user), only show these two when the filter is "all".
  const hsPct = side !== "all"
    ? null
    : p.kills === 0 ? 0 : (p.headshotKills / p.kills) * 100;
  const kastPct = side !== "all"
    ? null
    : p.roundsPlayed === 0 ? 0 : (p.kastRounds / p.roundsPlayed) * 100;

  // Replace base aggregates with the side-filtered values for display
  return {
    raw: { ...p, kills, deaths, damageDealt: damage, roundsPlayed: rounds },
    kd,
    adr,
    hsPct,
    kastPct,
  };
}

function compare(a: DerivedRow, b: DerivedRow, key: SortKey): number {
  switch (key) {
    case "name":   return a.raw.name.localeCompare(b.raw.name);
    case "kills":  return b.raw.kills - a.raw.kills;
    case "deaths": return b.raw.deaths - a.raw.deaths;
    case "assists":return b.raw.assists - a.raw.assists;
    case "kd":     return b.kd - a.kd;
    case "adr":    return b.adr - a.adr;
    case "hs":     return (b.hsPct ?? -1) - (a.hsPct ?? -1);
    case "kast":   return (b.kastPct ?? -1) - (a.kastPct ?? -1);
    case "entryK": return b.raw.entryKills - a.raw.entryKills;
    case "entryD": return b.raw.entryDeaths - a.raw.entryDeaths;
    case "utility":return b.raw.utilityDamage - a.raw.utilityDamage;
  }
}

function teamLabel(t: number): string {
  if (t === 2) return "T";
  if (t === 3) return "CT";
  return "—";
}
function teamColor(t: number): string {
  if (t === 2) return "text-yellow-300/90";
  if (t === 3) return "text-blue-300/90";
  return "text-white/30";
}
function sourceBadge(source: string): string {
  if (source === "faceit") return "bg-orange-500/20 text-orange-300 border-orange-500/30";
  if (source === "valve")  return "bg-blue-500/20 text-blue-300 border-blue-500/30";
  return "bg-white/10 text-white/50 border-white/15";
}

export function StatsScoreboardModal({
  demoName,
  filepath,
  onClose,
}: StatsScoreboardModalProps) {
  const [stats, setStats] = useState<TauriDemoStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugPath, setDebugPath] = useState<string | null>(null);
  const [side, setSide] = useState<SideFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("kills");

  // Compute stats + auto-write the debug JSON next to the demo
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDebugPath(null);
    tauriParseDemoStats(filepath)
      .then(async (s) => {
        if (cancelled) return;
        setStats(s);
        // Auto-save sidecar JSON. Failure here is non-fatal — the scoreboard
        // still renders and the user can press the Export button manually.
        try {
          const out = await tauriWriteStatsDebug(filepath, JSON.stringify(s, null, 2));
          if (!cancelled) setDebugPath(out);
        } catch (e) {
          console.warn("[stats] failed to write debug JSON:", e);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [filepath]);

  const rows = useMemo<DerivedRow[]>(() => {
    if (!stats) return [];
    let list = stats.players;
    if (side === "t")  list = list.filter((p) => p.tRounds  > 0);
    if (side === "ct") list = list.filter((p) => p.ctRounds > 0);
    return list.map((p) => deriveRow(p, side)).sort((a, b) => compare(a, b, sortKey));
  }, [stats, side, sortKey]);

  async function handleExport() {
    if (!stats) return;
    try {
      const out = await tauriWriteStatsDebug(filepath, JSON.stringify(stats, null, 2));
      setDebugPath(out);
    } catch (e) {
      setError(String(e));
    }
  }

  const SortHeader = ({
    keyName, label, tooltip, align = "right",
  }: { keyName: SortKey; label: string; tooltip?: string; align?: "left" | "right" }) => (
    <th
      onClick={() => setSortKey(keyName)}
      title={tooltip ?? label}
      className={cn(
        "px-2 py-1.5 cursor-pointer select-none transition-colors hover:text-orange-300",
        align === "right" ? "text-right" : "text-left",
        sortKey === keyName ? "text-orange-300" : "text-white/45",
      )}
    >
      {label}{sortKey === keyName ? " ▾" : ""}
    </th>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl border border-white/10 bg-zinc-950 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-white/8">
          <div className="min-w-0">
            <h2 className="text-white font-semibold text-base truncate">Scoreboard</h2>
            <p className="text-white/40 text-xs truncate">{demoName}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/8 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Meta bar */}
        {stats && (
          <div className="flex flex-wrap items-center gap-3 px-5 py-2 border-b border-white/8 bg-white/3">
            <span className="text-white/55 text-xs">
              <span className="text-white/35">Map:</span> {stats.mapName || "—"}
            </span>
            <span className="text-white/55 text-xs">
              <span className="text-white/35">Rounds:</span> {stats.rounds}
            </span>
            <span className="text-white/55 text-xs">
              <span className="text-white/35">Trade window:</span>{" "}
              {(stats.tradeWindowTicks / 64).toFixed(1)}s
            </span>
            <span className={cn(
              "px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider",
              sourceBadge(stats.source),
            )}>
              {stats.source}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {/* Side filter */}
              <div className="flex rounded-lg border border-white/10 overflow-hidden">
                {(["all", "t", "ct"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSide(s)}
                    className={cn(
                      "px-3 py-1 text-[11px] font-medium uppercase tracking-wider transition-colors",
                      side === s
                        ? "bg-orange-500/20 text-orange-300"
                        : "bg-transparent text-white/45 hover:text-white/70",
                    )}
                  >
                    {s === "all" ? "Both" : s === "t" ? "T" : "CT"}
                  </button>
                ))}
              </div>
              <button
                onClick={handleExport}
                title="Re-export stats-debug.json"
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-white/10 bg-white/4 text-white/55 hover:text-white hover:bg-white/8 transition-colors text-[11px]"
              >
                <Download className="w-3.5 h-3.5" />
                Export JSON
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto p-5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 text-white/50">
              <Loader2 className="w-6 h-6 animate-spin mb-3" />
              <p className="text-sm">Parsing demo…</p>
              <p className="text-xs text-white/30 mt-1">This typically takes 5–30 seconds.</p>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-start gap-3 p-4 rounded-lg border border-red-500/30 bg-red-900/20 text-red-200">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-semibold text-sm">Failed to parse demo</p>
                <p className="text-xs text-red-300/80 mt-1 break-words">{error}</p>
              </div>
            </div>
          )}

          {stats && !loading && !error && (
            <>
              <table className="w-full text-xs border-separate border-spacing-y-1">
                <thead className="text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-white/45">Side</th>
                    <SortHeader keyName="name"    label="Player"  align="left" />
                    <SortHeader keyName="kills"   label="K" />
                    <SortHeader keyName="deaths"  label="D" />
                    <SortHeader keyName="assists" label="A" />
                    <SortHeader keyName="kd"      label="K/D" />
                    <SortHeader keyName="adr"     label="ADR"   tooltip="Average Damage per Round" />
                    <SortHeader keyName="hs"      label="HS%"   tooltip="Headshot kill percentage (overall — only shown when side filter = Both)" />
                    <SortHeader keyName="kast"    label="KAST%" tooltip="Rounds with Kill / Assist / Survive / Trade (overall — only shown when side filter = Both)" />
                    <SortHeader keyName="entryK"  label="EK"    tooltip="Entry Kills (first kill of the round)" />
                    <SortHeader keyName="entryD"  label="ED"    tooltip="Entry Deaths (first to die in the round)" />
                    <SortHeader keyName="utility" label="UD"    tooltip="Utility Damage (grenades)" />
                    <th className="px-2 py-1.5 text-right text-white/30 font-mono">SteamID</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.raw.steamId}
                      className="bg-white/3 hover:bg-white/6 transition-colors"
                    >
                      <td className={cn("px-2 py-1.5 font-bold rounded-l-lg", teamColor(r.raw.teamNum))}>
                        {teamLabel(r.raw.teamNum)}
                      </td>
                      <td className="px-2 py-1.5 text-white/85 font-medium truncate max-w-[14rem]">
                        {r.raw.name || <span className="text-white/30 italic">unknown</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right text-white/85 tabular-nums">{r.raw.kills}</td>
                      <td className="px-2 py-1.5 text-right text-white/55 tabular-nums">{r.raw.deaths}</td>
                      <td className="px-2 py-1.5 text-right text-white/55 tabular-nums">{r.raw.assists}</td>
                      <td className="px-2 py-1.5 text-right text-white/85 tabular-nums">{r.kd.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right text-white/85 tabular-nums">{r.adr.toFixed(1)}</td>
                      <td className="px-2 py-1.5 text-right text-white/70 tabular-nums">
                        {r.hsPct === null ? <span className="text-white/25">—</span> : `${r.hsPct.toFixed(0)}%`}
                      </td>
                      <td className="px-2 py-1.5 text-right text-white/70 tabular-nums">
                        {r.kastPct === null ? <span className="text-white/25">—</span> : `${r.kastPct.toFixed(0)}%`}
                      </td>
                      <td className="px-2 py-1.5 text-right text-white/55 tabular-nums">{r.raw.entryKills}</td>
                      <td className="px-2 py-1.5 text-right text-white/55 tabular-nums">{r.raw.entryDeaths}</td>
                      <td className="px-2 py-1.5 text-right text-white/55 tabular-nums">{r.raw.utilityDamage}</td>
                      <td className="px-2 py-1.5 text-right text-white/25 font-mono text-[10px] rounded-r-lg">
                        {r.raw.steamId.slice(-6)}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={13} className="text-center py-8 text-white/30 italic">
                        No players found for this side filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Footer */}
              <div className="mt-4 pt-3 border-t border-white/6 text-[10px] text-white/35 space-y-1">
                <p>
                  <span className="text-white/55">Method:</span> Awpy-style aggregation —
                  K/D/A/HS from <code className="text-white/55">player_death</code>;
                  ADR & utility damage from <code className="text-white/55">player_hurt.dmg_health</code>;
                  KAST scored per round (K + A + S + T within {(stats.tradeWindowTicks / 64).toFixed(0)}s);
                  side splits use the player's team at the tick of each event.
                </p>
                {debugPath && (
                  <p>
                    <span className="text-green-400/70">●</span>{" "}
                    Debug JSON saved to <code className="text-white/55 break-all">{debugPath}</code>
                  </p>
                )}
                <p className="text-white/25">
                  Counts: {stats.kills.length} kills, {stats.damages.length} damage events,
                  {" "}{stats.players.length} players, {stats.rounds} rounds.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

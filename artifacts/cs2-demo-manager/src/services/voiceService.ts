/**
 * voiceService.ts — CS2 voice mode selection and command generation.
 *
 * Modes:
 *   "all"       → voice_enable 1; tv_listen_voice_indices -1; tv_listen_voice_indices_h -1
 *   "none"      → voice_enable 0
 *   "own_team"  → tv_listen_voice_indices <bitmask of own-team slots>
 *   "enemy"     → tv_listen_voice_indices <bitmask of enemy slots>
 *
 * PARTIAL MATCHING:
 *   For own_team / enemy mode a command is generated as long as at least
 *   ONE player has a known entityId. The bitmask is built from the known
 *   players only. A warning is shown for missing players but no command is
 *   suppressed. Only when ZERO players have entityIds is null returned.
 *
 * Player slot numbers (entityId) come from the CDemoStringTables "userinfo"
 * string table inside the .dem file (Rust parser → TauriDemoPlayer.entityId).
 *
 * tv_listen_voice_indices takes a bitmask where bit N = hear player at slot N.
 * tv_listen_voice_indices_h covers slots 32–63 (always 0 in CS2 matches).
 */

import type { TauriDemoPlayer } from "./tauriBridge";

export type VoiceMode = "all" | "none" | "own_team" | "enemy";

export interface VoiceOption {
  mode: VoiceMode;
  label: string;
  description: string;
}

export const VOICE_OPTIONS: VoiceOption[] = [
  {
    mode: "all",
    label: "Alle hören",
    description: "Alle Spielerstimmen aktiviert",
  },
  {
    mode: "none",
    label: "Kein Voice",
    description: "Alle Stimmen deaktiviert",
  },
  {
    mode: "own_team",
    label: "Eigenes Team",
    description: "Nur das eigene Team hören — Gegner werden stummgeschaltet",
  },
  {
    mode: "enemy",
    label: "Gegner",
    description: "Nur Gegner hören — eigenes Team wird stummgeschaltet",
  },
];

// ── Roster helpers ──────────────────────────────────────────────────────────

/** Categorised player rosters for a demo, derived from TauriDemoPlayer[]. */
export interface DemoRosters {
  /** Team Terrorist players (teamNum === 2) */
  terrorists: TauriDemoPlayer[];
  /** Team Counter-Terrorist players (teamNum === 3) */
  counterTerrorists: TauriDemoPlayer[];
  /** All players (both teams) */
  all: TauriDemoPlayer[];
}

/** Build categorised rosters from the raw parser output. */
export function buildRosters(players: TauriDemoPlayer[]): DemoRosters {
  return {
    terrorists: players.filter((p) => p.teamNum === 2),
    counterTerrorists: players.filter((p) => p.teamNum === 3),
    all: players,
  };
}

/**
 * Given rosters and the user's own Steam ID, determine which team the user
 * is on (T or CT). Returns null if the Steam ID is not found.
 */
export function getUserTeam(
  rosters: DemoRosters,
  userXuid: string | undefined
): "T" | "CT" | null {
  if (!userXuid) return null;
  if (rosters.terrorists.some((p) => p.xuid === userXuid)) return "T";
  if (rosters.counterTerrorists.some((p) => p.xuid === userXuid)) return "CT";
  return null;
}

/**
 * Return the "own team" and "enemy team" player arrays for a given user.
 * Falls back to T/CT split when the user's team cannot be identified.
 */
export function splitTeams(
  rosters: DemoRosters,
  userXuid: string | undefined
): { ownTeam: TauriDemoPlayer[]; enemyTeam: TauriDemoPlayer[] } {
  const side = getUserTeam(rosters, userXuid);
  if (side === "T") {
    return { ownTeam: rosters.terrorists, enemyTeam: rosters.counterTerrorists };
  }
  if (side === "CT") {
    return { ownTeam: rosters.counterTerrorists, enemyTeam: rosters.terrorists };
  }
  return { ownTeam: rosters.terrorists, enemyTeam: rosters.counterTerrorists };
}

/** Return the relevant player list to DISPLAY for a given voice mode. */
export function getPlayersForMode(
  mode: VoiceMode,
  rosters: DemoRosters | null,
  userXuid?: string
): TauriDemoPlayer[] | null {
  if (!rosters) return null;
  const { ownTeam, enemyTeam } = splitTeams(rosters, userXuid);
  switch (mode) {
    case "own_team": return ownTeam;
    case "enemy":    return enemyTeam;
    default:         return null;
  }
}

/**
 * Return the players that the user WANTS TO HEAR for a given voice mode.
 * Returns null for "all" / "none" (no per-player selection needed).
 */
export function getPlayersToHear(
  mode: VoiceMode,
  rosters: DemoRosters | null,
  userXuid?: string
): TauriDemoPlayer[] | null {
  if (!rosters) return null;
  const { ownTeam, enemyTeam } = splitTeams(rosters, userXuid);
  switch (mode) {
    case "own_team": return ownTeam;
    case "enemy":    return enemyTeam;
    default:         return null;
  }
}

// ── Entity-ID helpers ───────────────────────────────────────────────────────

/** Players that have a resolved entity/slot ID. */
export function playersWithEntityIds(players: TauriDemoPlayer[]): TauriDemoPlayer[] {
  return players.filter((p) => p.entityId !== undefined);
}

/** Players whose entity/slot ID could not be resolved. */
export function playersMissingEntityIds(players: TauriDemoPlayer[]): TauriDemoPlayer[] {
  return players.filter((p) => p.entityId === undefined);
}

/**
 * @deprecated Use playersWithEntityIds(players).length > 0 instead.
 * Kept for any external callers; internally no longer used.
 */
export function hasEntityIds(players: TauriDemoPlayer[]): boolean {
  return players.length > 0 && players.every((p) => p.entityId !== undefined);
}

/**
 * Compute the tv_listen_voice_indices bitmask split for the given players.
 * Only players with a known entityId contribute to the bitmask.
 * Bit N is set when the player at slot N should be heard.
 * Example: slots [2, 5, 7] → low=(1<<2)|(1<<5)|(1<<7)=164, high=0
 *
 * CS2 uses two signed-32-bit console cvars:
 *   tv_listen_voice_indices   — bits for slots 0–31
 *   tv_listen_voice_indices_h — bits for slots 32–63 (always 0 in CS2)
 *
 * JS bitwise operators produce signed 32-bit values, which is exactly what
 * CS2 expects. Slot 31 → (1<<31) = -2147483648 as a JS number, which is the
 * correct signed representation for CS2.
 *
 * CS2 demos have at most 10 players per side (slots 0–9); the high word is
 * always 0 in practice but is computed correctly for defensive correctness.
 */
export function buildVoiceIndexBitmask(players: TauriDemoPlayer[]): {
  low: number;
  high: number;
} {
  let low = 0;
  let high = 0;
  for (const p of players) {
    if (p.entityId === undefined) continue;
    const slot = p.entityId as number;
    if (slot >= 0 && slot < 32) {
      low = low | (1 << slot);
    } else if (slot >= 32 && slot < 64) {
      high = high | (1 << (slot - 32));
    }
  }
  return { low, high };
}

// ── Command builder ─────────────────────────────────────────────────────────

/**
 * Build the CS2 console voice-setup commands for the selected mode.
 *
 * PARTIAL SUCCESS: for own_team / enemy, returns a command as long as at
 * least ONE player has a resolved entityId. Missing players are simply
 * absent from the bitmask — the caller should warn the user.
 * Returns null only when ZERO players have entityIds.
 *
 * @param mode           - Voice mode selected by the user.
 * @param playersToHear  - Players the user wants to HEAR (their own side).
 */
export function buildVoiceCommands(
  mode: VoiceMode,
  playersToHear?: TauriDemoPlayer[] | null
): string | null {
  switch (mode) {
    case "none":
      return "voice_enable 0";

    case "all":
      return "voice_enable 1; tv_listen_voice_indices -1; tv_listen_voice_indices_h -1";

    case "own_team":
    case "enemy": {
      if (!playersToHear) return null;
      const known = playersWithEntityIds(playersToHear);
      if (known.length === 0) return null;
      const { low, high } = buildVoiceIndexBitmask(known);
      return `tv_listen_voice_indices ${low}; tv_listen_voice_indices_h ${high}`;
    }
  }
}

/**
 * Build the full CS2 console command:
 *   <voiceSetup>; playdemo <playdemoArg>
 *
 * Returns null only when voiceMode requires entityIds and ZERO are available.
 */
export function buildFullPlayCommand(
  playdemoArg: string,
  voiceMode: VoiceMode,
  playersToHear?: TauriDemoPlayer[] | null
): string | null {
  const voiceCmd = buildVoiceCommands(voiceMode, playersToHear);
  if (voiceCmd === null) return null;
  return `${voiceCmd}; playdemo ${playdemoArg}`;
}

/** Human-readable label for a mode (German). */
export function voiceModeLabel(mode: VoiceMode): string {
  return VOICE_OPTIONS.find((o) => o.mode === mode)?.label ?? mode;
}

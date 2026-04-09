/**
 * voiceService.ts — CS2 voice mode selection and command generation.
 *
 * Modes:
 *   "all"       → voice_enable 1                              (always implemented)
 *   "none"      → voice_enable 0                              (always implemented)
 *   "own_team"  → voice_mute <slot>... for every enemy        (needs entityId in roster)
 *   "enemy"     → voice_mute <slot>... for every own player   (needs entityId in roster)
 *
 * voice_mute slot numbers come from the CDemoStringTables "userinfo" string table
 * inside the .dem file. The Rust parser extracts them and exposes them as
 * TauriDemoPlayer.entityId (optional — absent when parsing failed).
 *
 * When entityId values are present the generated command looks like:
 *   voice_mute 2; voice_mute 5; voice_mute 7; playdemo replays/matchname
 *
 * When entityId values are absent the mode still shows the correct player list
 * (name / team) so the user can mute manually via the CS2 scoreboard.
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
 * Return the players that should be MUTED for a given voice mode.
 * - "own_team" → mute enemies so only your team is heard
 * - "enemy"    → mute your team so only the enemies are heard
 * Returns null for "all" / "none" (no per-player muting needed).
 */
export function getPlayersToMute(
  mode: VoiceMode,
  rosters: DemoRosters | null,
  userXuid?: string
): TauriDemoPlayer[] | null {
  if (!rosters) return null;
  const { ownTeam, enemyTeam } = splitTeams(rosters, userXuid);
  switch (mode) {
    case "own_team": return enemyTeam;   // mute enemies
    case "enemy":    return ownTeam;     // mute own team
    default:         return null;
  }
}

// ── Entity-ID helpers ───────────────────────────────────────────────────────

/**
 * Returns true when every player in the array has a known entityId.
 * Used to decide whether automatic voice_mute commands can be generated.
 */
export function hasEntityIds(players: TauriDemoPlayer[]): boolean {
  return players.length > 0 && players.every((p) => p.entityId !== undefined);
}

// ── Command builder ─────────────────────────────────────────────────────────

/**
 * Build the CS2 console voice-setup commands for the selected mode.
 *
 * @param mode          - Voice mode selected by the user.
 * @param playersToMute - Players whose voices should be muted (the "other side").
 *                        When all players have entityId, real voice_mute commands
 *                        are generated. Otherwise falls back to voice_enable 1.
 *
 * Examples:
 *   "none"      → "voice_enable 0"
 *   "all"       → "voice_enable 1"
 *   "own_team" with entity IDs → "voice_enable 1; voice_mute 2; voice_mute 7"
 *   "own_team" without IDs     → "voice_enable 1"
 */
export function buildVoiceCommands(
  mode: VoiceMode,
  playersToMute?: TauriDemoPlayer[] | null
): string {
  switch (mode) {
    case "none":
      return "voice_enable 0";

    case "all":
      return "voice_enable 1";

    case "own_team":
    case "enemy": {
      const base = "voice_enable 1";
      if (!playersToMute || !hasEntityIds(playersToMute)) return base;
      const muteCmds = playersToMute
        .map((p) => `voice_mute ${p.entityId}`)
        .join("; ");
      return `${base}; ${muteCmds}`;
    }
  }
}

/**
 * Build the full CS2 console command:
 *   <voiceSetup>; playdemo <playdemoArg>
 */
export function buildFullPlayCommand(
  playdemoArg: string,
  voiceMode: VoiceMode,
  playersToMute?: TauriDemoPlayer[] | null
): string {
  const voiceCmd = buildVoiceCommands(voiceMode, playersToMute);
  return `${voiceCmd}; playdemo ${playdemoArg}`;
}

/** Human-readable label for a mode (German). */
export function voiceModeLabel(mode: VoiceMode): string {
  return VOICE_OPTIONS.find((o) => o.mode === mode)?.label ?? mode;
}

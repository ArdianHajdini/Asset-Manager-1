/**
 * voiceService.ts — CS2 voice mode selection and command generation.
 *
 * Modes:
 *   "all"       → voice_enable 1                  (fully implemented)
 *   "none"      → voice_enable 0                  (fully implemented)
 *   "own_team"  → voice_enable 1 + player list    (demo parser supplies names & teams)
 *   "enemy"     → voice_enable 1 + player list    (demo parser supplies names & teams)
 *
 * NOTE on per-player muting in CS2:
 *   CS2's voice_mute command uses the in-game entity user ID (a small integer), NOT a
 *   Steam ID. The entity IDs are available in the demo entity data — not in the
 *   CDemoFileInfo summary we parse. So we display the correct player names, but
 *   actual per-player muting requires entity IDs (a future enhancement).
 */

import type { TauriDemoPlayer } from "./tauriBridge";

export type VoiceMode = "all" | "none" | "own_team" | "enemy";

export interface VoiceOption {
  mode: VoiceMode;
  label: string;
  description: string;
  /** true = fully implemented; false = informational only (no muting) */
  implemented: boolean;
  notImplementedNote?: string;
}

export const VOICE_OPTIONS: VoiceOption[] = [
  {
    mode: "all",
    label: "Alle hören",
    description: "Alle Spielerstimmen aktiviert",
    implemented: true,
  },
  {
    mode: "none",
    label: "Kein Voice",
    description: "Alle Stimmen deaktiviert",
    implemented: true,
  },
  {
    mode: "own_team",
    label: "Eigenes Team",
    description: "Zeigt das eigene Team — manuelle Stummschaltung nötig",
    implemented: false,
    notImplementedNote:
      "CS2 benötigt Entity-IDs für voice_mute — Demo-Parser liefert die Spielerliste.",
  },
  {
    mode: "enemy",
    label: "Gegner",
    description: "Zeigt die Gegner — manuelle Stummschaltung nötig",
    implemented: false,
    notImplementedNote:
      "CS2 benötigt Entity-IDs für voice_mute — Demo-Parser liefert die Spielerliste.",
  },
];

// ── Roster from the demo parser ────────────────────────────────────────────

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
 * Falls back to T/CT split if the user's team is not identifiable.
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
  // Can't determine → return T as ownTeam by convention
  return { ownTeam: rosters.terrorists, enemyTeam: rosters.counterTerrorists };
}

// ── Command builder ────────────────────────────────────────────────────────

/**
 * Build the CS2 console voice command for the selected mode.
 *
 * With real entity IDs (future): voice_mute per player.
 * Today: voice_enable 0/1 for all/none; display-only for own_team/enemy.
 */
export function buildVoiceCommands(mode: VoiceMode): string {
  switch (mode) {
    case "none":
      return "voice_enable 0";
    case "all":
    case "own_team":
    case "enemy":
      return "voice_enable 1";
  }
}

/**
 * Build the full CS2 console command:
 *   <voiceSetup>; playdemo <playdemoArg>
 */
export function buildFullPlayCommand(playdemoArg: string, voiceMode: VoiceMode): string {
  const voiceCmd = buildVoiceCommands(voiceMode);
  return `${voiceCmd}; playdemo ${playdemoArg}`;
}

/** Human-readable label for a mode (German). */
export function voiceModeLabel(mode: VoiceMode): string {
  return VOICE_OPTIONS.find((o) => o.mode === mode)?.label ?? mode;
}

/** Return the relevant player list for a given mode (to show in the UI). */
export function getPlayersForMode(
  mode: VoiceMode,
  rosters: DemoRosters | null,
  userXuid?: string
): TauriDemoPlayer[] | null {
  if (!rosters) return null;
  const { ownTeam, enemyTeam } = splitTeams(rosters, userXuid);
  switch (mode) {
    case "own_team":
      return ownTeam;
    case "enemy":
      return enemyTeam;
    default:
      return null;
  }
}

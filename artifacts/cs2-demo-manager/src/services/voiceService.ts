/**
 * voiceService.ts — CS2 voice mode selection and command generation.
 *
 * Modes:
 *   "all"     → voice_enable 1; tv_listen_voice_indices -1; tv_listen_voice_indices_h -1
 *   "none"    → voice_enable 0
 *   "team_t"  → tv_listen_voice_indices <bitmask of Terrorist slots>
 *   "team_ct" → tv_listen_voice_indices <bitmask of Counter-Terrorist slots>
 *
 * Team identification uses ONLY demo data (m_iTeamNum from entity observer):
 *   teamNum === 2 → Terrorist
 *   teamNum === 3 → Counter-Terrorist
 *
 * No FACEIT player data is used for voice mapping or team splitting.
 * XUID (m_steamID) and name (m_iszPlayerName) come exclusively from the demo.
 *
 * PARTIAL MATCHING:
 *   For team_t / team_ct, a command is generated as long as at least ONE player
 *   in that team has a known entityId. Missing slots are absent from the bitmask
 *   and the caller shows a warning. Only when ZERO slots are known is null returned.
 *
 * Player slot numbers (entityId) come from the source2-demo entity observer
 * (entity.index() IS the voice_mute slot). The Rust parser falls back to the
 * CDemoStringTables "userinfo" table only when the entity observer returns
 * no players. Both paths populate TauriDemoPlayer.entityId.
 *
 * tv_listen_voice_indices  — signed 32-bit bitmask for slots 0–31
 * tv_listen_voice_indices_h — signed 32-bit bitmask for slots 32–63 (always 0 in CS2)
 */

import type { TauriDemoPlayer } from "./tauriBridge";

export type VoiceMode = "all" | "none" | "team_t" | "team_ct";

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
    mode: "team_t",
    label: "Team T",
    description: "Nur Terroristen hören — Counter-Terroristen werden stummgeschaltet",
  },
  {
    mode: "team_ct",
    label: "Team CT",
    description: "Nur Counter-Terroristen hören — Terroristen werden stummgeschaltet",
  },
];

// ── Roster helpers ──────────────────────────────────────────────────────────

/** Categorised player rosters for a demo, derived from TauriDemoPlayer[]. */
export interface DemoRosters {
  /** Terrorist players (teamNum === 2) */
  terrorists: TauriDemoPlayer[];
  /** Counter-Terrorist players (teamNum === 3) */
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
 * Return the players to DISPLAY for a given voice mode.
 * Team split is based solely on m_iTeamNum from the demo (2=T, 3=CT).
 * No FACEIT data or userXuid is needed.
 */
export function getPlayersForMode(
  mode: VoiceMode,
  rosters: DemoRosters | null
): TauriDemoPlayer[] | null {
  if (!rosters) return null;
  switch (mode) {
    case "team_t":  return rosters.terrorists;
    case "team_ct": return rosters.counterTerrorists;
    default:        return null;
  }
}

/**
 * Return the players the user WANTS TO HEAR for a given voice mode.
 * Returns null for "all" / "none" (no per-player bitmask needed).
 * Team split is based solely on m_iTeamNum from the demo.
 */
export function getPlayersToHear(
  mode: VoiceMode,
  rosters: DemoRosters | null
): TauriDemoPlayer[] | null {
  if (!rosters) return null;
  switch (mode) {
    case "team_t":  return rosters.terrorists;
    case "team_ct": return rosters.counterTerrorists;
    default:        return null;
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

// ── Debug helper ─────────────────────────────────────────────────────────────

/**
 * Build a structured debug snapshot of all demo players and the computed bitmask.
 * Logs to console automatically; also returns the data for in-UI display.
 *
 * Output includes:
 *   - All players: name, team (T/CT), entityId (voice slot)
 *   - Final bitmask low/high for the current voice mode
 */
export function buildVoiceDebugInfo(
  allPlayers: TauriDemoPlayer[],
  mode: VoiceMode,
  playersToHear: TauriDemoPlayer[] | null
): {
  players: { name: string; team: string; slot: number | undefined; xuid: string }[];
  mode: VoiceMode;
  bitmask: { low: number; high: number } | null;
  command: string | null;
} {
  const players = allPlayers.map((p) => ({
    name: p.name,
    team: p.teamNum === 2 ? "T" : p.teamNum === 3 ? "CT" : "?",
    slot: p.entityId,
    xuid: p.xuid || "(leer)",
  }));

  const bitmask = playersToHear
    ? buildVoiceIndexBitmask(playersWithEntityIds(playersToHear))
    : null;

  const command = buildVoiceCommands(mode, playersToHear);

  const debug = { players, mode, bitmask, command };
  console.log("[CS2DM] Voice-Debug:", JSON.stringify(debug, null, 2));
  return debug;
}

// ── Command builder ─────────────────────────────────────────────────────────

/**
 * Build the CS2 console voice-setup commands for the selected mode.
 *
 * PARTIAL SUCCESS: for team_t / team_ct, returns a command as long as at
 * least ONE player has a resolved entityId. Missing players are simply
 * absent from the bitmask — the caller should warn the user.
 * Returns null only when ZERO players have entityIds.
 *
 * @param mode           - Voice mode selected by the user.
 * @param playersToHear  - Players the user wants to HEAR (their chosen team).
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

    case "team_t":
    case "team_ct": {
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

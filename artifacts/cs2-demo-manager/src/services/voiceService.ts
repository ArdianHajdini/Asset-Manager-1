/**
 * voiceService.ts — CS2 voice mode selection and command generation.
 *
 * Before copying the playdemo command, the user can choose what they want to hear
 * during demo playback. This service generates the correct CS2 console commands.
 *
 * Implemented modes:
 *   "all"       → voice_enable 1   (hear everyone — default)
 *   "none"      → voice_enable 0   (silence all voice)
 *
 * Placeholder modes (require demo parsing to identify team player IDs):
 *   "own_team"  → placeholder: voice_enable 1 until real demo parsing is available
 *   "enemy"     → placeholder: voice_enable 1 until real demo parsing is available
 *
 * The full command appended to the clipboard is:
 *   <voiceCmd>; playdemo <arg>
 *
 * TODO — real own_team / enemy filtering:
 *   1. Parse the .dem file header to extract team rosters
 *   2. Match player SteamIDs to faction1/faction2
 *   3. Use voice_mute / voice_unmute per player ID
 */

export type VoiceMode = "all" | "none" | "own_team" | "enemy";

export interface VoiceOption {
  mode: VoiceMode;
  label: string;
  description: string;
  /** true = fully working; false = placeholder architecture only */
  implemented: boolean;
  /** Shown in UI when implemented === false */
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
    description: "Nur das eigene Team",
    implemented: false,
    notImplementedNote: "Benötigt Demo-Parsing — wird als »Alle hören« ausgeführt.",
  },
  {
    mode: "enemy",
    label: "Gegner",
    description: "Nur die Gegner",
    implemented: false,
    notImplementedNote: "Benötigt Demo-Parsing — wird als »Alle hören« ausgeführt.",
  },
];

/**
 * Build the CS2 console voice command for the selected mode.
 * "own_team" and "enemy" fall back to voice_enable 1 until demo parsing is available.
 */
export function buildVoiceCommands(mode: VoiceMode): string {
  switch (mode) {
    case "none":
      return "voice_enable 0";
    case "all":
      return "voice_enable 1";
    case "own_team":
      // TODO: use voice_mute per player after demo parsing
      return "voice_enable 1";
    case "enemy":
      // TODO: use voice_mute per player after demo parsing
      return "voice_enable 1";
  }
}

/**
 * Build the full CS2 console command string:
 *   <voiceSetup>; playdemo <playdemoArg>
 *
 * playdemoArg must be in the form "replays/matchname" (no .dem extension).
 */
export function buildFullPlayCommand(playdemoArg: string, voiceMode: VoiceMode): string {
  const voiceCmd = buildVoiceCommands(voiceMode);
  return `${voiceCmd}; playdemo ${playdemoArg}`;
}

/** Returns a human-readable label for the chosen mode (German). */
export function voiceModeLabel(mode: VoiceMode): string {
  return VOICE_OPTIONS.find((o) => o.mode === mode)?.label ?? mode;
}

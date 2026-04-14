
export interface Demo {
  id: string;
  filename: string;
  displayName: string;
  filepath: string;
  size: number;
  modifiedAt: string;
  directory: string;
}

export interface AppSettings {
  demoDirectory: string;
  cs2Path: string;
  steamPath: string;
  autoExtractGz: boolean;
  autoAddToLibrary: boolean;
  /** Folder to scan for downloaded demo files (.dem, .dem.gz, .dem.zst) */
  downloadsFolder: string;
  /**
   * Steam ID64 of the local player (e.g. "76561198012345678").
   * Filled automatically when connecting via FACEIT (game_player_id).
   * Used by the demo parser to identify the user's own team.
   */
  steamId: string;
}

export type CS2Status = "found" | "not_found" | "unknown";

/** A death or kill event for the local player extracted from a demo. */
export interface DemoDeathEvent {
  round: number;
  tick: number;
  timeSeconds: number;
  victimName: string;
  victimSteamId: string;
  killerName: string;
  weapon: string;
  headshot: boolean;
  victimPos: [number, number, number];
  killerPos: [number, number, number];
  victimEyeYaw: number;
  victimEyePitch: number;
  killerEyeYaw: number;
  killerEyePitch: number;
  victimSpeed: number;
  killerSpeed: number;
  isVictimAirborne: boolean;
  isKillerAirborne: boolean;
  isVictimBlinded: boolean;
  isKillerBlinded: boolean;
  penetratedObjects: number;
  isTradeKill: boolean;
  assisterName: string;
  assisterSteamId: string;
  assisterPos: [number, number, number];
  crosshairErrorDeg: number;
  wasEnemyInFov: boolean;
  shotBeforeStop: boolean;
  /** Killer's horizontal speed (u/s) at the tick the killing shot was fired. */
  killerSpeedAtShot: number;
  /** Counter-strafe quality 0.0–1.0, or -1.0 when player was already stationary. */
  counterStrafeScore: number;
  /** True when the killer was moving (> 50 u/s) in the ticks before the shot. */
  wasMovingBeforeShot: boolean;
  hasPosData: boolean;
  playerIsKiller: boolean;
  mapName: string;
  debugInfo?: string;
}

export type StatusMessage =
  | { type: "success"; message: string }
  | { type: "error"; message: string }
  | { type: "info"; message: string }
  | null;

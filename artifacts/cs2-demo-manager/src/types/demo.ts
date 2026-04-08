
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

export type StatusMessage =
  | { type: "success"; message: string }
  | { type: "error"; message: string }
  | { type: "info"; message: string }
  | null;

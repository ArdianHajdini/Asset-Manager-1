/**
 * Tauri bridge — detects whether the app is running inside a Tauri desktop window
 * and provides typed wrappers around `invoke()`. Falls back gracefully in browser mode.
 *
 * Usage:
 *   import { isTauri, invokeCommand } from './tauriBridge';
 */

import type { Demo } from "../types/demo";

// ─────────────────────────────────────────
//  Environment detection
// ─────────────────────────────────────────

/** True when running inside a Tauri native window. */
export const isTauri = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

/** Dynamically import Tauri's invoke only when needed. */
async function getInvoke() {
  if (!isTauri()) throw new Error("Not in Tauri environment");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

// ─────────────────────────────────────────
//  Typed command wrappers
// ─────────────────────────────────────────

export interface TauriDemoEntry {
  filename: string;
  displayName: string;
  filepath: string;
  directory: string;
  size: number;
  modifiedAt: string;
}

export interface TauriLaunchResult {
  status: "launched" | "clipboard_fallback";
  command?: string;
  method?: "steam_handoff" | "steam_uri" | "direct_cs2" | "none";
  note?: string;
}

/** Scan a directory for .dem files and return metadata. */
export async function tauriListDemos(directory: string): Promise<TauriDemoEntry[]> {
  const invoke = await getInvoke();
  return invoke<TauriDemoEntry[]>("list_demos", { directory });
}

/**
 * Import a demo file into the demo library directory.
 * Handles .dem.gz decompression automatically when extractGz is true.
 */
export async function tauriImportDemo(
  sourcePath: string,
  destDir: string,
  extractGz: boolean
): Promise<TauriDemoEntry> {
  const invoke = await getInvoke();
  return invoke<TauriDemoEntry>("import_demo", {
    sourcePath,
    destDir,
    extractGz,
  });
}

/** Delete a demo file from the filesystem. */
export async function tauriDeleteDemoFile(filepath: string): Promise<void> {
  const invoke = await getInvoke();
  return invoke("delete_demo_file", { filepath });
}

/** Rename a demo file on disk. Returns the new filepath. */
export async function tauriRenameDemoFile(
  filepath: string,
  newName: string
): Promise<string> {
  const invoke = await getInvoke();
  return invoke<string>("rename_demo_file", { filepath, newName });
}

/** Open a folder (or the parent folder of a file) in the OS file manager. */
export async function tauriOpenFolder(path: string): Promise<void> {
  const invoke = await getInvoke();
  return invoke("open_folder", { path });
}

/**
 * Launch CS2 with a relative playdemo argument.
 * playdemoArg should be in the form "replays/mydemo" (no .dem extension).
 * CS2 resolves this relative to its csgo game directory.
 */
export async function tauriLaunchCS2(
  cs2ExePath: string,
  playdemoArg: string,
): Promise<TauriLaunchResult> {
  const invoke = await getInvoke();
  return invoke<TauriLaunchResult>("launch_cs2", { cs2ExePath, playdemoArg });
}

/**
 * Given the Steam root path, derive and create the CS2 replay folder if needed.
 * Returns the absolute path to <Steam>/steamapps/.../game/csgo/replays.
 */
export async function tauriGetReplayFolder(steamPath: string): Promise<string> {
  const invoke = await getInvoke();
  return invoke<string>("get_replay_folder", { steamPath });
}

/** Check whether the given cs2.exe path actually exists. */
export async function tauriCheckCS2Path(cs2Path: string): Promise<boolean> {
  const invoke = await getInvoke();
  return invoke<boolean>("check_cs2_path", { cs2Path });
}

/** Attempt to auto-detect the Steam installation path. Returns null if not found. */
export async function tauriDetectSteamPath(): Promise<string | null> {
  const invoke = await getInvoke();
  return invoke<string | null>("detect_steam_path");
}

/** Scan a folder for demo files (.dem, .dem.gz, .dem.zst). */
export async function tauriScanDownloads(directory: string): Promise<TauriDemoEntry[]> {
  const invoke = await getInvoke();
  return invoke<TauriDemoEntry[]>("scan_downloads", { directory });
}

/** Detect the Windows Downloads folder for the current user. */
export async function tauriDetectDownloadsFolder(): Promise<string | null> {
  const invoke = await getInvoke();
  return invoke<string | null>("detect_downloads_folder");
}

/** Get file metadata for a specific demo path. */
export async function tauriGetFileInfo(filepath: string): Promise<TauriDemoEntry> {
  const invoke = await getInvoke();
  return invoke<TauriDemoEntry>("get_file_info", { filepath });
}

/**
 * Check whether CS2 is currently running as a process.
 * Windows: queries tasklist for cs2.exe.
 * Returns false if the check fails (e.g. permission denied).
 */
export async function tauriIsCS2Running(): Promise<boolean> {
  const invoke = await getInvoke();
  return invoke<boolean>("is_cs2_running");
}

// ─────────────────────────────────────────
//  Demo Player Parser
// ─────────────────────────────────────────

/** A player entry returned by the Rust PBDEMS2 parser. */
export interface TauriDemoPlayer {
  /** Steam ID64 as a string (avoids JS number precision loss for large u64 values). */
  xuid: string;
  name: string;
  /** 2 = Terrorist, 3 = Counter-Terrorist, 0 = unassigned/spectator */
  teamNum: number;
  isHltv: boolean;
  /**
   * voice_mute slot index from the demo's userinfo string table.
   * Present when the CDemoStringTables packet was successfully parsed.
   * Pass this value directly to CS2's `voice_mute <entityId>` console command.
   * Absent when the slot could not be determined (fall back to player-list display).
   */
  entityId?: number;
}

/**
 * Parse a CS2 .dem file and return the list of players found in it.
 * Reads the CDemoFileInfo protobuf from the PBDEMS2 header — no external crates needed.
 * Returns an empty array if no players are found (e.g. corrupted demo).
 * Throws a string error if the file is not a valid CS2 demo.
 */
export async function tauriParseDemoPlayers(filepath: string): Promise<TauriDemoPlayer[]> {
  const invoke = await getInvoke();
  return invoke<TauriDemoPlayer[]>("parse_demo_players", { filepath });
}

/**
 * Convert a TauriDemoEntry to the app's Demo type (adds a placeholder id).
 * The actual id is assigned by the frontend storage layer.
 */
export function tauriEntryToDemo(entry: TauriDemoEntry): Omit<Demo, "id"> {
  return {
    filename: entry.filename,
    displayName: entry.displayName,
    filepath: entry.filepath,
    directory: entry.directory,
    size: entry.size,
    modifiedAt: entry.modifiedAt,
  };
}

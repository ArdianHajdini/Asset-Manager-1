/**
 * cs2Service.ts — CS2 and Steam integration.
 *
 * Launch flow (correct CS2 behavior):
 *   CS2's playdemo command accepts RELATIVE paths from its working directory.
 *   The working directory is: <Steam>/steamapps/common/Counter-Strike Global
 *   Offensive/game/csgo/
 *   The replays folder lives inside that as "replays/".
 *
 *   Correct command: playdemo replays/mydemo   (no .dem extension)
 *   Wrong (old):     playdemo "C:\CS2Demos\mydemo.dem"
 *
 * What was wrong before this fix:
 *   - detect_steam_path returned the cs2.exe path, not the Steam root → auto-detect broken
 *   - launch_cs2 passed full absolute Windows paths to +playdemo → CS2 ignored them
 *   - Default demoDirectory was C:\CS2Demos → demos never reachable via playdemo
 *
 * Now:
 *   - detect_steam_path returns the Steam root directory
 *   - Demos are saved into <Steam>/…/csgo/replays (the CS2 replay folder)
 *   - playdemo argument is always "replays/FILENAME_WITHOUT_EXT"
 */

import type { CS2Status } from "../types/demo";
import {
  isTauri,
  tauriLaunchCS2,
  tauriCheckCS2Path,
  tauriDetectSteamPath,
  tauriGetReplayFolder,
} from "./tauriBridge";

// ─────────────────────────────────────────
//  Path constants
// ─────────────────────────────────────────

/** Relative path from Steam root to cs2.exe */
export const CS2_EXE_RELATIVE =
  "steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe";

/** Relative path from Steam root to the CS2 replay folder */
export const CS2_REPLAY_RELATIVE =
  "steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\replays";

export const COMMON_STEAM_PATHS = [
  "C:\\Program Files (x86)\\Steam",
  "C:\\Program Files\\Steam",
  "D:\\Steam",
  "E:\\Steam",
];

// ─────────────────────────────────────────
//  Status helpers
// ─────────────────────────────────────────

export function getCS2Status(cs2Path: string): CS2Status {
  if (!cs2Path || cs2Path.trim() === "") return "unknown";
  if (cs2Path.toLowerCase().endsWith(".exe")) return "found";
  return "not_found";
}

export async function verifyCS2PathExists(cs2Path: string): Promise<boolean> {
  if (!cs2Path) return false;
  if (isTauri()) {
    try {
      return await tauriCheckCS2Path(cs2Path);
    } catch {
      return false;
    }
  }
  return cs2Path.toLowerCase().endsWith(".exe");
}

// ─────────────────────────────────────────
//  Auto-detection
// ─────────────────────────────────────────

/**
 * Detect Steam root, derive cs2.exe path and the CS2 replay folder.
 * Returns null if Steam / CS2 not found.
 */
export async function detectCS2Path(): Promise<{
  steamPath: string;
  cs2Path: string;
  replayFolder: string;
} | null> {
  if (!isTauri()) return null;
  try {
    const steamPath = await tauriDetectSteamPath(); // now returns Steam root
    if (!steamPath) return null;
    const cs2Path = `${steamPath}\\${CS2_EXE_RELATIVE}`;
    const replayFolder = await tauriGetReplayFolder(steamPath);
    return { steamPath, cs2Path, replayFolder };
  } catch {
    return null;
  }
}

/**
 * Given a Steam root path, create and return the CS2 replay folder.
 * Returns null if unavailable (browser or error).
 */
export async function detectReplayFolder(steamPath: string): Promise<string | null> {
  if (!isTauri() || !steamPath) return null;
  try {
    return await tauriGetReplayFolder(steamPath);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────
//  Clipboard
// ─────────────────────────────────────────

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────
//  Demo launch helpers
// ─────────────────────────────────────────

/**
 * Build the relative playdemo argument for a demo filename.
 * CS2 resolves this relative to its csgo working directory.
 *
 * "mydemo.dem"  →  "replays/mydemo"
 * "FACEIT_de_dust2_abc12345.dem"  →  "replays/FACEIT_de_dust2_abc12345"
 */
export function buildPlaydemoArg(filename: string): string {
  const base = filename.replace(/\.dem$/i, "");
  return `replays/${base}`;
}

/**
 * Build the CS2 console command shown in the manual fallback UI.
 * Accepts the playdemo arg (from buildPlaydemoArg).
 *
 * Example output: "playdemo replays/mydemo"
 */
export function buildPlaydemoCommand(playdemoArg: string): string {
  return `playdemo ${playdemoArg}`;
}

export function buildSteamLaunchUri(playdemoArg: string): string {
  return `steam://rungame/730/0/+playdemo+"${playdemoArg}"`;
}

/**
 * Launch CS2 with the given demo.
 *
 * @param demoFilename  The .dem filename (e.g. "mydemo.dem").
 *                      The relative playdemo arg is derived automatically.
 * @param cs2Path       Full path to cs2.exe.
 *
 * In Tauri (desktop):
 *   - Launches cs2.exe with +playdemo replays/FILENAME
 *   - Returns "clipboard_fallback" with the console command if launch fails
 *
 * In browser:
 *   - Opens Steam URI steam://rungame/730/... via window.open
 *   - Falls back to clipboard copy of playdemo command
 */
export async function launchDemoInCS2(
  demoFilename: string,
  cs2Path: string
): Promise<"launched" | "clipboard_fallback"> {
  const playdemoArg = buildPlaydemoArg(demoFilename);

  if (isTauri()) {
    try {
      const result = await tauriLaunchCS2(cs2Path, playdemoArg);
      if (result.status === "launched") return "launched";
      if (result.command) {
        await copyToClipboard(result.command);
      }
      return "clipboard_fallback";
    } catch {
      await copyToClipboard(buildPlaydemoCommand(playdemoArg));
      return "clipboard_fallback";
    }
  }

  // Browser fallback — try Steam URI
  try {
    window.open(buildSteamLaunchUri(playdemoArg), "_blank");
    return "launched";
  } catch {
    await copyToClipboard(buildPlaydemoCommand(playdemoArg));
    return "clipboard_fallback";
  }
}

/**
 * cs2Service.ts — CS2 and Steam integration.
 *
 * When running inside Tauri (desktop): uses real Rust commands via tauriBridge.
 * When running in a browser: uses window.open() Steam URI with clipboard fallback.
 */

import type { CS2Status } from "../types/demo";
import { isTauri, tauriLaunchCS2, tauriCheckCS2Path, tauriDetectSteamPath } from "./tauriBridge";

export const CS2_EXE_RELATIVE =
  "steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe";

export const COMMON_STEAM_PATHS = [
  "C:\\Program Files (x86)\\Steam",
  "C:\\Program Files\\Steam",
  "D:\\Steam",
  "E:\\Steam",
];

// ─────────────────────────────────────────
//  Status helpers
// ─────────────────────────────────────────

/**
 * Determine if CS2 appears to be configured.
 * - "found"     → path is set and ends with .exe
 * - "not_found" → path is set but doesn't look valid
 * - "unknown"   → no path configured yet
 */
export function getCS2Status(cs2Path: string): CS2Status {
  if (!cs2Path || cs2Path.trim() === "") return "unknown";
  if (cs2Path.toLowerCase().endsWith(".exe")) return "found";
  return "not_found";
}

/**
 * When running in Tauri, actually checks whether the file exists on disk.
 * Falls back to string-based heuristic in browser mode.
 */
export async function verifyCS2PathExists(cs2Path: string): Promise<boolean> {
  if (!cs2Path) return false;
  if (isTauri()) {
    try {
      return await tauriCheckCS2Path(cs2Path);
    } catch {
      return false;
    }
  }
  // Browser fallback: just check the string looks valid
  return cs2Path.toLowerCase().endsWith(".exe");
}

// ─────────────────────────────────────────
//  Auto-detection
// ─────────────────────────────────────────

/**
 * Attempt to auto-detect Steam and CS2 paths.
 * In Tauri: asks the Rust backend to scan the filesystem.
 * In browser: always returns null (no filesystem access).
 */
export async function detectCS2Path(): Promise<{
  steamPath: string;
  cs2Path: string;
} | null> {
  if (!isTauri()) return null;
  try {
    const steamPath = await tauriDetectSteamPath();
    if (!steamPath) return null;
    const cs2Path = `${steamPath}\\${CS2_EXE_RELATIVE}`;
    return { steamPath, cs2Path };
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
//  Demo launch
// ─────────────────────────────────────────

export function buildPlaydemoCommand(demoFilepath: string): string {
  return `playdemo "${demoFilepath}"`;
}

export function buildSteamLaunchUri(demoFilepath: string): string {
  return `steam://rungame/730/0/+playdemo+"${demoFilepath}"`;
}

/**
 * Launch CS2 with the given demo file.
 *
 * In Tauri (desktop):
 *   1. Tries Steam URI via OS URL handler
 *   2. Tries cs2.exe directly with +playdemo argument
 *   3. Returns "clipboard_fallback" so the UI shows manual steps
 *
 * In browser:
 *   1. Tries window.open() with Steam URI
 *   2. Falls back to clipboard
 *
 * Returns "launched" or "clipboard_fallback".
 */
export async function launchDemoInCS2(
  demoFilepath: string,
  cs2Path: string
): Promise<"launched" | "clipboard_fallback"> {
  if (isTauri()) {
    try {
      const result = await tauriLaunchCS2(cs2Path, demoFilepath);
      if (result.status === "launched") return "launched";
      // Copy the command to clipboard as part of the fallback
      if (result.command) {
        await copyToClipboard(result.command);
      }
      return "clipboard_fallback";
    } catch {
      await copyToClipboard(buildPlaydemoCommand(demoFilepath));
      return "clipboard_fallback";
    }
  }

  // Browser fallback — try Steam URI via window.open
  try {
    window.open(buildSteamLaunchUri(demoFilepath), "_blank");
    return "launched";
  } catch {
    await copyToClipboard(buildPlaydemoCommand(demoFilepath));
    return "clipboard_fallback";
  }
}

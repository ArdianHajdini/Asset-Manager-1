/**
 * cs2Service.ts — CS2 and Steam integration.
 *
 * Launch flow:
 *   CS2's playdemo command accepts RELATIVE paths from its working directory.
 *   The working directory is: <Steam>/steamapps/common/Counter-Strike Global
 *   Offensive/game/csgo/
 *   The replays folder lives inside that as "replays/".
 *
 *   Correct command: playdemo replays/mydemo   (no .dem extension)
 *
 * Native launch hierarchy (Tauri / Windows desktop app):
 *   PRIMARY   → Rust finds steam.exe via Windows Registry
 *               (HKLM\SOFTWARE\WOW6432Node\Valve\Steam → InstallPath) and runs:
 *               steam.exe -applaunch 730 +playdemo replays/<name>
 *               Registry lookup works even when CS2 is on a secondary drive (D:\SteamLibrary).
 *   FALLBACK1 → Rust opens CS2 via Steam URI *without* +playdemo:
 *               cmd /C start "" "steam://rungameid/730"
 *               Steam protocol cannot reliably pass +commands; clipboard is the fallback.
 *   FALLBACK2 → Rust spawns cs2.exe directly with current_dir set to .../game/csgo
 *               so relative replays/<name> paths resolve correctly.
 *   LAST      → returns "clipboard_fallback" — frontend copies the console cmd.
 *
 * Browser (dev preview only):
 *   Opens the Steam URI via window.open. Falls back to clipboard copy.
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
    const steamPath = await tauriDetectSteamPath();
    if (!steamPath) return null;
    const cs2Path = `${steamPath}\\${CS2_EXE_RELATIVE}`;
    const replayFolder = await tauriGetReplayFolder(steamPath);
    return { steamPath, cs2Path, replayFolder };
  } catch {
    return null;
  }
}

/**
 * Given a Steam root path, return the CS2 replay folder path.
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
 */
export function buildPlaydemoArg(filename: string): string {
  const base = filename.replace(/\.dem$/i, "");
  return `replays/${base}`;
}

/**
 * Build the CS2 console command for manual fallback.
 * Example: "playdemo replays/mydemo"
 */
export function buildPlaydemoCommand(playdemoArg: string): string {
  return `playdemo ${playdemoArg}`;
}

/**
 * Build the correct Steam URI for launching CS2 with a demo.
 *
 * Correct format: steam://rungameid/730//+playdemo%20replays/<name>
 *   - rungameid  (NOT rungame — rungame is the legacy/wrong variant)
 *   - 730//      (double slash = empty user-id field, NOT 730/0/)
 *   - %20 instead of a literal space — a literal space causes cmd.exe
 *     and ShellExecute to split the URI, losing the demo name argument
 */
export function buildSteamLaunchUri(playdemoArg: string): string {
  return `steam://rungameid/730//+playdemo%20${playdemoArg}`;
}

export type LaunchOutcome = {
  status: "launched" | "clipboard_fallback";
  method?: string;
  note?: string;
  command?: string;
  consoleCmd: string;
  steamUri: string;
};

/**
 * Launch CS2 with the given demo.
 *
 * @param demoFilename  The .dem filename (e.g. "mydemo.dem").
 * @param cs2Path       Full path to cs2.exe.
 * @returns             Structured LaunchOutcome with status, method, and debug info.
 */
export async function launchDemoInCS2(
  demoFilename: string,
  cs2Path: string
): Promise<LaunchOutcome> {
  const playdemoArg = buildPlaydemoArg(demoFilename);
  const consoleCmd = buildPlaydemoCommand(playdemoArg);
  const steamUri = buildSteamLaunchUri(playdemoArg);

  console.log("[CS2DM] Launch:", {
    demoFilename,
    playdemoArg,
    steamUri,
    consoleCmd,
    cs2Path,
    mode: isTauri() ? "tauri" : "browser",
  });

  if (isTauri()) {
    try {
      console.log("[CS2DM] Calling Rust launch_cs2...");
      const result = await tauriLaunchCS2(cs2Path, playdemoArg);
      console.log("[CS2DM] Rust result:", result);

      if (result.status === "clipboard_fallback") {
        const cmd = result.command ?? consoleCmd;
        await copyToClipboard(cmd);
        console.log("[CS2DM] Clipboard fallback, copied:", cmd);
      }

      return {
        status: result.status,
        method: result.method,
        note: result.note,
        command: result.command,
        consoleCmd,
        steamUri,
      };
    } catch (err) {
      console.error("[CS2DM] Launch error:", err);
      await copyToClipboard(consoleCmd);
      return {
        status: "clipboard_fallback",
        method: "none",
        note: "Tauri-Aufruf fehlgeschlagen. Bitte CS2 manuell starten.",
        consoleCmd,
        steamUri,
      };
    }
  }

  // Browser mode: open Steam URI via window.open
  console.log("[CS2DM] Browser mode, opening Steam URI:", steamUri);
  try {
    window.open(steamUri, "_blank");
    return { status: "launched", method: "browser_uri", consoleCmd, steamUri };
  } catch {
    await copyToClipboard(consoleCmd);
    return { status: "clipboard_fallback", method: "none", consoleCmd, steamUri };
  }
}

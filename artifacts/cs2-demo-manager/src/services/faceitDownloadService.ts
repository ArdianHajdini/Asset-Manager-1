/**
 * faceitDownloadService.ts — Download, extract, and register FACEIT demo files.
 *
 * Full download flow:
 *   1. Fetch match details to get demo_url[]
 *   2. Start download (Tauri: Rust command; browser: window.open fallback)
 *   3. Rust backend extracts .dem.zst or .dem.gz → .dem automatically
 *   4. Save to configured demo folder
 *   5. Register in the local demo library
 *
 * In browser-only mode (no Tauri): downloads are triggered via window.open /
 * anchor download. The file is NOT automatically added to the library.
 * This is a hard limitation of the browser environment.
 */

import { v4 as uuidv4 } from "uuid";
import type { FaceitConnection } from "../types/faceit";
import type { FaceitMatch } from "../types/faceit";
import type { Demo } from "../types/demo";
import { getMatchDetails } from "./faceitMatchService";
import { isTauri } from "./tauriBridge";
import { loadDemos, saveDemos } from "./storage";

// ─────────────────────────────────────────
//  Progress callback
// ─────────────────────────────────────────

export type ProgressCallback = (phase: "downloading" | "extracting" | "saving", percent?: number) => void;

// ─────────────────────────────────────────
//  Demo URL resolution
// ─────────────────────────────────────────

/**
 * Get the demo download URL for a match.
 * Loads match details if `match` is not yet passed, or uses the cached match.
 * Returns null if no demo is available.
 */
export async function resolveDemoUrl(
  matchId: string,
  conn: FaceitConnection,
  cachedMatch?: FaceitMatch
): Promise<string | null> {
  const match = cachedMatch ?? (await getMatchDetails(matchId, conn));
  if (!match.demo_url || match.demo_url.length === 0) return null;
  return match.demo_url[0]; // Use the first available demo URL
}

// ─────────────────────────────────────────
//  Filename helpers
// ─────────────────────────────────────────

/** Derive a clean filename from a demo URL (strips query params). */
export function demoFilenameFromUrl(url: string, matchId: string): string {
  try {
    const pathname = new URL(url).pathname;
    const raw = pathname.split("/").pop() ?? "";
    if (raw.endsWith(".dem") || raw.endsWith(".dem.gz") || raw.endsWith(".dem.zst")) return raw;
  } catch {
    // URL parsing failed — use matchId fallback
  }
  return `faceit_${matchId}.dem.zst`;
}

/** Display name for a downloaded FACEIT demo. */
export function demoDisplayName(matchId: string, mapName?: string | null): string {
  const map = mapName ?? "unknown";
  const short = matchId.slice(0, 8);
  return `FACEIT_${map}_${short}`;
}

// ─────────────────────────────────────────
//  Main download function (Tauri)
// ─────────────────────────────────────────

/**
 * Download a FACEIT demo into the local demo library.
 *
 * In Tauri (desktop):
 *   - Calls the Rust `download_demo` command which handles the HTTP download,
 *     .gz extraction, and disk write.
 *   - Registers the result in the local library.
 *   - Returns the saved Demo object.
 *
 * In browser mode:
 *   - Falls back to triggering a browser download via an anchor element.
 *   - Returns null — the file is NOT automatically added to the library.
 */
export async function downloadFaceitDemo(
  matchId: string,
  demoUrl: string,
  destDir: string,
  displayName: string,
  onProgress?: ProgressCallback
): Promise<Demo | null> {
  // Block download if no target directory is configured (Tauri only — browser
  // mode always downloads to the browser's Downloads folder).
  if (isTauri() && !destDir) {
    throw new Error(
      "Kein CS2 Replay-Ordner konfiguriert. Bitte die Einstellungen öffnen und CS2 automatisch erkennen lassen."
    );
  }

  const rawFilename = demoFilenameFromUrl(demoUrl, matchId);

  if (!isTauri()) {
    // Browser fallback: trigger browser download
    onProgress?.("downloading", 0);
    const a = document.createElement("a");
    a.href = demoUrl;
    a.download = rawFilename;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    onProgress?.("downloading", 100);
    // Cannot register in library since we don't control where the browser saves the file
    return null;
  }

  // ── Tauri path: call Rust download_demo command ──────────────────────────
  onProgress?.("downloading", 0);
  const { invoke } = await import("@tauri-apps/api/core");

  const entry = await invoke<{
    filename: string;
    displayName: string;
    filepath: string;
    directory: string;
    size: number;
    modifiedAt: string;
  }>("download_demo", {
    url: demoUrl,
    destDir,
    filename: rawFilename,
  });

  onProgress?.("saving", 100);

  // Register in library
  const demo: Demo = {
    id: uuidv4(),
    filename: entry.filename,
    displayName,
    filepath: entry.filepath,
    directory: entry.directory,
    size: entry.size,
    modifiedAt: entry.modifiedAt,
  };

  const demos = loadDemos();
  const existingIdx = demos.findIndex((d) => d.filepath === demo.filepath);
  if (existingIdx !== -1) {
    demos[existingIdx] = { ...demo, id: demos[existingIdx].id };
  } else {
    demos.unshift(demo);
  }
  saveDemos(demos);

  return existingIdx !== -1 ? { ...demo, id: demos[existingIdx].id } : demo;
}

// ─────────────────────────────────────────
//  Check if a match demo is already in the library
// ─────────────────────────────────────────

/**
 * Returns the Demo entry if a demo for this matchId is already downloaded,
 * or null if not found.
 */
export function findDownloadedDemo(matchId: string): Demo | null {
  const demos = loadDemos();
  return demos.find((d) => d.filepath?.includes(matchId) || d.displayName?.includes(matchId.slice(0, 8))) ?? null;
}

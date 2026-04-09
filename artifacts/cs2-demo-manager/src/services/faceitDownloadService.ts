/**
 * faceitDownloadService.ts — Demo library helpers for FACEIT matches.
 *
 * Strategy (new): the user opens the FACEIT match page in the browser and
 * downloads the demo manually from there. The app then scans the Downloads
 * folder (downloadsService.ts) to detect and process newly downloaded demos.
 *
 * Direct demo-download logic has been intentionally removed:
 *  - No signed/private download URL fetching
 *  - No download_demo Tauri command invocation
 *  - No browser-anchor fallback download
 *
 * What this file provides:
 *  - faceitMatchUrl()     — build the FACEIT match page URL
 *  - demoDisplayName()    — human-readable label for a FACEIT demo entry
 *  - findDownloadedDemo() — check if a demo for a match is already in the library
 */

import type { Demo } from "../types/demo";
import { loadDemos } from "./storage";

// ─────────────────────────────────────────
//  URL helpers
// ─────────────────────────────────────────

/**
 * Build the FACEIT match page URL.
 * Uses the faceit_url from the API response when available,
 * otherwise constructs a canonical URL from the match ID.
 */
export function faceitMatchUrl(matchId: string, faceitUrl?: string | null): string {
  if (faceitUrl) return faceitUrl;
  return `https://www.faceit.com/en/cs2/room/${matchId}`;
}

// ─────────────────────────────────────────
//  Display name
// ─────────────────────────────────────────

/** Human-readable display name for a FACEIT demo entry. */
export function demoDisplayName(matchId: string, mapName?: string | null): string {
  const map = mapName ?? "unknown";
  const short = matchId.slice(0, 8);
  return `FACEIT_${map}_${short}`;
}

// ─────────────────────────────────────────
//  Library lookup
// ─────────────────────────────────────────

/**
 * Returns the Demo entry if a demo for this matchId is already in the local
 * library (i.e. was previously scanned from the Downloads folder), or null.
 */
export function findDownloadedDemo(matchId: string): Demo | null {
  const demos = loadDemos();
  return (
    demos.find(
      (d) =>
        d.filepath?.includes(matchId) ||
        d.displayName?.includes(matchId.slice(0, 8))
    ) ?? null
  );
}

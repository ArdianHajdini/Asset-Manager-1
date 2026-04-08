/**
 * downloadsService.ts — Downloads-Ordner scannen und Demos verarbeiten.
 *
 * Erkennt .dem, .dem.gz und .dem.zst Dateien im konfigurierten Downloads-Ordner,
 * entpackt sie bei Bedarf (via Rust) und verschiebt/kopiert sie in den CS2 Replay-Ordner.
 *
 * Nur in Tauri (Desktop) verfügbar — gibt im Browser immer ein leeres Ergebnis zurück.
 *
 * Windows-Standardpfad für Downloads:
 *   C:\Users\<Name>\Downloads
 *   Erkannt über die USERPROFILE-Umgebungsvariable (via Rust detect_downloads_folder).
 */

import { v4 as uuidv4 } from "uuid";
import type { Demo } from "../types/demo";
import { loadDemos, saveDemos } from "./storage";
import {
  isTauri,
  tauriScanDownloads,
  tauriImportDemo,
  tauriEntryToDemo,
} from "./tauriBridge";

// ─────────────────────────────────────────
//  Types
// ─────────────────────────────────────────

export interface DownloadCandidate {
  filename: string;
  filepath: string;
  directory: string;
  size: number;
  modifiedAt: string;
  /** true = file needs extraction before use as a demo */
  needsExtraction: boolean;
}

export interface ScanResult {
  candidates: DownloadCandidate[];
  errors: string[];
}

export interface ProcessResult {
  processed: Demo[];
  skipped: string[];
  errors: string[];
}

// ─────────────────────────────────────────
//  Scan
// ─────────────────────────────────────────

/**
 * Scan a folder for demo files (.dem, .dem.gz, .dem.zst).
 * Returns an empty result in browser mode.
 */
export async function scanDownloadsFolder(folder: string): Promise<ScanResult> {
  if (!isTauri() || !folder) {
    return { candidates: [], errors: [] };
  }

  try {
    const entries = await tauriScanDownloads(folder);
    const candidates: DownloadCandidate[] = entries.map((e) => ({
      filename: e.filename,
      filepath: e.filepath,
      directory: e.directory,
      size: e.size,
      modifiedAt: e.modifiedAt,
      needsExtraction:
        e.filename.endsWith(".dem.gz") ||
        e.filename.endsWith(".dem.zst") ||
        e.filename.endsWith(".gz") ||
        e.filename.endsWith(".zst"),
    }));
    return { candidates, errors: [] };
  } catch (err) {
    return { candidates: [], errors: [String(err)] };
  }
}

// ─────────────────────────────────────────
//  Process
// ─────────────────────────────────────────

/**
 * Process (extract + copy) a list of demo candidates into the CS2 replay folder.
 * Already-existing demos are skipped.
 */
export async function processCandidates(
  candidates: DownloadCandidate[],
  replayFolder: string
): Promise<ProcessResult> {
  const result: ProcessResult = { processed: [], skipped: [], errors: [] };

  if (!isTauri() || !replayFolder) {
    result.errors.push("Kein Replay-Ordner konfiguriert oder Tauri nicht verfügbar.");
    return result;
  }

  const existingDemos = loadDemos();

  for (const candidate of candidates) {
    // Skip if a demo with same source path is already in the library
    const alreadyInLibrary = existingDemos.some(
      (d) =>
        d.filename === candidate.filename.replace(/\.(gz|zst)$/, "").replace(/\.dem\./, ".").replace(/^.*\.dem$/, (m) => m) ||
        d.filepath.endsWith(candidate.filename.replace(/\.(gz|zst)$/, ""))
    );

    if (alreadyInLibrary) {
      result.skipped.push(candidate.filename);
      continue;
    }

    try {
      const entry = await tauriImportDemo(
        candidate.filepath,
        replayFolder,
        candidate.needsExtraction
      );
      const demoBase = tauriEntryToDemo(entry);
      const demo: Demo = { ...demoBase, id: uuidv4() };

      // Update library
      const demos = loadDemos();
      const idx = demos.findIndex((d) => d.filepath === demo.filepath);
      if (idx !== -1) {
        demos[idx] = demo;
      } else {
        demos.unshift(demo);
      }
      saveDemos(demos);
      result.processed.push(demo);
    } catch (err) {
      result.errors.push(`${candidate.filename}: ${String(err)}`);
    }
  }

  return result;
}

// ─────────────────────────────────────────
//  Default path detection
// ─────────────────────────────────────────

/**
 * Attempt to guess the Windows Downloads folder path.
 * Returns a best-guess string — the user can override in settings.
 * In Tauri, the Rust side knows USERPROFILE. In browser, returns empty.
 */
export function guessWindowsDownloadsFolder(): string {
  // In Tauri: the Rust detect_steam_path already reads env vars.
  // The frontend does not have access to process.env on Windows — just return a hint.
  return "";
}

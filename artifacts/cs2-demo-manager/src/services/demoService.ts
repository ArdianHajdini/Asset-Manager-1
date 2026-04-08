/**
 * demoService.ts — Demo file management.
 *
 * When running in Tauri (desktop): uses real filesystem operations via Rust commands.
 * When running in a browser: falls back to localStorage-only management.
 */

import { v4 as uuidv4 } from "uuid";
import type { Demo } from "../types/demo";
import { loadDemos, saveDemos } from "./storage";
import {
  isTauri,
  tauriListDemos,
  tauriImportDemo,
  tauriDeleteDemoFile,
  tauriRenameDemoFile,
  tauriOpenFolder,
  tauriEntryToDemo,
} from "./tauriBridge";

// ─────────────────────────────────────────
//  Formatting helpers
// ─────────────────────────────────────────

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─────────────────────────────────────────
//  Library sync
// ─────────────────────────────────────────

/**
 * Load demos from the configured directory (Tauri) or from localStorage (browser).
 * In Tauri mode, the filesystem is the source of truth. localStorage just caches
 * display names for renamed demos.
 */
export async function loadDemosFromDisk(demoDirectory: string): Promise<Demo[]> {
  if (!isTauri()) {
    // Browser mode: return what's in localStorage
    return loadDemos();
  }

  try {
    const entries = await tauriListDemos(demoDirectory);
    const cached = loadDemos(); // for display names from renames

    const demos: Demo[] = entries.map((entry) => {
      // Preserve custom display names set by the user
      const existing = cached.find((d) => d.filepath === entry.filepath);
      return {
        id: existing?.id ?? uuidv4(),
        filename: entry.filename,
        displayName: existing?.displayName ?? entry.displayName,
        filepath: entry.filepath,
        directory: entry.directory,
        size: entry.size,
        modifiedAt: entry.modifiedAt,
      };
    });

    // Persist to localStorage to preserve ids and custom names
    saveDemos(demos);
    return demos;
  } catch (err) {
    console.error("Failed to list demos from disk:", err);
    return loadDemos();
  }
}

// ─────────────────────────────────────────
//  Import
// ─────────────────────────────────────────

/**
 * Import a demo from a filesystem path (Tauri) or from a browser File object (browser).
 * Returns the newly created Demo.
 */
export async function importDemoFromPath(
  sourcePath: string,
  destDir: string,
  extractGz: boolean
): Promise<Demo> {
  const entry = await tauriImportDemo(sourcePath, destDir, extractGz);
  const demoBase = tauriEntryToDemo(entry);
  const demo: Demo = { ...demoBase, id: uuidv4() };

  // Add to localStorage
  const demos = loadDemos();
  const existingIdx = demos.findIndex((d) => d.filepath === demo.filepath);
  if (existingIdx !== -1) {
    demos[existingIdx] = demo;
  } else {
    demos.unshift(demo);
  }
  saveDemos(demos);
  return demo;
}

/**
 * Build a demo entry from a browser File object (fallback for non-Tauri environments).
 */
export function buildDemoFromFile(file: File, targetDir: string): Omit<Demo, "id"> {
  const name = file.name.replace(/\.(gz|zst)$/, "");
  const displayName = name.replace(/\.dem$/, "");
  return {
    filename: name,
    displayName,
    filepath: `${targetDir}\\${name}`,
    directory: targetDir,
    size: file.size,
    modifiedAt: new Date(file.lastModified).toISOString(),
  };
}

// ─────────────────────────────────────────
//  Library mutations
// ─────────────────────────────────────────

/** Add a demo to the library (localStorage), replacing any existing entry with the same path. */
export function addDemoToLibrary(demo: Omit<Demo, "id">): Demo[] {
  const demos = loadDemos();
  const existing = demos.findIndex((d) => d.filepath === demo.filepath);
  const newDemo: Demo = { ...demo, id: uuidv4() };
  if (existing !== -1) {
    demos[existing] = newDemo;
  } else {
    demos.unshift(newDemo);
  }
  saveDemos(demos);
  return loadDemos();
}

/**
 * Rename a demo — updates the display name in localStorage.
 * In Tauri mode, also renames the actual file on disk.
 */
export async function renameDemoFull(
  demos: Demo[],
  id: string,
  newName: string
): Promise<Demo[]> {
  const idx = demos.findIndex((d) => d.id === id);
  if (idx === -1) return demos;

  const demo = demos[idx];
  const updated = [...demos];

  if (isTauri() && demo.filepath) {
    try {
      // Rename the actual file on disk
      const newPath = await tauriRenameDemoFile(demo.filepath, newName);
      const newFilename = newPath.split(/[\\/]/).pop() ?? demo.filename;
      updated[idx] = {
        ...demo,
        displayName: newName,
        filename: newFilename,
        filepath: newPath,
      };
    } catch {
      // If rename fails, just update the display name in memory
      updated[idx] = { ...demo, displayName: newName };
    }
  } else {
    updated[idx] = { ...demo, displayName: newName };
  }

  saveDemos(updated);
  return updated;
}

/**
 * Delete a demo — removes it from localStorage.
 * In Tauri mode, also deletes the file from disk.
 */
export async function deleteDemoFull(
  demos: Demo[],
  id: string
): Promise<Demo[]> {
  const demo = demos.find((d) => d.id === id);
  const updated = demos.filter((d) => d.id !== id);
  saveDemos(updated);

  if (isTauri() && demo?.filepath) {
    try {
      await tauriDeleteDemoFile(demo.filepath);
    } catch {
      // File may not exist (e.g. moved externally) — not a fatal error
    }
  }

  return updated;
}

/**
 * Open the folder containing a demo in the OS file manager.
 * In Tauri: uses the real shell command.
 * In browser: shows the folder path (cannot open Explorer).
 */
export async function openDemoFolder(demo: Demo): Promise<void> {
  if (isTauri()) {
    return tauriOpenFolder(demo.directory);
  }
  // Browser fallback: nothing we can do — caller shows a toast
  throw new Error(`Ordner: ${demo.directory} (nur in der Desktop-App öffnungsbar)`);
}

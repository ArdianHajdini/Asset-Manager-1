
import type { Demo, AppSettings } from "../types/demo";

const DEMOS_KEY = "cs2dm_demos";
const SETTINGS_KEY = "cs2dm_settings";

export const DEFAULT_SETTINGS: AppSettings = {
  // Empty by default — the app auto-detects the CS2 replay folder on first launch.
  // Once detected: <Steam>/steamapps/common/Counter-Strike Global Offensive/game/csgo/replays
  demoDirectory: "",
  cs2Path: "",
  steamPath: "",
  autoExtractGz: true,
  autoAddToLibrary: true,
  // Downloads-Ordner: auto-detected from Windows USERPROFILE if left empty.
  // User can override in settings.
  downloadsFolder: "",
};

export function loadDemos(): Demo[] {
  try {
    const raw = localStorage.getItem(DEMOS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Demo[];
  } catch {
    return [];
  }
}

export function saveDemos(demos: Demo[]): void {
  localStorage.setItem(DEMOS_KEY, JSON.stringify(demos));
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

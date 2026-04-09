import type { TauriDemoPlayer } from "./tauriBridge";

/**
 * Module-level cache for parsed demo players.
 * Keyed by absolute filepath. Survives tab switches since the module
 * stays in memory for the lifetime of the app session.
 * Only parses a demo once — subsequent renders get instant results.
 */
const cache = new Map<string, TauriDemoPlayer[]>();

export function getCachedPlayers(filepath: string): TauriDemoPlayer[] | null {
  return cache.has(filepath) ? (cache.get(filepath) ?? null) : null;
}

export function setCachedPlayers(filepath: string, players: TauriDemoPlayer[]): void {
  cache.set(filepath, players);
}

export function invalidateCachedPlayers(filepath: string): void {
  cache.delete(filepath);
}

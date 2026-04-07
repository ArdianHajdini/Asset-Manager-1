/**
 * faceitMatchService.ts — Fetch CS2 match history and match details from the FACEIT API.
 *
 * All requests require a valid auth header (API key or OAuth token).
 * Use `getAuthHeader(connection)` from faceitAuthService to build it.
 *
 * FACEIT Data API base: https://open.faceit.com/data/v4
 */

import type { FaceitConnection } from "../types/faceit";
import type { FaceitHistoryItem, FaceitMatch, FaceitPlayer } from "../types/faceit";
import { getAuthHeader } from "./faceitAuthService";

const API_BASE = "https://open.faceit.com/data/v4";

// ─────────────────────────────────────────
//  Internal fetch helper
// ─────────────────────────────────────────

async function faceitFetch<T>(
  path: string,
  conn: FaceitConnection
): Promise<T> {
  const authHeader = getAuthHeader(conn);
  if (!authHeader) {
    throw new Error("Keine FACEIT-Verbindung. Bitte zuerst einloggen.");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: authHeader },
  });

  if (res.status === 401) {
    throw new Error("Authentifizierung fehlgeschlagen. Bitte erneut verbinden.");
  }
  if (res.status === 403) {
    throw new Error("Zugriff verweigert. Der API-Schlüssel hat keine Berechtigung für diese Daten.");
  }
  if (res.status === 404) {
    throw new Error("Spieler oder Match nicht gefunden.");
  }
  if (res.status === 429) {
    throw new Error("Zu viele Anfragen — FACEIT API Rate Limit erreicht. Bitte warte kurz.");
  }
  if (!res.ok) {
    throw new Error(`FACEIT API Fehler: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────
//  Player
// ─────────────────────────────────────────

/** Fetch full player data by nickname. */
export async function getPlayerByNickname(
  nickname: string,
  conn: FaceitConnection
): Promise<FaceitPlayer> {
  return faceitFetch<FaceitPlayer>(
    `/players?nickname=${encodeURIComponent(nickname)}&game=cs2`,
    conn
  );
}

/** Fetch full player data by player ID. */
export async function getPlayerById(
  playerId: string,
  conn: FaceitConnection
): Promise<FaceitPlayer> {
  return faceitFetch<FaceitPlayer>(`/players/${playerId}`, conn);
}

// ─────────────────────────────────────────
//  Match history
// ─────────────────────────────────────────

/** Fetch the most recent CS2 matches for a player. */
export async function getMatchHistory(
  playerId: string,
  conn: FaceitConnection,
  limit: number = 20,
  offset: number = 0
): Promise<{ items: FaceitHistoryItem[]; start: number; end: number }> {
  return faceitFetch<{ items: FaceitHistoryItem[]; start: number; end: number }>(
    `/players/${playerId}/history?game=cs2&limit=${limit}&offset=${offset}`,
    conn
  );
}

// ─────────────────────────────────────────
//  Match details
// ─────────────────────────────────────────

/** Fetch full match details including demo_url array. */
export async function getMatchDetails(
  matchId: string,
  conn: FaceitConnection
): Promise<FaceitMatch> {
  return faceitFetch<FaceitMatch>(`/matches/${matchId}`, conn);
}

// ─────────────────────────────────────────
//  Match helpers
// ─────────────────────────────────────────

/** Extract the picked map name from a match (e.g. "de_dust2"). */
export function getMatchMap(match: FaceitMatch | FaceitHistoryItem): string | null {
  if ("voting" in match && match.voting?.map?.pick?.length) {
    return match.voting.map.pick[0];
  }
  return null;
}

/** Human-readable map name (de_dust2 → Dust II). */
export function prettyMapName(rawMap: string | null): string {
  if (!rawMap) return "Unbekannte Map";
  const MAP_NAMES: Record<string, string> = {
    de_dust2: "Dust II",
    de_mirage: "Mirage",
    de_inferno: "Inferno",
    de_nuke: "Nuke",
    de_overpass: "Overpass",
    de_ancient: "Ancient",
    de_anubis: "Anubis",
    de_vertigo: "Vertigo",
    de_train: "Train",
    de_cache: "Cache",
    de_cobblestone: "Cobblestone",
  };
  return MAP_NAMES[rawMap] ?? rawMap;
}

/** Return "Won" or "Lost" from the perspective of the given player ID. */
export function getMatchResult(
  match: FaceitHistoryItem,
  playerId: string
): "win" | "loss" | "unknown" {
  if (!match.results) return "unknown";
  const faction1Players = match.teams.faction1.players.map((p) => p.player_id);
  const playerFaction = faction1Players.includes(playerId) ? "faction1" : "faction2";
  if (match.results.winner === playerFaction) return "win";
  if (match.results.winner) return "loss";
  return "unknown";
}

/** Get the opponent team for this player. */
export function getOpponentTeam(
  match: FaceitHistoryItem,
  playerId: string
): { nickname: string; players: { nickname: string }[] } {
  const inFaction1 = match.teams.faction1.players.some((p) => p.player_id === playerId);
  return inFaction1 ? match.teams.faction2 : match.teams.faction1;
}

/** Get the player's own team. */
export function getOwnTeam(
  match: FaceitHistoryItem,
  playerId: string
): { nickname: string; players: { nickname: string }[] } {
  const inFaction1 = match.teams.faction1.players.some((p) => p.player_id === playerId);
  return inFaction1 ? match.teams.faction1 : match.teams.faction2;
}

/** Format an epoch timestamp to a German locale date+time string. */
export function formatMatchDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Score string from the match result. */
export function getScoreString(
  match: FaceitHistoryItem,
  playerId: string
): string {
  if (!match.results) return "–";
  const inFaction1 = match.teams.faction1.players.some((p) => p.player_id === playerId);
  const { faction1, faction2 } = match.results.score;
  return inFaction1
    ? `${faction1} : ${faction2}`
    : `${faction2} : ${faction1}`;
}

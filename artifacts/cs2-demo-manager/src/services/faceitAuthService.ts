/**
 * faceitAuthService.ts — FACEIT account connection and authentication.
 *
 * Two auth methods are supported:
 *
 * 1. API Key  (works immediately — user provides their own FACEIT Data API key)
 *    • Get one at https://developers.faceit.com/
 *    • Scope: read-only data access, sufficient for match history + demo URLs
 *
 * 2. OAuth2 PKCE  (requires a FACEIT app CLIENT_ID from the developer portal)
 *    • Authorization URL: https://accounts.faceit.com/oauth/authorize
 *    • Token URL:         https://accounts.faceit.com/oauth/token
 *    • Scopes: openid profile membership
 *    • ⚠️  Cannot complete without a real CLIENT_ID — see faceit-integration-plan.md
 *
 * Connection state is persisted to localStorage.
 */

import type { FaceitConnection } from "../types/faceit";
import { isTauri, tauriOpenUrlExternally, tauriStartOAuthListener } from "./tauriBridge";

// ─────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────

const STORAGE_KEY = "cs2dm_faceit_connection";

const FACEIT_OAUTH_BASE = "https://accounts.faceit.com";
const FACEIT_TOKEN_URL = `${FACEIT_OAUTH_BASE}/oauth/token`;

/**
 * CLIENT_ID for OAuth2.
 * ⚠️  Must be set by the app developer in the FACEIT developer portal.
 *     Set via VITE_FACEIT_CLIENT_ID environment variable.
 */
export const FACEIT_CLIENT_ID: string = import.meta.env.VITE_FACEIT_CLIENT_ID ?? "";

/**
 * OAuth2 redirect URI.
 * In production Tauri: use a custom scheme, e.g. "cs2demo://auth/callback"
 * In browser dev:      current origin + "/faceit/callback"
 */
export function getOAuthRedirectUri(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}faceit/callback`.replace(/\/+$/, "");
}

// ─────────────────────────────────────────
//  PKCE helpers
// ─────────────────────────────────────────

/** Generate a cryptographically random URL-safe string (code_verifier). */
function generateCodeVerifier(): string {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** SHA-256 hash of the verifier, base64url-encoded (code_challenge). */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ─────────────────────────────────────────
//  Storage helpers
// ─────────────────────────────────────────

export function loadConnection(): FaceitConnection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FaceitConnection) : null;
  } catch {
    return null;
  }
}

export function saveConnection(conn: FaceitConnection): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
}

export function clearConnection(): void {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem("faceit_pkce_verifier");
  sessionStorage.removeItem("faceit_pkce_state");
  sessionStorage.removeItem("faceit_redirect_uri");
}

// ─────────────────────────────────────────
//  Auth method: API Key
// ─────────────────────────────────────────

/**
 * Validate an API key by making a test request to the FACEIT Data API.
 * Returns the player info if the key and nickname are valid.
 */
export async function connectWithApiKey(
  nickname: string,
  apiKey: string
): Promise<FaceitConnection> {
  const url = `https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(nickname)}&game=cs2`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 401) {
    throw new Error("Ungültiger API-Schlüssel. Bitte prüfe deinen FACEIT Data API Key.");
  }
  if (res.status === 404) {
    throw new Error(`Spieler „${nickname}" nicht gefunden. Bitte überprüfe den Nicknamen.`);
  }
  if (!res.ok) {
    throw new Error(`FACEIT API Fehler: ${res.status} ${res.statusText}`);
  }
  const player = await res.json();
  const conn: FaceitConnection = {
    nickname: player.nickname,
    playerId: player.player_id,
    avatar: player.avatar,
    skillLevel: player.games?.cs2?.skill_level,
    elo: player.games?.cs2?.faceit_elo,
    steamId: player.games?.cs2?.game_player_id,
    authMethod: "api_key",
    apiKey,
    connectedAt: new Date().toISOString(),
  };
  saveConnection(conn);
  return conn;
}

// ─────────────────────────────────────────
//  Auth method: OAuth2 PKCE
// ─────────────────────────────────────────

/**
 * Start the OAuth2 PKCE flow.
 *
 * Tauri (desktop):
 *   - Starts a local TCP listener on 127.0.0.1 with a random port (RFC 8252 §7.3)
 *   - Opens the FACEIT auth page in the system browser
 *   - Returns a Promise<FaceitConnection> that resolves when the callback fires
 *
 * Browser (dev/preview):
 *   - Redirects window.location.href to the FACEIT auth page
 *   - Returns a Promise that never resolves (page navigates away)
 *   - FaceitCallbackPage handles the return redirect
 *
 * ⚠️  Requires VITE_FACEIT_CLIENT_ID to be set.
 */
export async function startOAuthFlow(): Promise<FaceitConnection> {
  if (!FACEIT_CLIENT_ID) {
    throw new Error(
      "FACEIT OAuth ist nicht konfiguriert. Bitte trage die CLIENT_ID ein (VITE_FACEIT_CLIENT_ID). " +
        "Alternativ: Verbinde dich mit einem API-Schlüssel."
    );
  }

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateCodeVerifier().slice(0, 24);

  sessionStorage.setItem("faceit_pkce_verifier", verifier);
  sessionStorage.setItem("faceit_pkce_state", state);

  if (isTauri()) {
    // ── Tauri: loopback redirect (RFC 8252 §7.3) ────────────────────────────
    // Start local server → open system browser → wait for callback event
    const port = await tauriStartOAuthListener();
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    sessionStorage.setItem("faceit_redirect_uri", redirectUri);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: FACEIT_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: "openid profile membership",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    });

    await tauriOpenUrlExternally(`${FACEIT_OAUTH_BASE}/oauth/authorize?${params}`);

    // Return a Promise that resolves once Rust emits faceit-oauth-callback
    return new Promise<FaceitConnection>((resolve, reject) => {
      let unlisten: (() => void) | null = null;

      const timeoutId = setTimeout(() => {
        unlisten?.();
        reject(new Error("OAuth-Timeout: Der Login wurde nicht innerhalb von 5 Minuten abgeschlossen."));
      }, 5 * 60 * 1000);

      import("@tauri-apps/api/event")
        .then(({ listen }) =>
          listen<{ code: string; state: string; error: string }>(
            "faceit-oauth-callback",
            async (event) => {
              clearTimeout(timeoutId);
              unlisten?.();
              const { code, state: cbState, error } = event.payload;
              if (error) {
                reject(new Error(`FACEIT hat den Zugriff verweigert: ${error}`));
                return;
              }
              if (!code) {
                reject(new Error("Kein Autorisierungscode empfangen."));
                return;
              }
              try {
                resolve(await completeOAuthFlow(code, cbState, redirectUri));
              } catch (e) {
                reject(e);
              }
            }
          )
        )
        .then((fn) => { unlisten = fn; })
        .catch(reject);
    });
  }

  // ── Browser: classic redirect flow ─────────────────────────────────────────
  // FaceitCallbackPage handles the return; this Promise never resolves.
  const params = new URLSearchParams({
    response_type: "code",
    client_id: FACEIT_CLIENT_ID,
    redirect_uri: getOAuthRedirectUri(),
    scope: "openid profile membership",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

  window.location.href = `${FACEIT_OAUTH_BASE}/oauth/authorize?${params}`;
  return new Promise<FaceitConnection>(() => {});
}

/**
 * Complete the OAuth2 PKCE flow after receiving the authorization code.
 *
 * In Tauri: called internally by startOAuthFlow() with the loopback redirectUri.
 * In browser: called by FaceitCallbackPage after the redirect returns.
 *
 * @param code        - The authorization code from FACEIT
 * @param state       - The state parameter (must match saved state)
 * @param redirectUri - The redirect_uri used in the authorization request.
 *                      Falls back to sessionStorage / getOAuthRedirectUri() when omitted.
 */
export async function completeOAuthFlow(
  code: string,
  state: string,
  redirectUri?: string
): Promise<FaceitConnection> {
  if (!FACEIT_CLIENT_ID) {
    throw new Error("FACEIT CLIENT_ID nicht konfiguriert.");
  }

  const savedState = sessionStorage.getItem("faceit_pkce_state");
  // Allow when savedState is null (e.g. page was refreshed mid-flow)
  if (savedState && savedState !== state) {
    throw new Error("OAuth-Sicherheitsfehler: State stimmt nicht überein.");
  }

  const verifier = sessionStorage.getItem("faceit_pkce_verifier");
  if (!verifier) {
    throw new Error("OAuth-Fehler: Code-Verifier nicht gefunden. Bitte neu einloggen.");
  }

  const effectiveRedirectUri =
    redirectUri ??
    sessionStorage.getItem("faceit_redirect_uri") ??
    getOAuthRedirectUri();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: effectiveRedirectUri,
    client_id: FACEIT_CLIENT_ID,
    code_verifier: verifier,
  });

  const tokenRes = await fetch(FACEIT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    throw new Error(`Token-Austausch fehlgeschlagen: ${err.error_description ?? tokenRes.statusText}`);
  }

  const tokens = await tokenRes.json();
  const expiresAt = Date.now() + tokens.expires_in * 1000;

  // Fetch player info with the new access token
  const playerRes = await fetch("https://open.faceit.com/data/v4/players/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  let nickname = "";
  let playerId = "";
  let avatar = "";
  let skillLevel: number | undefined;
  let elo: number | undefined;
  let steamId: string | undefined;

  if (playerRes.ok) {
    const p = await playerRes.json();
    nickname = p.nickname ?? "";
    playerId = p.player_id ?? "";
    avatar = p.avatar ?? "";
    skillLevel = p.games?.cs2?.skill_level;
    elo = p.games?.cs2?.faceit_elo;
    steamId = p.games?.cs2?.game_player_id;
  }

  const conn: FaceitConnection = {
    nickname,
    playerId,
    avatar,
    skillLevel,
    elo,
    steamId,
    authMethod: "oauth",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiresAt: expiresAt,
    connectedAt: new Date().toISOString(),
  };

  saveConnection(conn);
  sessionStorage.removeItem("faceit_pkce_verifier");
  sessionStorage.removeItem("faceit_pkce_state");
  sessionStorage.removeItem("faceit_redirect_uri");
  return conn;
}

// ─────────────────────────────────────────
//  Auth header
// ─────────────────────────────────────────

/** Return the `Authorization` header value for the current connection. */
export function getAuthHeader(conn: FaceitConnection): string {
  if (conn.authMethod === "oauth" && conn.accessToken) {
    return `Bearer ${conn.accessToken}`;
  }
  if (conn.apiKey) {
    return `Bearer ${conn.apiKey}`;
  }
  return "";
}

/** True if the OAuth access token appears to still be valid. */
export function isTokenValid(conn: FaceitConnection): boolean {
  if (conn.authMethod !== "oauth") return true;
  if (!conn.tokenExpiresAt) return false;
  return conn.tokenExpiresAt - Date.now() > 60_000; // 1 minute buffer
}

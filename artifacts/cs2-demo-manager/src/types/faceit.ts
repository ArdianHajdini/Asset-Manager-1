// ─────────────────────────────────────────────────────────────────────────────
//  FACEIT API types
//  Endpoint base: https://open.faceit.com/data/v4
// ─────────────────────────────────────────────────────────────────────────────

export interface FaceitPlayer {
  player_id: string;
  nickname: string;
  avatar: string;
  country: string;
  games?: {
    cs2?: {
      faceit_elo: number;
      skill_level: number;
      game_player_id: string;
      game_player_name: string;
    };
  };
  faceit_url: string;
}

export interface FaceitTeamPlayer {
  player_id: string;
  nickname: string;
  avatar: string;
  game_player_id?: string;
  game_player_name?: string;
  game_skill_level?: number;
  faceit_url?: string;
}

export interface FaceitTeam {
  team_id: string;
  nickname: string;
  avatar: string;
  type: string;
  players: FaceitTeamPlayer[];
}

/** Full match object from GET /matches/{match_id} */
export interface FaceitMatch {
  match_id: string;
  game: string;
  version?: number;
  team_size?: number;
  num_players?: number;
  teams: {
    faction1: FaceitTeam;
    faction2: FaceitTeam;
  };
  playing_players?: string[];
  best_of?: number;
  competition_id?: string;
  competition_name: string;
  competition_type?: string;
  organizer_id?: string;
  status: string;
  started_at: number;
  finished_at?: number;
  results?: {
    winner: string;
    score: { faction1: number; faction2: number };
  };
  demo_url?: string[];
  voting?: {
    map?: {
      entities?: Array<{
        guid: string;
        name: string;
        image_sm?: string;
        image_lg?: string;
        class_name?: string;
      }>;
      pick?: string[];
    };
  };
  faceit_url?: string;
}

/** Compact match entry from GET /players/{id}/history */
export interface FaceitHistoryItem {
  match_id: string;
  game_id: string;
  region: string;
  match_type: string;
  game_mode: string;
  max_players: number;
  teams_size: number;
  teams: {
    faction1: { team_id: string; nickname: string; avatar: string; type: string; players: FaceitTeamPlayer[] };
    faction2: { team_id: string; nickname: string; avatar: string; type: string; players: FaceitTeamPlayer[] };
  };
  playing_players?: string[];
  competition_id?: string;
  competition_name: string;
  competition_type?: string;
  organizer_id?: string;
  status: string;
  started_at: number;
  finished_at?: number;
  results?: {
    winner: string;
    score: { faction1: number; faction2: number };
  };
  faceit_url?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  App-specific connection state
// ─────────────────────────────────────────────────────────────────────────────

export type FaceitAuthMethod = "api_key" | "oauth";

export interface FaceitConnection {
  /** FACEIT nickname entered by the user */
  nickname: string;
  /** Resolved player ID from the FACEIT API */
  playerId: string;
  /** Player avatar URL */
  avatar?: string;
  /** FACEIT Skill Level (1–10) */
  skillLevel?: number;
  /** ELO rating */
  elo?: number;
  /**
   * Steam ID64 for CS2 (from games.cs2.game_player_id in the FACEIT player profile).
   * Used by the demo parser to identify the user's own team in replays.
   */
  steamId?: string;
  /** How the user authenticated */
  authMethod: FaceitAuthMethod;
  /** FACEIT Data API key — always present for api_key method */
  apiKey?: string;
  /** OAuth2 access token — present for oauth method */
  accessToken?: string;
  /** OAuth2 refresh token */
  refreshToken?: string;
  /** Unix timestamp (ms) when the access token expires */
  tokenExpiresAt?: number;
  /** ISO string when connection was established */
  connectedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Per-match download state tracked in the UI
// ─────────────────────────────────────────────────────────────────────────────

export type DownloadStatus = "idle" | "downloading" | "extracting" | "done" | "error";

export interface MatchDownloadState {
  status: DownloadStatus;
  progress?: number; // 0–100
  error?: string;
  /** Absolute path to the saved .dem file (after successful download) */
  demoPath?: string;
  /** Demo ID in the local library (after registration) */
  demoId?: string;
}

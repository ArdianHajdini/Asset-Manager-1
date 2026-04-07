/**
 * FaceitContext — global state for FACEIT account connection and match cache.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { FaceitConnection, FaceitHistoryItem, MatchDownloadState } from "../types/faceit";
import { loadConnection, clearConnection } from "../services/faceitAuthService";
import { getMatchHistory } from "../services/faceitMatchService";

interface FaceitContextValue {
  /** Current FACEIT connection, or null if not connected. */
  connection: FaceitConnection | null;
  /** Whether a connection is established. */
  isConnected: boolean;
  /** Recent match history (cached). */
  matches: FaceitHistoryItem[];
  /** Whether matches are currently loading. */
  isLoadingMatches: boolean;
  /** Last error from the FACEIT API. */
  matchError: string | null;
  /** Per-match download state map (keyed by match_id). */
  downloadStates: Record<string, MatchDownloadState>;
  /** Set the connection (after login). */
  setConnection: (conn: FaceitConnection | null) => void;
  /** Disconnect and clear stored credentials. */
  disconnect: () => void;
  /** Reload matches from the FACEIT API. */
  refreshMatches: () => Promise<void>;
  /** Update the download state for a single match. */
  setDownloadState: (matchId: string, state: MatchDownloadState) => void;
}

const FaceitContext = createContext<FaceitContextValue | null>(null);

export function FaceitProvider({ children }: { children: React.ReactNode }) {
  const [connection, setConnectionState] = useState<FaceitConnection | null>(() =>
    loadConnection()
  );
  const [matches, setMatches] = useState<FaceitHistoryItem[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [downloadStates, setDownloadStates] = useState<Record<string, MatchDownloadState>>({});

  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  const setConnection = useCallback((conn: FaceitConnection | null) => {
    setConnectionState(conn);
    if (!conn) {
      setMatches([]);
      setMatchError(null);
    }
  }, []);

  const disconnect = useCallback(() => {
    clearConnection();
    setConnection(null);
    setDownloadStates({});
  }, [setConnection]);

  const refreshMatches = useCallback(async () => {
    const conn = connectionRef.current;
    if (!conn) return;
    setIsLoadingMatches(true);
    setMatchError(null);
    try {
      const result = await getMatchHistory(conn.playerId, conn, 20);
      setMatches(result.items ?? []);
    } catch (err) {
      setMatchError(String(err));
    } finally {
      setIsLoadingMatches(false);
    }
  }, []);

  // Auto-load matches when connection is established
  useEffect(() => {
    if (connection) {
      refreshMatches();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection?.playerId]);

  const setDownloadState = useCallback((matchId: string, state: MatchDownloadState) => {
    setDownloadStates((prev) => ({ ...prev, [matchId]: state }));
  }, []);

  return (
    <FaceitContext.Provider
      value={{
        connection,
        isConnected: connection !== null,
        matches,
        isLoadingMatches,
        matchError,
        downloadStates,
        setConnection,
        disconnect,
        refreshMatches,
        setDownloadState,
      }}
    >
      {children}
    </FaceitContext.Provider>
  );
}

export function useFaceit() {
  const ctx = useContext(FaceitContext);
  if (!ctx) throw new Error("useFaceit must be inside FaceitProvider");
  return ctx;
}

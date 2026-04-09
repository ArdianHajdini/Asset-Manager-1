/**
 * FaceitContext — global state for FACEIT account connection and match cache.
 */
// Vite Fast Refresh: this file exports both a Provider component and a hook,
// which breaks partial HMR. Force a full page reload on every change.
/* @refresh reset */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { FaceitConnection, FaceitHistoryItem } from "../types/faceit";
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
  /** Set the connection (after login). */
  setConnection: (conn: FaceitConnection | null) => void;
  /** Disconnect and clear stored credentials. */
  disconnect: () => void;
  /** Reload matches from the FACEIT API. */
  refreshMatches: () => Promise<void>;
}

const FaceitContext = createContext<FaceitContextValue | null>(null);

export function FaceitProvider({ children }: { children: React.ReactNode }) {
  const [connection, setConnectionState] = useState<FaceitConnection | null>(() =>
    loadConnection()
  );
  const [matches, setMatches] = useState<FaceitHistoryItem[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);

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

  return (
    <FaceitContext.Provider
      value={{
        connection,
        isConnected: connection !== null,
        matches,
        isLoadingMatches,
        matchError,
        setConnection,
        disconnect,
        refreshMatches,
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

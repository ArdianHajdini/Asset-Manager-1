import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { Demo, AppSettings, StatusMessage } from "../types/demo";
import { loadDemos, loadSettings, saveSettings } from "../services/storage";
import {
  addDemoToLibrary,
  loadDemosFromDisk,
  renameDemoFull,
  deleteDemoFull,
} from "../services/demoService";
import { isTauri } from "../services/tauriBridge";
import { detectCS2Path } from "../services/cs2Service";

interface AppContextValue {
  demos: Demo[];
  settings: AppSettings;
  status: StatusMessage;
  isLoadingDemos: boolean;
  /** Re-read demos from disk (Tauri) or localStorage (browser). */
  refreshDemos: () => Promise<void>;
  /** Add a demo that was already imported (browser mode). */
  addDemoToLibrarySync: (demo: Omit<Demo, "id">) => void;
  /** Set the demo list directly (e.g. after Tauri import). */
  setDemos: React.Dispatch<React.SetStateAction<Demo[]>>;
  renameDemo: (id: string, newName: string) => Promise<void>;
  deleteDemo: (id: string) => Promise<void>;
  updateSettings: (s: Partial<AppSettings>) => void;
  setStatus: (s: StatusMessage) => void;
  clearStatus: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [demos, setDemos] = useState<Demo[]>(() => loadDemos());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [status, setStatus] = useState<StatusMessage>(null);
  const [isLoadingDemos, setIsLoadingDemos] = useState(false);

  // Keep a ref to current demos for async callbacks
  const demosRef = useRef(demos);
  demosRef.current = demos;

  // Keep a ref to current settings for async callbacks
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const refreshDemos = useCallback(async () => {
    setIsLoadingDemos(true);
    try {
      const loaded = await loadDemosFromDisk(settingsRef.current.demoDirectory);
      setDemos(loaded);
    } catch (err) {
      console.error("refreshDemos error:", err);
    } finally {
      setIsLoadingDemos(false);
    }
  }, []);

  // Initial load + first-time auto-detection of CS2 paths
  useEffect(() => {
    refreshDemos();

    // Auto-detect Steam / CS2 / replay folder when the app is opened for the
    // first time (no paths configured yet, or old C:\CS2Demos default).
    if (isTauri()) {
      const s = settingsRef.current;
      const needsDetect =
        !s.cs2Path &&
        (!s.demoDirectory || s.demoDirectory === "C:\\CS2Demos");

      if (needsDetect) {
        detectCS2Path().then((result) => {
          if (result) {
            setSettings((prev) => {
              const next = {
                ...prev,
                steamPath: result.steamPath,
                cs2Path: result.cs2Path,
                demoDirectory: result.replayFolder,
              };
              saveSettings(next);
              return next;
            });
          }
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the demo directory changes (settings saved), reload demos
  useEffect(() => {
    if (isTauri()) {
      refreshDemos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.demoDirectory]);

  const addDemoToLibrarySync = useCallback((demo: Omit<Demo, "id">) => {
    setDemos(addDemoToLibrary(demo));
  }, []);

  const renameDemo = useCallback(async (id: string, newName: string) => {
    const updated = await renameDemoFull(demosRef.current, id, newName);
    setDemos(updated);
  }, []);

  const deleteDemo = useCallback(async (id: string) => {
    const updated = await deleteDemoFull(demosRef.current, id);
    setDemos(updated);
  }, []);

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      saveSettings(next);
      return next;
    });
  }, []);

  const clearStatus = useCallback(() => setStatus(null), []);

  // Auto-clear status messages after 7 seconds
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(clearStatus, 7000);
    return () => clearTimeout(timer);
  }, [status, clearStatus]);

  return (
    <AppContext.Provider
      value={{
        demos,
        settings,
        status,
        isLoadingDemos,
        refreshDemos,
        addDemoToLibrarySync,
        setDemos,
        renameDemo,
        deleteDemo,
        updateSettings,
        setStatus,
        clearStatus,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be inside AppProvider");
  return ctx;
}

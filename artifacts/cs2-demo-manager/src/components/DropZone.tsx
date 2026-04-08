import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, FileArchive, Loader2, AlertTriangle } from "lucide-react";
import { useApp } from "../context/AppContext";
import { importDemoFromPath } from "../services/demoService";
import { isTauri } from "../services/tauriBridge";
import { cn } from "@/lib/utils";

interface DropZoneProps {
  onSuccess?: () => void;
}

export function DropZone({ onSuccess }: DropZoneProps) {
  const { settings, setStatus, refreshDemos } = useApp();
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const pickerOpenRef = useRef(false);

  // ── Tauri native drag-drop ────────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;

    (async () => {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const win = getCurrentWebviewWindow();
        unlisten = await win.onDragDropEvent(async (event) => {
          if (event.payload.type === "over") {
            setDragging(true);
          } else if (event.payload.type === "leave") {
            setDragging(false);
          } else if (event.payload.type === "drop") {
            setDragging(false);
            const paths: string[] =
              (event.payload as { paths?: string[] }).paths ?? [];
            for (const path of paths) {
              await handleTauriPath(path);
            }
          }
        });
      } catch (err) {
        console.error("[CS2DM] Drag-drop listener error:", err);
      }
    })();

    return () => { unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.demoDirectory]);

  // ── Core import: always through Rust ─────────────────────────────────────
  async function handleTauriPath(sourcePath: string) {
    const name = sourcePath.split(/[\\/]/).pop() ?? "";

    if (!settings.demoDirectory) {
      setStatus({
        type: "error",
        message:
          "Kein Replay-Ordner konfiguriert. Bitte Einstellungen öffnen und CS2 automatisch erkennen lassen.",
      });
      return;
    }

    if (
      !name.endsWith(".dem") &&
      !name.endsWith(".dem.gz") &&
      !name.endsWith(".dem.zst")
    ) {
      setStatus({
        type: "error",
        message: `Nicht unterstütztes Format: „${name}". Erlaubt: .dem, .dem.gz, .dem.zst`,
      });
      return;
    }

    setImporting(true);
    try {
      console.log("[CS2DM] Import:", {
        sourcePath,
        destDir: settings.demoDirectory,
        extractGz: settings.autoExtractGz,
      });

      const demo = await importDemoFromPath(
        sourcePath,
        settings.demoDirectory,
        settings.autoExtractGz
      );

      console.log("[CS2DM] Import result:", {
        filepath: demo.filepath,
        directory: demo.directory,
        filename: demo.filename,
        inReplayFolder: demo.directory === settings.demoDirectory,
      });

      await refreshDemos();
      const base = name.replace(/\.(gz|zst)$/, "").replace(/\.dem$/, "");
      setStatus({
        type: "success",
        message: `Demo importiert: „${base}" → ${demo.filepath}`,
      });
      onSuccess?.();
    } catch (err) {
      console.error("[CS2DM] Import error:", err);
      setStatus({ type: "error", message: String(err) });
    } finally {
      setImporting(false);
    }
  }

  // ── Click handler: opens native Tauri dialog ──────────────────────────────
  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (importing || pickerOpenRef.current) return;

      // In browser (dev server) — show clear error, never use HTML input
      if (!isTauri()) {
        setStatus({
          type: "error",
          message:
            "Import ist nur in der nativen Windows-Desktop-App verfügbar. Bitte die App über GitHub Actions bauen und die .exe starten.",
        });
        return;
      }

      if (!settings.demoDirectory) {
        setStatus({
          type: "error",
          message:
            "Kein Replay-Ordner konfiguriert. Bitte Einstellungen öffnen und CS2 automatisch erkennen lassen.",
        });
        return;
      }

      pickerOpenRef.current = true;
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const result = await open({
          multiple: true,
          filters: [
            { name: "CS2 Demos", extensions: ["dem", "gz", "zst"] },
            { name: "Alle Dateien", extensions: ["*"] },
          ],
        });

        if (!result) return;
        const paths = Array.isArray(result) ? result : [result];
        for (const path of paths) {
          await handleTauriPath(path);
        }
      } catch (err) {
        // Dialog plugin error — show it instead of silently falling back to browser
        console.error("[CS2DM] Dialog open error:", err);
        setStatus({
          type: "error",
          message: `Dateidialog konnte nicht geöffnet werden: ${String(err)}`,
        });
      } finally {
        setTimeout(() => { pickerOpenRef.current = false; }, 400);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [importing, settings.demoDirectory]
  );

  // ── Browser drag-over (prevents default even in non-Tauri mode) ───────────
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!isTauri()) return;
    setDragging(true);
  }
  function handleDragLeave() {
    setDragging(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    // In Tauri, the native onDragDropEvent handler above does the actual work.
    // The HTML drop event fires too but we ignore it — paths aren't accessible from JS.
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={cn(
        "relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200",
        "flex flex-col items-center justify-center gap-3 py-12 px-8 text-center select-none",
        importing && "cursor-wait pointer-events-none",
        dragging
          ? "border-orange-500 bg-orange-500/8 scale-[1.01]"
          : "border-white/15 hover:border-white/30 bg-white/2 hover:bg-white/4"
      )}
    >
      <div
        className={cn(
          "w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-200",
          importing
            ? "bg-orange-500/20"
            : dragging
            ? "bg-orange-500/20"
            : "bg-white/8"
        )}
      >
        {importing ? (
          <Loader2 className="w-8 h-8 text-orange-400 animate-spin" />
        ) : dragging ? (
          <FileArchive className="w-8 h-8 text-orange-400" />
        ) : (
          <Upload className="w-8 h-8 text-white/40" />
        )}
      </div>

      <div>
        <p
          className={cn(
            "font-semibold text-base transition-colors",
            importing
              ? "text-orange-300"
              : dragging
              ? "text-orange-300"
              : "text-white/70"
          )}
        >
          {importing
            ? "Demo wird entpackt und in Replay-Ordner gespeichert..."
            : dragging
            ? "Datei loslassen zum Importieren"
            : "Demo hier ablegen"}
        </p>
        <p className="text-white/35 text-sm mt-1">
          Klicken für Dateiauswahl · .dem, .dem.gz, .dem.zst · wird
          automatisch in CS2 Replay-Ordner kopiert
        </p>

        {settings.demoDirectory ? (
          <p className="text-white/20 text-xs mt-2 font-mono truncate max-w-sm">
            → {settings.demoDirectory}
          </p>
        ) : (
          <div className="mt-2 flex items-center gap-1.5 justify-center">
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
            <p className="text-yellow-500/70 text-xs">
              Replay-Ordner nicht konfiguriert — Einstellungen öffnen
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

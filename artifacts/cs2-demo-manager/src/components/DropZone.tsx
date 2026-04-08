import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, FileArchive, Loader2, AlertTriangle, MonitorOff } from "lucide-react";
import { useApp } from "../context/AppContext";
import { buildDemoFromFile, importDemoFromPath } from "../services/demoService";
import { isTauri } from "../services/tauriBridge";
import { cn } from "@/lib/utils";

interface DropZoneProps {
  onSuccess?: () => void;
}

export function DropZone({ onSuccess }: DropZoneProps) {
  const { settings, addDemoToLibrarySync, setStatus, refreshDemos } = useApp();
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isPickerOpenRef = useRef(false);

  // ── Tauri drag-drop event listener ──────────────────────────────────────
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
            const paths: string[] = (event.payload as { paths?: string[] }).paths ?? [];
            for (const path of paths) {
              await handleTauriPath(path);
            }
          }
        });
      } catch (err) {
        console.error("Failed to set up Tauri drag-drop listener:", err);
      }
    })();

    return () => { unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // ── Core Tauri import handler ────────────────────────────────────────────
  async function handleTauriPath(path: string) {
    const name = path.split(/[\\/]/).pop() ?? "";

    // Hard block: no replay folder configured
    if (!settings.demoDirectory) {
      setStatus({
        type: "error",
        message:
          "Kein CS2 Replay-Ordner konfiguriert. Bitte die Einstellungen öffnen → CS2 automatisch erkennen lassen.",
      });
      return;
    }

    if (!name.endsWith(".dem") && !name.endsWith(".dem.gz") && !name.endsWith(".dem.zst")) {
      setStatus({
        type: "error",
        message: `Nicht unterstütztes Format: „${name}". Erlaubt: .dem, .dem.gz, .dem.zst`,
      });
      return;
    }

    setImporting(true);
    try {
      console.log("[CS2DM] Import:", {
        sourcePath: path,
        destDir: settings.demoDirectory,
        extractGz: settings.autoExtractGz,
      });

      const demo = await importDemoFromPath(path, settings.demoDirectory, settings.autoExtractGz);

      console.log("[CS2DM] Import result:", {
        filepath: demo.filepath,
        directory: demo.directory,
        filename: demo.filename,
        inReplayFolder: demo.directory === settings.demoDirectory,
      });

      if (demo.directory !== settings.demoDirectory) {
        console.warn("[CS2DM] Directory mismatch:", {
          expected: settings.demoDirectory,
          actual: demo.directory,
        });
      }

      await refreshDemos();
      const displayBase = name.replace(/\.(gz|zst)$/, "").replace(/\.dem$/, "");
      setStatus({
        type: "success",
        message: `Demo entpackt und gespeichert: „${displayBase}" → ${demo.filepath}`,
      });
      onSuccess?.();
    } catch (err) {
      console.error("[CS2DM] Import error:", err);
      setStatus({ type: "error", message: String(err) });
    } finally {
      setImporting(false);
    }
  }

  // ── Browser HTML drop (non-Tauri only) ──────────────────────────────────
  function isValidFile(name: string) {
    return name.endsWith(".dem") || name.endsWith(".dem.gz") || name.endsWith(".dem.zst");
  }

  async function processFile(file: File) {
    if (!isValidFile(file.name)) {
      setStatus({
        type: "error",
        message: `Nicht unterstütztes Format: „${file.name}". Erlaubt: .dem, .dem.gz, .dem.zst`,
      });
      return;
    }
    // In browser mode we can only add metadata — no filesystem access
    const demo = buildDemoFromFile(file, "browser-preview");
    addDemoToLibrarySync(demo);
    setStatus({
      type: "info",
      message: "Vorschau-Modus: Demo zur Liste hinzugefügt, aber NICHT in den CS2-Ordner kopiert. Das funktioniert nur in der nativen Windows-App.",
    });
    onSuccess?.();
  }

  function handleBrowserDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (isTauri()) return;
    Array.from(e.dataTransfer.files).forEach(processFile);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    Array.from(e.target.files ?? []).forEach(processFile);
    e.target.value = "";
  }

  // ── Tauri native file picker ─────────────────────────────────────────────
  const handleTauriFilePicker = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (importing || isPickerOpenRef.current) return;

    if (!isTauri()) {
      inputRef.current?.click();
      return;
    }

    if (!settings.demoDirectory) {
      setStatus({
        type: "error",
        message:
          "Kein CS2 Replay-Ordner konfiguriert. Bitte die Einstellungen öffnen → CS2 automatisch erkennen lassen.",
      });
      return;
    }

    isPickerOpenRef.current = true;
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
    } catch {
      inputRef.current?.click();
    } finally {
      setTimeout(() => { isPickerOpenRef.current = false; }, 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importing, settings]);

  // ── Browser-mode banner ─────────────────────────────────────────────────
  if (!isTauri()) {
    return (
      <div className="space-y-3">
        {/* Hard warning banner */}
        <div className="flex items-start gap-3 p-4 rounded-xl border border-yellow-600/40 bg-yellow-900/15">
          <MonitorOff className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-yellow-300 text-sm font-semibold">Browser-Vorschau — kein Dateisystem-Zugriff</p>
            <p className="text-yellow-200/60 text-xs mt-1 leading-relaxed">
              Import, Entpacken und Kopieren in den CS2 Replay-Ordner funktionieren{" "}
              <strong className="text-yellow-200/90">ausschließlich</strong> in der nativen Windows-Desktop-App.
              Im Browser können keine Dateien auf die Festplatte geschrieben werden.
            </p>
            <p className="text-yellow-200/50 text-xs mt-2">
              Baue die App mit GitHub Actions und starte die .exe — dann funktioniert alles automatisch.
            </p>
          </div>
        </div>

        {/* Disabled-looking drop zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleBrowserDrop}
          className="relative rounded-2xl border-2 border-dashed border-white/8 bg-white/1 flex flex-col items-center justify-center gap-3 py-10 px-8 text-center opacity-40 cursor-not-allowed select-none"
        >
          <input
            ref={inputRef}
            type="file"
            accept=".dem,.dem.gz,.dem.zst,.gz,.zst"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
          <div className="w-14 h-14 rounded-2xl bg-white/8 flex items-center justify-center">
            <Upload className="w-7 h-7 text-white/30" />
          </div>
          <div>
            <p className="font-semibold text-sm text-white/40">Demo hier ablegen</p>
            <p className="text-white/20 text-xs mt-1">Nur in der nativen Desktop-App verfügbar</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Tauri drop zone ─────────────────────────────────────────────────────
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); }}
      onDragLeave={() => {}}
      onDrop={(e) => { e.preventDefault(); }}
      onClick={handleTauriFilePicker}
      className={cn(
        "relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200",
        "flex flex-col items-center justify-center gap-3 py-12 px-8 text-center select-none",
        importing && "cursor-wait",
        dragging
          ? "border-orange-500 bg-orange-500/8 scale-[1.01]"
          : "border-white/15 hover:border-white/30 bg-white/2 hover:bg-white/4"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".dem,.dem.gz,.dem.zst,.gz,.zst"
        multiple
        className="hidden"
        onChange={handleFileInput}
      />

      <div className={cn(
        "w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-200",
        importing ? "bg-orange-500/20" : dragging ? "bg-orange-500/20" : "bg-white/8"
      )}>
        {importing
          ? <Loader2 className="w-8 h-8 text-orange-400 animate-spin" />
          : dragging
            ? <FileArchive className="w-8 h-8 text-orange-400" />
            : <Upload className="w-8 h-8 text-white/40" />
        }
      </div>

      <div>
        <p className={cn(
          "font-semibold text-base transition-colors",
          importing ? "text-orange-300" :
          dragging ? "text-orange-300" : "text-white/70"
        )}>
          {importing
            ? "Demo wird entpackt und gespeichert..."
            : dragging
              ? "Datei loslassen zum Importieren"
              : "Demo hier ablegen"}
        </p>
        <p className="text-white/35 text-sm mt-1">
          Klicken für Dateiauswahl · .dem, .dem.gz, .dem.zst · wird in CS2 Replay-Ordner kopiert
        </p>
        {settings.demoDirectory && (
          <p className="text-white/20 text-xs mt-2 font-mono truncate max-w-sm">
            → {settings.demoDirectory}
          </p>
        )}
        {!settings.demoDirectory && (
          <div className="mt-2 flex items-center gap-1.5 justify-center">
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
            <p className="text-yellow-500/70 text-xs">Replay-Ordner nicht konfiguriert</p>
          </div>
        )}
      </div>
    </div>
  );
}

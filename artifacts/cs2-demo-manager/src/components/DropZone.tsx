import { useState, useRef, useEffect } from "react";
import { Upload, FileArchive, Loader2 } from "lucide-react";
import { useApp } from "../context/AppContext";
import { buildDemoFromFile, importDemoFromPath } from "../services/demoService";
import { isTauri } from "../services/tauriBridge";
import { cn } from "@/lib/utils";

interface DropZoneProps {
  onSuccess?: () => void;
}

export function DropZone({ onSuccess }: DropZoneProps) {
  const { settings, addDemoToLibrarySync, setDemos, setStatus, refreshDemos } = useApp();
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Tauri drag-drop event listener ──────────────────────────────────────
  // In Tauri, the HTML drag-drop API does not give us real file paths.
  // We listen to the Tauri-specific drag-drop event to get actual paths.
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

    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  async function handleTauriPath(path: string) {
    const name = path.split(/[\\/]/).pop() ?? "";
    if (!name.endsWith(".dem") && !name.endsWith(".dem.gz") && !name.endsWith(".dem.zst")) {
      setStatus({
        type: "error",
        message: `Diese Datei wird nicht unterstützt: „${name}". Nur .dem, .dem.gz und .dem.zst Dateien werden akzeptiert.`,
      });
      return;
    }
    setImporting(true);
    try {
      await importDemoFromPath(path, settings.demoDirectory, settings.autoExtractGz);
      await refreshDemos();
      setStatus({ type: "success", message: `Demo importiert: „${name.replace(/\.(gz|zst)$/, "").replace(/\.dem$/, "")}"` });
      onSuccess?.();
    } catch (err) {
      setStatus({ type: "error", message: String(err) });
    } finally {
      setImporting(false);
    }
  }

  // ── HTML drag-drop (browser fallback) ───────────────────────────────────
  function isValidFile(name: string) {
    return name.endsWith(".dem") || name.endsWith(".dem.gz") || name.endsWith(".dem.zst");
  }

  async function processFile(file: File) {
    if (!isValidFile(file.name)) {
      setStatus({
        type: "error",
        message: `Diese Datei wird nicht unterstützt: „${file.name}". Nur .dem, .dem.gz und .dem.zst Dateien werden akzeptiert.`,
      });
      return;
    }
    const demo = buildDemoFromFile(file, settings.demoDirectory);
    addDemoToLibrarySync(demo);
    setStatus({ type: "success", message: `Demo importiert: „${demo.displayName}"` });
    onSuccess?.();
  }

  function handleBrowserDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (isTauri()) return; // Handled by Tauri event
    Array.from(e.dataTransfer.files).forEach(processFile);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (isTauri()) {
      // In Tauri, HTML file input gives us File objects but not their real paths.
      // We use the file input only as a fallback and process the files as browser blobs.
      files.forEach(processFile);
    } else {
      files.forEach(processFile);
    }
    e.target.value = "";
  }

  // ── Tauri native file picker ─────────────────────────────────────────────
  async function handleTauriFilePicker() {
    if (!isTauri()) {
      inputRef.current?.click();
      return;
    }
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
      // dialog plugin not available — fall back to HTML input
      inputRef.current?.click();
    }
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!isTauri()) setDragging(true); }}
      onDragLeave={() => { if (!isTauri()) setDragging(false); }}
      onDrop={handleBrowserDrop}
      onClick={importing ? undefined : handleTauriFilePicker}
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
            ? "Demo wird importiert..."
            : dragging
              ? "Datei loslassen zum Importieren"
              : "Demo hier ablegen"}
        </p>
        <p className="text-white/35 text-sm mt-1">
          {isTauri()
            ? "oder klicken für Dateiauswahl-Dialog · .dem, .dem.gz, .dem.zst"
            : "oder klicken zum Auswählen · .dem, .dem.gz, .dem.zst"}
        </p>
      </div>
    </div>
  );
}

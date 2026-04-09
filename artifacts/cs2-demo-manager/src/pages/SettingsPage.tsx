import { useState } from "react";
import {
  Save, FolderOpen, Crosshair, Info, Search, Loader2, CheckCircle2,
  RefreshCw, FolderSearch, Download, Key, Globe,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n, { LANGUAGES } from "../i18n/index";
import { useApp } from "../context/AppContext";
import { detectCS2Path, detectReplayFolder } from "../services/cs2Service";
import { isTauri, tauriOpenFolder, tauriDetectDownloadsFolder } from "../services/tauriBridge";
import { scanDownloadsFolder, processCandidates } from "../services/downloadsService";
import {
  getStoredLicense,
  getLicenseStatus,
  deactivateLicense,
} from "../services/licenseService";
import { cn } from "@/lib/utils";

export function SettingsPage() {
  const { settings, updateSettings, setStatus, refreshDemos } = useApp();
  const { t } = useTranslation();

  const [form, setForm] = useState({ ...settings });
  const [saved, setSaved] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [detectingDownloads, setDetectingDownloads] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const licenseStatus = getLicenseStatus();
  const stored = getStoredLicense();

  async function handleSave() {
    updateSettings(form);
    setStatus({ type: "success", message: t("settings.settingsSaved") });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleAutoDetect() {
    setDetecting(true);
    try {
      const result = await detectCS2Path();
      if (result) {
        const updated = {
          steamPath: result.steamPath,
          cs2Path: result.cs2Path,
          demoDirectory: result.replayFolder,
        };
        setForm((f) => ({ ...f, ...updated }));
        updateSettings(updated);
        await refreshDemos();
        setStatus({ type: "success", message: t("settings.cs2Found", { folder: result.replayFolder }) });
      } else {
        setStatus({ type: "error", message: t("settings.cs2NotFoundMsg") });
      }
    } catch {
      setStatus({ type: "error", message: t("settings.cs2DetectError") });
    } finally {
      setDetecting(false);
    }
  }

  async function handleOpenReplayFolder() {
    const folder = form.demoDirectory || settings.demoDirectory;
    if (!folder) { setStatus({ type: "error", message: t("settings.noReplayFolder") }); return; }
    try { await tauriOpenFolder(folder); } catch { setStatus({ type: "info", message: `${t("settings.openFolder")}: ${folder}` }); }
  }

  async function handleDetectReplayFolder() {
    const steam = form.steamPath;
    if (!steam) {
      setStatus({ type: "error", message: t("settings.cs2NotFoundMsg") });
      return;
    }
    try {
      const folder = await detectReplayFolder(steam);
      if (folder) {
        setForm((f) => ({ ...f, demoDirectory: folder }));
        updateSettings({ demoDirectory: folder });
        await refreshDemos();
        setStatus({ type: "success", message: t("settings.replayFolderFound", { folder }) });
      }
    } catch {
      setStatus({ type: "error", message: t("settings.replayFolderError") });
    }
  }

  async function handleRefreshLibrary() {
    setRefreshing(true);
    try {
      await refreshDemos();
      setStatus({ type: "success", message: t("settings.libReloaded") });
    } catch {
      setStatus({ type: "error", message: t("settings.libReloadError") });
    } finally {
      setRefreshing(false);
    }
  }

  async function handleAutoDetectDownloads() {
    if (!isTauri()) return;
    setDetectingDownloads(true);
    try {
      const folder = await tauriDetectDownloadsFolder();
      if (folder) {
        setForm((f) => ({ ...f, downloadsFolder: folder }));
        updateSettings({ downloadsFolder: folder });
        setStatus({ type: "success", message: t("settings.downloadsFolderDetected", { folder }) });
      } else {
        setStatus({ type: "error", message: t("settings.downloadsFolderError") });
      }
    } catch {
      setStatus({ type: "error", message: t("settings.downloadsFolderError") });
    } finally {
      setDetectingDownloads(false);
    }
  }

  async function handleOpenDownloadsFolder() {
    const folder = form.downloadsFolder || settings.downloadsFolder;
    if (!folder) { setStatus({ type: "error", message: t("settings.noDownloadsFolder") }); return; }
    try { await tauriOpenFolder(folder); } catch { setStatus({ type: "info", message: `${t("settings.openFolder")}: ${folder}` }); }
  }

  async function handleScanDownloads() {
    const folder = form.downloadsFolder || settings.downloadsFolder;
    if (!folder) { setStatus({ type: "error", message: t("settings.noDownloadsFolder") }); return; }
    const replayFolder = form.demoDirectory || settings.demoDirectory;
    if (!replayFolder) { setStatus({ type: "error", message: t("settings.noReplayFolder") }); return; }

    setScanning(true);
    try {
      const { candidates, errors } = await scanDownloadsFolder(folder);
      if (errors.length > 0) { setStatus({ type: "error", message: errors[0] }); return; }
      if (candidates.length === 0) { setStatus({ type: "info", message: t("settings.noNewDemos") }); return; }

      setStatus({ type: "info", message: t("home.demosFound", { count: candidates.length }) });
      const result = await processCandidates(candidates, replayFolder);
      await refreshDemos();

      const parts: string[] = [];
      if (result.processed.length > 0) parts.push(t("settings.downloadsSaved", { count: result.processed.length }));
      if (result.skipped.length > 0) parts.push(t("settings.downloadsSkipped", { count: result.skipped.length }));
      if (result.errors.length > 0) parts.push(t("settings.downloadsErrors", { count: result.errors.length }));

      setStatus({ type: result.processed.length > 0 ? "success" : "info", message: parts.join(" ") || t("settings.noNewDemos") });
    } catch (err) {
      setStatus({ type: "error", message: String(err) });
    } finally {
      setScanning(false);
    }
  }

  async function handlePickFolder(field: "demoDirectory" | "downloadsFolder") {
    if (!isTauri()) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, multiple: false });
      if (dir && typeof dir === "string") setForm((f) => ({ ...f, [field]: dir }));
    } catch { /* dialog not available */ }
  }

  async function handlePickFile(field: "cs2Path") {
    if (!isTauri()) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const file = await open({ multiple: false, filters: [{ name: "Executable", extensions: ["exe"] }] });
      if (file && typeof file === "string") setForm((f) => ({ ...f, [field]: file }));
    } catch { /* dialog not available */ }
  }

  async function handleDeactivate() {
    setDeactivating(true);
    try {
      const result = await deactivateLicense();
      if (result.success) {
        setStatus({ type: "success", message: t("license.deactivateSuccess") });
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setStatus({ type: "error", message: t("license.deactivateError") });
      }
    } finally {
      setDeactivating(false);
    }
  }

  const labelClass = "block text-white/60 text-xs font-medium mb-2";

  function PathInput({ label, value, onChange, placeholder, onBrowseDir, onBrowseFile, hint }: {
    label: string; value: string; onChange: (v: string) => void;
    placeholder: string; onBrowseDir?: () => void; onBrowseFile?: () => void; hint?: string;
  }) {
    return (
      <div>
        <label className={labelClass}>{label}</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-orange-500/50 transition-colors font-mono"
          />
          {isTauri() && (onBrowseDir || onBrowseFile) && (
            <button
              onClick={onBrowseDir ?? onBrowseFile}
              title={t("settings.browse")}
              className="px-3 py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 transition-all"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          )}
        </div>
        {hint && <p className="text-white/25 text-xs mt-2">{hint}</p>}
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">{t("settings.title")}</h1>
        <p className="text-white/40 text-sm mt-1">{t("settings.subtitle")}</p>
      </div>

      <div className="space-y-6">

        {/* ── Language ──────────────────────────────────────────────── */}
        <Section title={t("settings.language")} icon={Globe}>
          <select
            value={i18n.language.split("-")[0]}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-orange-500/50 transition-colors cursor-pointer"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code} className="bg-[#0d1117]">
                {lang.nativeLabel} ({lang.label})
              </option>
            ))}
          </select>
        </Section>

        {/* ── CS2-Pfad ──────────────────────────────────────────────── */}
        <Section title={t("settings.cs2Section")} icon={Crosshair}>
          {isTauri() && (
            <button
              onClick={handleAutoDetect}
              disabled={detecting}
              className={cn(
                "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-all duration-150 mb-4",
                "border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20 text-orange-300",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {detecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {detecting ? t("settings.detecting") : t("settings.cs2AutoDetect")}
            </button>
          )}

          <PathInput
            label={t("settings.cs2Path")}
            value={form.cs2Path}
            onChange={(v) => setForm((f) => ({ ...f, cs2Path: v }))}
            placeholder="C:\Program Files (x86)\Steam\...\game\bin\win64\cs2.exe"
            onBrowseFile={() => handlePickFile("cs2Path")}
          />

          <div className="mt-4">
            <PathInput
              label={t("settings.steamPath")}
              value={form.steamPath}
              onChange={(v) => setForm((f) => ({ ...f, steamPath: v }))}
              placeholder="C:\Program Files (x86)\Steam"
              onBrowseDir={() => {
                if (!isTauri()) return;
                import("@tauri-apps/plugin-dialog").then(({ open }) =>
                  open({ directory: true, multiple: false }).then((dir) => {
                    if (dir && typeof dir === "string") setForm((f) => ({ ...f, steamPath: dir }));
                  })
                );
              }}
            />
          </div>

          <div className="mt-4">
            <label className={labelClass}>{t("settings.steamId")}</label>
            <input
              type="text"
              value={form.steamId}
              onChange={(e) => setForm((f) => ({ ...f, steamId: e.target.value }))}
              placeholder="76561198012345678"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-orange-500/50 transition-colors font-mono"
            />
            <p className="text-white/25 text-xs mt-2">{t("settings.steamIdHint")}</p>
          </div>
        </Section>

        {/* ── Replay-Ordner ──────────────────────────────────────────── */}
        <Section title={t("settings.replaySection")} icon={FolderSearch}>
          <div className="mb-3 flex items-start gap-2 p-3 rounded-lg bg-orange-900/15 border border-orange-700/25">
            <Info className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
            <p className="text-orange-200/70 text-xs">{t("settings.replayInfo")}</p>
          </div>

          <PathInput
            label={t("settings.replayFolderPath")}
            value={form.demoDirectory}
            onChange={(v) => setForm((f) => ({ ...f, demoDirectory: v }))}
            placeholder="C:\...\Counter-Strike Global Offensive\game\csgo\replays"
            onBrowseDir={() => handlePickFolder("demoDirectory")}
          />

          {isTauri() && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={handleOpenReplayFolder}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white/50 hover:text-white/80 hover:bg-white/8 border border-white/10 transition-all"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {t("settings.openFolder")}
              </button>
              {form.steamPath && (
                <button
                  onClick={handleDetectReplayFolder}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white/50 hover:text-white/80 hover:bg-white/8 border border-white/10 transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t("settings.redetect")}
                </button>
              )}
              <button
                onClick={handleRefreshLibrary}
                disabled={refreshing}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white/50 hover:text-white/80 hover:bg-white/8 border border-white/10 transition-all disabled:opacity-50"
              >
                {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {t("settings.refreshLib")}
              </button>
            </div>
          )}
        </Section>

        {/* ── Downloads-Ordner ──────────────────────────────────────── */}
        <Section title={t("settings.downloadsSection")} icon={Download}>
          <div className="mb-3 flex items-start gap-2 p-3 rounded-lg bg-blue-900/15 border border-blue-700/25">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-blue-200/70 text-xs">{t("settings.downloadsInfo")}</p>
          </div>

          <PathInput
            label={t("settings.downloadsPath")}
            value={form.downloadsFolder}
            onChange={(v) => setForm((f) => ({ ...f, downloadsFolder: v }))}
            placeholder="C:\Users\Name\Downloads"
            onBrowseDir={() => handlePickFolder("downloadsFolder")}
          />

          {isTauri() && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={handleAutoDetectDownloads}
                disabled={detectingDownloads}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white/50 hover:text-white/80 hover:bg-white/8 border border-white/10 transition-all disabled:opacity-50"
              >
                {detectingDownloads ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                {t("settings.autoDetectDownloads")}
              </button>
              <button
                onClick={handleOpenDownloadsFolder}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white/50 hover:text-white/80 hover:bg-white/8 border border-white/10 transition-all"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {t("settings.openFolder")}
              </button>
              <button
                onClick={handleScanDownloads}
                disabled={scanning}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-orange-300 hover:text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 transition-all disabled:opacity-50"
              >
                {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {scanning ? t("settings.scanning") : t("settings.scanDownloads")}
              </button>
            </div>
          )}
        </Section>

        {/* ── Optionen ──────────────────────────────────────────────── */}
        <Section title={t("settings.optionsSection")}>
          <div className="space-y-4">
            <Toggle
              label={t("settings.autoExtract")}
              description={t("settings.autoExtractDesc")}
              value={form.autoExtractGz}
              onChange={(v) => setForm((f) => ({ ...f, autoExtractGz: v }))}
            />
            <Toggle
              label={t("settings.autoAdd")}
              description={t("settings.autoAddDesc")}
              value={form.autoAddToLibrary}
              onChange={(v) => setForm((f) => ({ ...f, autoAddToLibrary: v }))}
            />
          </div>
        </Section>

        {/* ── License ───────────────────────────────────────────────── */}
        <Section title={t("settings.licenseSection")} icon={Key}>
          {stored ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                <div>
                  <p className="text-green-300 text-sm font-medium">{t("settings.licensed")}</p>
                  <p className="text-white/30 text-xs font-mono mt-0.5">
                    {stored.key.slice(0, 8)}…
                    {licenseStatus === "offline_grace" && (
                      <span className="ml-2 text-yellow-400/60">(offline)</span>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={handleDeactivate}
                disabled={deactivating}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-red-400/70 hover:text-red-300 hover:bg-red-900/20 border border-red-900/30 transition-all disabled:opacity-50"
              >
                {deactivating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {deactivating ? t("settings.deactivating") : t("settings.deactivate")}
              </button>
            </div>
          ) : (
            <p className="text-white/40 text-sm">{t("license.subtitle")}</p>
          )}
        </Section>

        {/* Environment banners */}
        {!isTauri() && (
          <div className="flex items-start gap-3 p-4 rounded-xl border border-yellow-700/30 bg-yellow-900/15">
            <Info className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-300 text-sm font-medium">{t("settings.browserWarning")}</p>
              <p className="text-yellow-200/55 text-xs mt-1">{t("settings.browserWarningDesc")}</p>
            </div>
          </div>
        )}
        {isTauri() && (
          <div className="flex items-center gap-2 p-3 rounded-xl border border-green-700/25 bg-green-900/10">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <p className="text-green-300/80 text-xs">{t("settings.desktopActive")}</p>
          </div>
        )}

        <button
          onClick={handleSave}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all duration-150",
            saved
              ? "bg-green-600 text-white"
              : "bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-white"
          )}
        >
          <Save className="w-4 h-4" />
          {saved ? t("settings.saved") : t("settings.save")}
        </button>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }: {
  title: string; icon?: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div className="p-5 rounded-xl border border-white/8 bg-white/3">
      <div className="flex items-center gap-2 mb-4">
        {Icon && <Icon className="w-4 h-4 text-orange-400" />}
        <h2 className="text-white font-semibold text-sm">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, description, value, onChange }: {
  label: string; description: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-white/70 text-sm font-medium">{label}</p>
        <p className="text-white/30 text-xs mt-0.5">{description}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={cn(
          "relative shrink-0 w-11 h-6 rounded-full border transition-all duration-200",
          value
            ? "bg-orange-500 border-orange-500/60"
            : "bg-white/8 border-white/15"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200",
            value ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
    </div>
  );
}

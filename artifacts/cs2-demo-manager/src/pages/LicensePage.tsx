import { useState } from "react";
import { Key, Loader2, ExternalLink, CheckCircle2, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  activateGumroad,
  getLicenseStatus,
  getStoredLicense,
} from "../services/licenseService";
import { cn } from "@/lib/utils";

interface LicensePageProps {
  onActivated: () => void;
}

interface SectionState {
  key: string;
  loading: boolean;
  error: string | null;
  success: boolean;
}

const initialSection: SectionState = { key: "", loading: false, error: null, success: false };

export function LicensePage({ onActivated }: LicensePageProps) {
  const { t } = useTranslation();
  const [gr, setGr] = useState<SectionState>(initialSection);

  const status = getLicenseStatus();
  const stored = getStoredLicense();

  async function handleActivate() {
    if (!gr.key.trim()) return;
    setGr((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await activateGumroad(gr.key.trim());
      if (result.success) {
        setGr((s) => ({ ...s, success: true }));
        setTimeout(() => onActivated(), 1200);
      } else {
        setGr((s) => ({
          ...s,
          error: result.error === "network" ? t("license.errorNetwork") : t("license.errorInvalid"),
        }));
      }
    } finally {
      setGr((s) => ({ ...s, loading: false }));
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#0d1117]">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-orange-500/20 border border-orange-500/40 flex items-center justify-center mb-4">
            <Key className="w-8 h-8 text-orange-400" />
          </div>
          <h1 className="text-2xl font-bold text-white text-center">{t("license.title")}</h1>
          <p className="text-white/40 text-sm mt-2 text-center">{t("license.subtitle")}</p>
        </div>

        {/* Offline grace banner */}
        {status === "offline_grace" && stored && (
          <div className="mb-5 flex items-start gap-3 p-3.5 rounded-xl border border-yellow-700/30 bg-yellow-900/15">
            <WifiOff className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-yellow-300/80 text-sm">
              {t("license.offlineMode", { date: new Date(stored.validatedAt).toLocaleDateString() })}
            </p>
          </div>
        )}

        {/* Offline expired banner */}
        {status === "offline_expired" && (
          <div className="mb-5 flex items-start gap-3 p-3.5 rounded-xl border border-red-700/30 bg-red-900/15">
            <WifiOff className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300/80 text-sm">{t("license.offlineExpired")}</p>
          </div>
        )}

        {/* ── Gumroad section ── */}
        <div className="rounded-2xl border border-white/8 bg-white/3 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-white/70 text-sm font-semibold">{t("license.enterKey")}</span>
              <p className="text-white/30 text-xs mt-0.5">{t("license.gumroadHint")}</p>
            </div>
            <a
              href="https://ardihajdi.gumroad.com/l/easyDemo"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-orange-400 hover:text-orange-300 text-xs transition-colors shrink-0"
            >
              <ExternalLink className="w-3 h-3" />
              {t("license.buy")}
            </a>
          </div>

          <input
            type="text"
            value={gr.key}
            onChange={(e) => setGr((s) => ({ ...s, key: e.target.value, error: null }))}
            onKeyDown={(e) => e.key === "Enter" && handleActivate()}
            placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
            disabled={gr.loading || gr.success}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-orange-500/50 transition-colors font-mono disabled:opacity-40"
          />

          {gr.error && <p className="text-red-400 text-xs">{gr.error}</p>}

          <button
            onClick={handleActivate}
            disabled={!gr.key.trim() || gr.loading || gr.success}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm transition-all disabled:cursor-not-allowed",
              gr.success
                ? "bg-green-600 text-white"
                : "bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-white disabled:opacity-40"
            )}
          >
            {gr.success ? (
              <><CheckCircle2 className="w-4 h-4" />{t("license.success")}</>
            ) : gr.loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" />{t("license.activating")}</>
            ) : (
              <><Key className="w-4 h-4" />{t("license.activate")}</>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}

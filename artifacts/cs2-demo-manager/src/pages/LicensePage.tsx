import { useState } from "react";
import { Key, Loader2, ExternalLink, CheckCircle2, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  activateLicense,
  getLicenseStatus,
  getStoredLicense,
} from "../services/licenseService";
import { cn } from "@/lib/utils";

interface LicensePageProps {
  onActivated: () => void;
}

export function LicensePage({ onActivated }: LicensePageProps) {
  const { t } = useTranslation();
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const status = getLicenseStatus();
  const stored = getStoredLicense();

  async function handleActivate() {
    if (!key.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await activateLicense(key.trim());
      if (result.success) {
        setSuccess(true);
        setTimeout(() => onActivated(), 1200);
      } else {
        if (result.error === "network") {
          setError(t("license.errorNetwork"));
        } else {
          setError(t("license.errorInvalid"));
        }
      }
    } finally {
      setLoading(false);
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

        {/* Offline grace period banner */}
        {status === "offline_grace" && stored && (
          <div className="mb-4 flex items-start gap-3 p-3.5 rounded-xl border border-yellow-700/30 bg-yellow-900/15">
            <WifiOff className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-yellow-300/80 text-sm">
              {t("license.offlineMode", {
                date: new Date(stored.validatedAt).toLocaleDateString(),
              })}
            </p>
          </div>
        )}

        {/* Offline expired banner */}
        {status === "offline_expired" && (
          <div className="mb-4 flex items-start gap-3 p-3.5 rounded-xl border border-red-700/30 bg-red-900/15">
            <WifiOff className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300/80 text-sm">{t("license.offlineExpired")}</p>
          </div>
        )}

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="block text-white/60 text-xs font-medium mb-2">{t("license.keyLabel")}</label>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleActivate()}
              placeholder={t("license.keyPlaceholder")}
              disabled={loading || success}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-orange-500/50 transition-colors font-mono disabled:opacity-50"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <button
            onClick={handleActivate}
            disabled={!key.trim() || loading || success}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all duration-150 disabled:cursor-not-allowed",
              success
                ? "bg-green-600 text-white"
                : "bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-white disabled:opacity-40"
            )}
          >
            {success ? (
              <><CheckCircle2 className="w-4 h-4" />{t("license.success")}</>
            ) : loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" />{t("license.activating")}</>
            ) : (
              <><Key className="w-4 h-4" />{t("license.activate")}</>
            )}
          </button>
        </div>

        {/* Buy link */}
        <div className="mt-6 text-center">
          <a
            href="https://ardian.lemonsqueezy.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-orange-400 hover:text-orange-300 text-sm transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {t("license.buy")}
          </a>
        </div>
      </div>
    </div>
  );
}

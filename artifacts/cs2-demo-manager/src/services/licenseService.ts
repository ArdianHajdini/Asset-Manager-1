import {
  isTauri,
  tauriVerifyLicense,
  tauriValidateLicense,
  tauriDeactivateLicense,
} from "./tauriBridge";

const LS_KEY = "fedcs2_license";
const GRACE_DAYS = 7;

const LS_API = "https://api.lemonsqueezy.com/v1/licenses";
const GR_API = "https://api.gumroad.com/v2/licenses/verify";
const GR_PRODUCT_ID = "easyDemo";

interface StoredLicense {
  key: string;
  instanceId: string;
  validatedAt: string;
  provider: "lemonsqueezy" | "gumroad";
}

function load(): StoredLicense | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredLicense;
    if (!parsed.provider) parsed.provider = "lemonsqueezy";
    return parsed;
  } catch {
    return null;
  }
}

function save(data: StoredLicense) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

function clear() {
  localStorage.removeItem(LS_KEY);
}

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

export type LicenseStatus = "active" | "offline_grace" | "offline_expired" | "unlicensed";

export function getLicenseStatus(): LicenseStatus {
  const stored = load();
  if (!stored) return "unlicensed";
  const days = daysSince(stored.validatedAt);
  if (days <= GRACE_DAYS) return "offline_grace";
  return "offline_expired";
}

export function getStoredLicense(): StoredLicense | null {
  return load();
}

export interface ActivateResult {
  success: boolean;
  error?: "invalid" | "network" | string;
}

// ── Browser fallback: direct fetch (dev/preview only) ────────────────────────

async function browserTryLemonSqueezy(
  licenseKey: string
): Promise<{ success: boolean; instanceId: string; error: string }> {
  const instanceName = `FEDCS2-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  try {
    const res = await fetch(`${LS_API}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ license_key: licenseKey, instance_name: instanceName }).toString(),
    });
    const data = await res.json();
    if (data.activated && data.instance?.id) {
      return { success: true, instanceId: String(data.instance.id), error: "" };
    }
    return { success: false, instanceId: "", error: "invalid" };
  } catch {
    return { success: false, instanceId: "", error: "network" };
  }
}

async function browserTryGumroad(
  licenseKey: string,
  increment = true
): Promise<{ success: boolean; error: string }> {
  try {
    const params: Record<string, string> = { product_id: GR_PRODUCT_ID, license_key: licenseKey };
    if (increment) params.increment_uses_count = "true";
    const res = await fetch(GR_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(params).toString(),
    });
    const data = await res.json();
    return data.success ? { success: true, error: "" } : { success: false, error: "invalid" };
  } catch {
    return { success: false, error: "network" };
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function activateLicense(licenseKey: string): Promise<ActivateResult> {
  // In Tauri desktop: use Rust (reqwest — no CORS restrictions)
  if (isTauri()) {
    try {
      const result = await tauriVerifyLicense(licenseKey);
      if (result.success) {
        save({
          key: licenseKey,
          instanceId: result.instanceId ?? "",
          validatedAt: new Date().toISOString(),
          provider: result.provider === "gumroad" ? "gumroad" : "lemonsqueezy",
        });
        return { success: true };
      }
      return { success: false, error: result.error || "invalid" };
    } catch {
      return { success: false, error: "network" };
    }
  }

  // Browser fallback (dev preview — CORS may block Gumroad)
  const [lsResult, grResult] = await Promise.all([
    browserTryLemonSqueezy(licenseKey),
    browserTryGumroad(licenseKey, true),
  ]);
  if (lsResult.success) {
    save({ key: licenseKey, instanceId: lsResult.instanceId, validatedAt: new Date().toISOString(), provider: "lemonsqueezy" });
    return { success: true };
  }
  if (grResult.success) {
    save({ key: licenseKey, instanceId: "", validatedAt: new Date().toISOString(), provider: "gumroad" });
    return { success: true };
  }
  if (lsResult.error === "network" && grResult.error === "network") {
    return { success: false, error: "network" };
  }
  return { success: false, error: "invalid" };
}

export async function validateLicense(): Promise<boolean> {
  const stored = load();
  if (!stored) return false;

  try {
    if (isTauri()) {
      const ok = await tauriValidateLicense(stored.key, stored.instanceId, stored.provider);
      if (ok) {
        save({ ...stored, validatedAt: new Date().toISOString() });
        return true;
      }
      return false;
    }

    // Browser fallback
    if (stored.provider === "gumroad") {
      const gr = await browserTryGumroad(stored.key, false);
      if (gr.success) {
        save({ ...stored, validatedAt: new Date().toISOString() });
        return true;
      }
      return false;
    } else {
      const res = await fetch(`${LS_API}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ license_key: stored.key, instance_id: stored.instanceId }).toString(),
      });
      const data = await res.json();
      if (data.valid) {
        save({ ...stored, validatedAt: new Date().toISOString() });
        return true;
      }
      return false;
    }
  } catch {
    return false;
  }
}

export interface DeactivateResult {
  success: boolean;
  error?: string;
}

export async function deactivateLicense(): Promise<DeactivateResult> {
  const stored = load();
  if (!stored) return { success: true };

  if (stored.provider === "gumroad") {
    clear();
    return { success: true };
  }

  try {
    if (isTauri()) {
      const ok = await tauriDeactivateLicense(stored.key, stored.instanceId);
      if (ok) {
        clear();
        return { success: true };
      }
      return { success: false, error: "deactivate_failed" };
    }

    // Browser fallback
    const res = await fetch(`${LS_API}/deactivate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ license_key: stored.key, instance_id: stored.instanceId }).toString(),
    });
    const data = await res.json();
    if (data.deactivated) {
      clear();
      return { success: true };
    }
    return { success: false, error: data.error };
  } catch {
    return { success: false, error: "network" };
  }
}

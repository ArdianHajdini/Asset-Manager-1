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

export function clearStoredLicense() {
  clear();
}

export interface ActivateResult {
  success: boolean;
  error?: "invalid" | "network" | string;
}

// ── Activate LemonSqueezy ─────────────────────────────────────────────────

export async function activateLemonSqueezy(licenseKey: string): Promise<ActivateResult> {
  if (isTauri()) {
    try {
      const result = await tauriVerifyLicense(licenseKey, "lemonsqueezy");
      if (result.success) {
        save({ key: licenseKey, instanceId: result.instanceId ?? "", validatedAt: new Date().toISOString(), provider: "lemonsqueezy" });
        return { success: true };
      }
      return { success: false, error: result.error || "invalid" };
    } catch {
      return { success: false, error: "network" };
    }
  }
  // Browser fallback (dev/preview — CORS may limit this)
  const instanceName = `FEDCS2-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  try {
    const res = await fetch(`${LS_API}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ license_key: licenseKey, instance_name: instanceName }).toString(),
    });
    const data = await res.json();
    if (data.activated && data.instance?.id) {
      save({ key: licenseKey, instanceId: String(data.instance.id), validatedAt: new Date().toISOString(), provider: "lemonsqueezy" });
      return { success: true };
    }
    return { success: false, error: "invalid" };
  } catch {
    return { success: false, error: "network" };
  }
}

// ── Activate Gumroad ──────────────────────────────────────────────────────

export async function activateGumroad(licenseKey: string): Promise<ActivateResult> {
  if (isTauri()) {
    try {
      const result = await tauriVerifyLicense(licenseKey, "gumroad");
      if (result.success) {
        save({ key: licenseKey, instanceId: "", validatedAt: new Date().toISOString(), provider: "gumroad" });
        return { success: true };
      }
      return { success: false, error: result.error || "invalid" };
    } catch {
      return { success: false, error: "network" };
    }
  }
  // Browser fallback
  try {
    const res = await fetch(GR_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ product_id: GR_PRODUCT_ID, license_key: licenseKey, increment_uses_count: "true" }).toString(),
    });
    const data = await res.json();
    if (data.success) {
      save({ key: licenseKey, instanceId: "", validatedAt: new Date().toISOString(), provider: "gumroad" });
      return { success: true };
    }
    return { success: false, error: "invalid" };
  } catch {
    return { success: false, error: "network" };
  }
}

// ── Validate on startup ───────────────────────────────────────────────────

export type ValidateOnlineResult = "valid" | "invalid" | "offline";

export async function validateLicenseOnline(): Promise<ValidateOnlineResult> {
  const stored = load();
  if (!stored) return "invalid";

  try {
    if (isTauri()) {
      const result = await tauriValidateLicense(stored.key, stored.instanceId, stored.provider);
      if (result.offline) return "offline";
      if (result.valid) {
        save({ ...stored, validatedAt: new Date().toISOString() });
        return "valid";
      }
      return "invalid";
    }

    // Browser fallback
    if (stored.provider === "gumroad") {
      const res = await fetch(GR_API, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ product_id: GR_PRODUCT_ID, license_key: stored.key }).toString(),
      });
      const data = await res.json();
      if (data.success) {
        save({ ...stored, validatedAt: new Date().toISOString() });
        return "valid";
      }
      return "invalid";
    } else {
      const res = await fetch(`${LS_API}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ license_key: stored.key, instance_id: stored.instanceId }).toString(),
      });
      const data = await res.json();
      if (data.valid) {
        save({ ...stored, validatedAt: new Date().toISOString() });
        return "valid";
      }
      return "invalid";
    }
  } catch {
    return "offline";
  }
}

// ── Deactivate ────────────────────────────────────────────────────────────

export interface DeactivateResult {
  success: boolean;
  error?: string;
}

export async function deactivateLicense(): Promise<DeactivateResult> {
  const stored = load();
  if (!stored) return { success: true };

  // Always clear locally first — the user must always be able to deactivate
  clear();

  // Gumroad has no server-side deactivation API — done
  if (!stored.provider || stored.provider === "gumroad") {
    return { success: true };
  }

  // LemonSqueezy: notify server best-effort (don't block on failure)
  if (stored.instanceId) {
    try {
      if (isTauri()) {
        await tauriDeactivateLicense(stored.key, stored.instanceId);
      } else {
        await fetch(`${LS_API}/deactivate`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ license_key: stored.key, instance_id: stored.instanceId }).toString(),
        });
      }
    } catch {
      // Server notification failed — key is already cleared locally, that's fine
    }
  }

  return { success: true };
}

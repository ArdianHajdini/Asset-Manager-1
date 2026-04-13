import {
  isTauri,
  tauriVerifyLicense,
  tauriValidateLicense,
} from "./tauriBridge";

const LS_KEY = "fedcs2_license";
const GRACE_DAYS = 7;

const GR_API = "https://api.gumroad.com/v2/licenses/verify";
const GR_PRODUCT_ID = "2yW8xYHXZ3Zp4EswsRVqqA==";

interface StoredLicense {
  key: string;
  instanceId: string;
  validatedAt: string;
  provider: "gumroad";
}

function load(): StoredLicense | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredLicense;
    parsed.provider = "gumroad";
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
      const result = await tauriValidateLicense(stored.key, "", "gumroad");
      if (result.offline) return "offline";
      if (result.valid) {
        save({ ...stored, validatedAt: new Date().toISOString() });
        return "valid";
      }
      return "invalid";
    }

    // Browser fallback
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
  // Always clear locally — Gumroad has no server-side deactivation API
  clear();
  return { success: true };
}

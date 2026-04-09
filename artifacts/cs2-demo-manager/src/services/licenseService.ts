const LS_KEY = "fedcs2_license";
const GRACE_DAYS = 7;

const LS_API = "https://api.lemonsqueezy.com/v1/licenses";

interface StoredLicense {
  key: string;
  instanceId: string;
  validatedAt: string;
}

function load(): StoredLicense | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as StoredLicense) : null;
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

export async function activateLicense(licenseKey: string): Promise<ActivateResult> {
  const instanceName = `FEDCS2-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  try {
    const res = await fetch(`${LS_API}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ license_key: licenseKey, instance_name: instanceName }).toString(),
    });
    const data = await res.json();
    if (data.activated && data.instance?.id) {
      save({ key: licenseKey, instanceId: data.instance.id, validatedAt: new Date().toISOString() });
      return { success: true };
    }
    if (data.error) {
      const msg: string = data.error.toLowerCase();
      if (msg.includes("invalid") || msg.includes("expired") || msg.includes("disabled")) {
        return { success: false, error: "invalid" };
      }
    }
    return { success: false, error: data.error ?? "invalid" };
  } catch {
    return { success: false, error: "network" };
  }
}

export async function validateLicense(): Promise<boolean> {
  const stored = load();
  if (!stored) return false;
  try {
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
  try {
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

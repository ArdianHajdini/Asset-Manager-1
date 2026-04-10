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

async function tryLemonSqueezy(
  licenseKey: string
): Promise<ActivateResult & { instanceId?: string }> {
  const instanceName = `FEDCS2-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  try {
    const res = await fetch(`${LS_API}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ license_key: licenseKey, instance_name: instanceName }).toString(),
    });
    const data = await res.json();
    if (data.activated && data.instance?.id) {
      return { success: true, instanceId: data.instance.id };
    }
    const msg: string = (data.error ?? "").toLowerCase();
    if (msg.includes("invalid") || msg.includes("expired") || msg.includes("disabled")) {
      return { success: false, error: "invalid" };
    }
    return { success: false, error: data.error ?? "invalid" };
  } catch {
    return { success: false, error: "network" };
  }
}

async function tryGumroad(licenseKey: string, incrementUses = true): Promise<ActivateResult> {
  try {
    const params: Record<string, string> = {
      product_id: GR_PRODUCT_ID,
      license_key: licenseKey,
    };
    if (incrementUses) params.increment_uses_count = "true";
    const res = await fetch(GR_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(params).toString(),
    });
    const data = await res.json();
    if (data.success) return { success: true };
    return { success: false, error: "invalid" };
  } catch {
    return { success: false, error: "network" };
  }
}

export async function activateLicense(licenseKey: string): Promise<ActivateResult> {
  const lsResult = await tryLemonSqueezy(licenseKey);
  if (lsResult.success && lsResult.instanceId) {
    save({
      key: licenseKey,
      instanceId: lsResult.instanceId,
      validatedAt: new Date().toISOString(),
      provider: "lemonsqueezy",
    });
    return { success: true };
  }
  if (lsResult.error === "network") {
    return { success: false, error: "network" };
  }

  const grResult = await tryGumroad(licenseKey, true);
  if (grResult.success) {
    save({
      key: licenseKey,
      instanceId: "",
      validatedAt: new Date().toISOString(),
      provider: "gumroad",
    });
    return { success: true };
  }
  if (grResult.error === "network") {
    return { success: false, error: "network" };
  }

  return { success: false, error: "invalid" };
}

export async function validateLicense(): Promise<boolean> {
  const stored = load();
  if (!stored) return false;
  try {
    if (stored.provider === "gumroad") {
      const grResult = await tryGumroad(stored.key, false);
      if (grResult.success) {
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

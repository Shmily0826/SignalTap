import {
  ExtractedContent,
  RelevanceProfile,
  StoredAnalysis,
} from "@signaltap/schemas";

export type { StoredAnalysis };

/**
 * Local cache + history. Everything is stored in chrome.storage.local, so
 * nothing leaves the user's machine. A fallback in-memory map keeps the pure
 * logic testable and lets the code run in non-extension contexts.
 */

export interface Settings {
  profile: RelevanceProfile;
  historyEnabled: boolean;
  contentRetention: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  profile: "general",
  historyEnabled: true,
  contentRetention: true,
};

/* ------------------------------ fingerprint ------------------------------- */

/** FNV-1a 32-bit hash; deterministic, no crypto dependency needed. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Content fingerprint: stable across extraction runs for the SAME page
 * content, and changes when the underlying content materially changes.
 * Ignores volatile fields like position/score formatting.
 */
export function contentFingerprint(extracted: ExtractedContent): string {
  const parts = [
    extracted.adapter,
    extracted.adapterVersion,
    extracted.schemaVersion,
    extracted.captureScope,
    extracted.title ?? "",
    ...extracted.mainContent.map((m) => `${m.id}|${m.text}`),
    ...extracted.discussionItems.map(
      (d) => `${d.id}|${d.parentId}|${d.author}|${d.text}|${d.score}`
    ),
  ];
  return fnv1a(parts.join("\u0001"));
}

export function cacheKey(
  url: string,
  extracted: ExtractedContent,
  profile: RelevanceProfile
): string {
  return fnv1a(`${url}\u0001${contentFingerprint(extracted)}\u0001${profile}`);
}

/* ------------------------------ storage layer ----------------------------- */

type StorageLike = {
  get: (keys: string[] | string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string[]) => Promise<void>;
};

const mem: Record<string, unknown> = {};

function storage(): StorageLike | null {
  const cs = (globalThis as any).chrome?.storage?.local;
  return cs ?? null;
}

const HISTORY_KEY = "sigsoil_history";
const SETTINGS_KEY = "sigsoil_settings";

async function getObj(key: string): Promise<Record<string, unknown>> {
  const s = storage();
  if (!s) return (mem[key] as Record<string, unknown>) ?? {};
  try {
    const v = await s.get(key);
    return (v[key] as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

async function setObj(key: string, obj: Record<string, unknown>): Promise<void> {
  const s = storage();
  if (!s) {
    mem[key] = obj;
    return;
  }
  try {
    await s.set({ [key]: obj });
  } catch {
    /* storage full - ignore */
  }
}

export async function getSettings(): Promise<Settings> {
  const raw = await getObj(SETTINGS_KEY);
  const profile =
    raw.profile && (["general", "developer", "student", "researcher", "product_manager", "creator"] as string[]).includes(raw.profile as string)
      ? (raw.profile as RelevanceProfile)
      : DEFAULT_SETTINGS.profile;
  return {
    profile,
    historyEnabled: raw.historyEnabled !== false,
    contentRetention: raw.contentRetention !== false,
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await setObj(SETTINGS_KEY, next as unknown as Record<string, unknown>);
  return next;
}

export async function getCached(key: string): Promise<StoredAnalysis | null> {
  const obj = await getObj(HISTORY_KEY);
  const entry = obj[key] as StoredAnalysis | undefined;
  if (!entry) return null;
  return entry;
}

export async function putCached(
  key: string,
  entry: Omit<StoredAnalysis, "key">,
  limit = 50
): Promise<void> {
  const obj = await getObj(HISTORY_KEY);
  const entries = Object.values(obj) as StoredAnalysis[];
  const sorted = entries.sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1));
  if (sorted.length >= limit) {
    const victims = sorted.slice(limit - 1).map((e) => e.key);
    for (const v of victims) delete obj[v];
  }
  obj[key] = { ...entry, key };
  await setObj(HISTORY_KEY, obj);
}

export async function listHistory(): Promise<StoredAnalysis[]> {
  const obj = await getObj(HISTORY_KEY);
  return (Object.values(obj) as StoredAnalysis[]).sort((a, b) =>
    b.createdAt < a.createdAt ? -1 : 1
  );
}

export async function deleteCached(key: string): Promise<void> {
  const obj = await getObj(HISTORY_KEY);
  delete obj[key];
  await setObj(HISTORY_KEY, obj);
}

export async function clearHistory(): Promise<void> {
  await setObj(HISTORY_KEY, {});
}

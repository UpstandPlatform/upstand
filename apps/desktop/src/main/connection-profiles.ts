import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import type { DesktopConnectionProfile } from "../shared/connection";
import { normalizeUpstandOrigin } from "../shared/connection";

/** Map from runtime mode to the control-plane mode string used by the API. */
export type ConnectionMode = "desktop" | "self-hosted" | "cloud";

export interface ConnectionProfileStore {
  activeProfileId: string | null;
  profiles: DesktopConnectionProfile[];
}

function profilesFile(): string {
  return join(app.getPath("userData"), "connection-profiles.json");
}

async function readProfileStore(): Promise<ConnectionProfileStore> {
  try {
    const raw = await readFile(profilesFile(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "profiles" in parsed &&
      Array.isArray((parsed as ConnectionProfileStore).profiles)
    ) {
      return parsed as ConnectionProfileStore;
    }
  } catch {
    // Missing or corrupt — start fresh
  }
  return { activeProfileId: null, profiles: [] };
}

async function writeProfileStore(store: ConnectionProfileStore): Promise<void> {
  const file = profilesFile();
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tmp, file);
}

// ---------------------------------------------------------------------------
// Public API

export async function listConnectionProfiles(): Promise<
  DesktopConnectionProfile[]
> {
  const store = await readProfileStore();
  return store.profiles;
}

export async function getActiveProfile(): Promise<DesktopConnectionProfile | null> {
  const store = await readProfileStore();
  if (!store.activeProfileId) return store.profiles[0] ?? null;
  return store.profiles.find((p) => p.id === store.activeProfileId) ?? null;
}

export async function addConnectionProfile(opts: {
  name: string;
  mode: ConnectionMode;
  origin: string;
  setActive?: boolean;
}): Promise<DesktopConnectionProfile> {
  const normalized = normalizeUpstandOrigin(opts.origin);
  const store = await readProfileStore();

  const existing = store.profiles.find((p) => p.origin === normalized);
  if (existing) {
    if (opts.setActive) {
      store.activeProfileId = existing.id;
      await writeProfileStore(store);
    }
    return existing;
  }

  const profile: DesktopConnectionProfile = {
    id: randomUUID(),
    name: opts.name,
    mode: opts.mode,
    origin: normalized,
    isActive: false,
  };

  // Mark all others inactive, mark new one active
  store.profiles = store.profiles.map((p) => ({ ...p, isActive: false }));
  profile.isActive = true;
  store.profiles.push(profile);

  if (opts.setActive || store.profiles.length === 1) {
    store.activeProfileId = profile.id;
  }

  await writeProfileStore(store);
  return profile;
}

export async function removeConnectionProfile(id: string): Promise<boolean> {
  const store = await readProfileStore();
  const before = store.profiles.length;
  store.profiles = store.profiles.filter((p) => p.id !== id);

  if (store.activeProfileId === id) {
    store.activeProfileId = store.profiles[0]?.id ?? null;
  }

  if (store.profiles.length === before) return false;
  await writeProfileStore(store);
  return true;
}

export async function setActiveConnectionProfile(
  id: string,
): Promise<DesktopConnectionProfile | null> {
  const store = await readProfileStore();
  const profile = store.profiles.find((p) => p.id === id);
  if (!profile) return null;

  store.profiles = store.profiles.map((p) => ({
    ...p,
    isActive: p.id === id,
  }));
  store.activeProfileId = id;

  await writeProfileStore(store);
  return { ...profile, isActive: true };
}

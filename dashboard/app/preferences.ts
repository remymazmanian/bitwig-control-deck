"use client";

import { useEffect, useSyncExternalStore } from "react";

export const FORMATS = ["ALL", "VST3", "VST2", "AU", "CLAP"] as const;
export type PluginFormat = (typeof FORMATS)[number];
export type Accent = "acid" | "cyan" | "amber";

export type DeckPreferences = {
  apiBase: string;
  autoRefresh: boolean;
  refreshMs: number;
  defaultFormat: PluginFormat;
  resultLimit: number;
  compactRows: boolean;
  confirmReindex: boolean;
  showConnectionDetail: boolean;
  accent: Accent;
  reducedMotion: boolean;
};

export const DEFAULT_PREFERENCES: DeckPreferences = {
  apiBase: process.env.NEXT_PUBLIC_CONTROL_DECK_API || "http://127.0.0.1:50702",
  autoRefresh: true,
  refreshMs: 5000,
  defaultFormat: "ALL",
  resultLimit: 120,
  compactRows: false,
  confirmReindex: true,
  showConnectionDetail: true,
  accent: "acid",
  reducedMotion: false,
};

const STORAGE_KEY = "control-deck.preferences.v1";
const PREFERENCES_EVENT = "control-deck-preferences-change";

function normalizeApiBase(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function applyPreferences(preferences: DeckPreferences) {
  const root = document.documentElement;
  root.dataset.accent = preferences.accent;
  root.dataset.density = preferences.compactRows ? "compact" : "comfortable";
  root.dataset.motion = preferences.reducedMotion ? "reduced" : "full";
}

export function readPreferences(): DeckPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const savedValue = window.localStorage.getItem(STORAGE_KEY);
    const saved = JSON.parse(savedValue || "{}");
    return {
      ...DEFAULT_PREFERENCES,
      ...saved,
      apiBase: normalizeApiBase(saved.apiBase || DEFAULT_PREFERENCES.apiBase),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function storePreferences(preferences: DeckPreferences) {
  const next = { ...preferences, apiBase: normalizeApiBase(preferences.apiBase) };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  applyPreferences(next);
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: next }));
}

export function resetPreferences() {
  window.localStorage.removeItem(STORAGE_KEY);
  applyPreferences(DEFAULT_PREFERENCES);
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: DEFAULT_PREFERENCES }));
}

// Preferences live in localStorage, so the hook reads them as an external
// store. The snapshot is cached by the raw stored string so React sees a
// stable object until the stored value actually changes.
let cachedRaw: string | null | undefined;
let cachedPreferences: DeckPreferences = DEFAULT_PREFERENCES;

function readStoredRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function getPreferencesSnapshot(): DeckPreferences {
  const raw = readStoredRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPreferences = raw === null ? DEFAULT_PREFERENCES : readPreferences();
  }
  return cachedPreferences;
}

function getServerPreferences(): DeckPreferences {
  return DEFAULT_PREFERENCES;
}

function subscribePreferences(onChange: () => void) {
  window.addEventListener(PREFERENCES_EVENT, onChange);
  return () => window.removeEventListener(PREFERENCES_EVENT, onChange);
}

function subscribeNothing() {
  return () => {};
}

export function useDeckPreferences() {
  const preferences = useSyncExternalStore(subscribePreferences, getPreferencesSnapshot, getServerPreferences);
  const ready = useSyncExternalStore(subscribeNothing, () => true, () => false);

  useEffect(() => {
    applyPreferences(preferences);
  }, [preferences]);

  return { preferences, ready };
}

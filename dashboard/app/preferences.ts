"use client";

import { useEffect, useState } from "react";

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

export function useDeckPreferences() {
  const [preferences, setPreferences] = useState<DeckPreferences>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = readPreferences();
    setPreferences(saved);
    applyPreferences(saved);
    setReady(true);

    const onChange = (event: Event) => {
      const next = (event as CustomEvent<DeckPreferences>).detail || readPreferences();
      setPreferences(next);
      applyPreferences(next);
    };
    window.addEventListener(PREFERENCES_EVENT, onChange);
    return () => window.removeEventListener(PREFERENCES_EVENT, onChange);
  }, []);

  return { preferences, setPreferences, ready };
}

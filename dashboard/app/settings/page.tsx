"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandHeader } from "../brand-header";
import {
  DEFAULT_PREFERENCES,
  FORMATS,
  resetPreferences,
  storePreferences,
  useDeckPreferences,
  type Accent,
  type DeckPreferences,
  type PluginFormat,
} from "../preferences";

type ConnectionState = "idle" | "testing" | "online" | "offline";

export default function SettingsPage() {
  const { preferences, ready } = useDeckPreferences();
  const [draft, setDraft] = useState<DeckPreferences>(DEFAULT_PREFERENCES);
  const [saved, setSaved] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("idle");

  useEffect(() => {
    if (ready) setDraft(preferences);
  }, [ready, preferences]);

  function update<K extends keyof DeckPreferences>(key: K, value: DeckPreferences[K]) {
    setDraft(current => ({ ...current, [key]: value }));
    setSaved(false);
  }

  function save() {
    storePreferences(draft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  function restoreDefaults() {
    if (!window.confirm("Restore all Bitwig Control Deck settings to their defaults?")) return;
    resetPreferences();
    setDraft(DEFAULT_PREFERENCES);
    setConnection("idle");
    setSaved(true);
  }

  async function testConnection() {
    setConnection("testing");
    try {
      const endpoint = draft.apiBase.trim().replace(/\/+$/, "");
      const response = await fetch(`${endpoint}/health`, { cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      setConnection("online");
    } catch {
      setConnection("offline");
    }
  }

  return (
    <main className="deck-shell settings-shell">
      <BrandHeader active="settings" />

      <section className="settings-hero">
        <div>
          <p className="eyebrow">DECK PREFERENCES</p>
          <h1>Make the deck yours.</h1>
          <p>Control how Control Deck connects, refreshes, filters, and feels. Preferences stay on this Mac.</p>
        </div>
        <div className="settings-summary">
          <span>PROFILE</span>
          <strong>Studio default</strong>
          <small>Device-local · no cloud sync</small>
        </div>
      </section>

      <div className="settings-layout">
        <nav className="settings-index" aria-label="Settings sections">
          <a href="#connection">Connection</a>
          <a href="#monitoring">Monitoring</a>
          <a href="#library">Plug-in library</a>
          <a href="#appearance">Appearance</a>
          <a href="#maintenance">Maintenance</a>
        </nav>

        <div className="settings-stack">
          <SettingsSection
            id="connection"
            eyebrow="LOCAL BRIDGE"
            title="Connection"
            description="Choose where the deck finds the Control Deck bridge on this Mac."
          >
            <div className="setting-row setting-row-stack">
              <div className="setting-copy">
                <label htmlFor="api-base">Bridge address</label>
                <p>Keep the loopback default unless the local service uses a different port.</p>
              </div>
              <div className="endpoint-control">
                <input
                  id="api-base"
                  value={draft.apiBase}
                  onChange={event => update("apiBase", event.target.value)}
                  inputMode="url"
                  spellCheck={false}
                />
                <button type="button" onClick={testConnection} disabled={connection === "testing"}>
                  {connection === "testing" ? "TESTING…" : "TEST"}
                </button>
              </div>
              {connection !== "idle" && (
                <div className={`connection-result ${connection}`}>
                  <span />
                  {connection === "online" ? "Bridge responded successfully." :
                    connection === "offline" ? "No bridge responded at this address." :
                      "Checking the local bridge…"}
                </div>
              )}
            </div>
          </SettingsSection>

          <SettingsSection
            id="monitoring"
            eyebrow="LIVE SESSION"
            title="Monitoring"
            description="Tune the amount and pace of live session feedback."
          >
            <ToggleRow
              label="Auto-refresh session status"
              description="Keep project, transport, track, and device information current."
              checked={draft.autoRefresh}
              onChange={value => update("autoRefresh", value)}
            />
            <SelectRow
              label="Refresh interval"
              description="Faster refresh uses slightly more local processing."
              value={String(draft.refreshMs)}
              disabled={!draft.autoRefresh}
              onChange={value => update("refreshMs", Number(value))}
              options={[
                ["2500", "2.5 seconds"],
                ["5000", "5 seconds"],
                ["10000", "10 seconds"],
                ["30000", "30 seconds"],
              ]}
            />
            <ToggleRow
              label="Show bridge details"
              description="Display the local error detail when Bitwig is unavailable."
              checked={draft.showConnectionDetail}
              onChange={value => update("showConnectionDetail", value)}
            />
          </SettingsSection>

          <SettingsSection
            id="library"
            eyebrow="INVENTORY"
            title="Plug-in library"
            description="Set the default scope and density of the indexed plug-in list."
          >
            <SelectRow
              label="Default format"
              description="Open the deck with this plug-in format already selected."
              value={draft.defaultFormat}
              onChange={value => update("defaultFormat", value as PluginFormat)}
              options={FORMATS.map(item => [item, item === "ALL" ? "All formats" : item])}
            />
            <SelectRow
              label="Maximum results"
              description="Limit how many matching plug-ins appear at once."
              value={String(draft.resultLimit)}
              onChange={value => update("resultLimit", Number(value))}
              options={[["60", "60 plug-ins"], ["120", "120 plug-ins"], ["240", "240 plug-ins"]]}
            />
            <ToggleRow
              label="Compact list"
              description="Fit more plug-ins and devices into the visible deck."
              checked={draft.compactRows}
              onChange={value => update("compactRows", value)}
            />
            <ToggleRow
              label="Confirm before reindexing"
              description="Ask before scanning the installed plug-in library."
              checked={draft.confirmReindex}
              onChange={value => update("confirmReindex", value)}
            />
          </SettingsSection>

          <SettingsSection
            id="appearance"
            eyebrow="INTERFACE"
            title="Appearance"
            description="Adjust the signal color and motion to suit your workspace."
          >
            <div className="setting-row">
              <div className="setting-copy">
                <span className="setting-label">Signal color</span>
                <p>Used for online states, selected filters, and focus accents.</p>
              </div>
              <div className="swatch-group" role="radiogroup" aria-label="Signal color">
                {(["acid", "cyan", "amber"] as Accent[]).map(accent => (
                  <button
                    key={accent}
                    type="button"
                    role="radio"
                    aria-checked={draft.accent === accent}
                    className={`swatch ${accent} ${draft.accent === accent ? "selected" : ""}`}
                    onClick={() => update("accent", accent)}
                  >
                    <span />
                    {accent}
                  </button>
                ))}
              </div>
            </div>
            <ToggleRow
              label="Reduce motion"
              description="Disable signal pulse animation throughout the deck."
              checked={draft.reducedMotion}
              onChange={value => update("reducedMotion", value)}
            />
          </SettingsSection>

          <SettingsSection
            id="maintenance"
            eyebrow="MAINTENANCE"
            title="Reset"
            description="Return every preference to the Control Deck defaults."
          >
            <div className="setting-row">
              <div className="setting-copy">
                <span className="setting-label">Restore default settings</span>
                <p>This does not change Bitwig or rebuild your plug-in index.</p>
              </div>
              <button className="secondary-button danger" type="button" onClick={restoreDefaults}>RESTORE DEFAULTS</button>
            </div>
          </SettingsSection>
        </div>
      </div>

      <div className="save-bar">
        <div>
          <span className={`save-indicator ${saved ? "visible" : ""}`}>SAVED</span>
          <p>Changes take effect when you save.</p>
        </div>
        <div className="save-actions">
          <Link href="/">CANCEL</Link>
          <button type="button" onClick={save}>SAVE SETTINGS</button>
        </div>
      </div>

      <footer>
        <span>BITWIG CONTROL DECK · PREFERENCES</span>
        <span>DEVICE-LOCAL SETTINGS</span>
      </footer>
    </main>
  );
}

function SettingsSection({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-card" id={id}>
      <div className="settings-card-head">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <span className="setting-label">{label}</span>
        <p>{description}</p>
      </div>
      <button
        type="button"
        className={`toggle ${checked ? "on" : ""}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

function SelectRow({
  label,
  description,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`setting-row ${disabled ? "disabled" : ""}`}>
      <span className="setting-copy">
        <span className="setting-label">{label}</span>
        <span className="setting-description">{description}</span>
      </span>
      <span className="select-wrap">
        <select value={value} onChange={event => onChange(event.target.value)} disabled={disabled}>
          {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
        </select>
      </span>
    </label>
  );
}

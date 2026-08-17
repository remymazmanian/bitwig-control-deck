"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrandHeader } from "./brand-header";
import { FORMATS, useDeckPreferences, type PluginFormat } from "./preferences";

type Plugin = {
  id: string;
  name: string;
  manufacturers: string[];
  formats: string[];
  versions: string[];
  locations: string[];
};

type PluginPage = {
  generatedAt: string | null;
  total: number;
  plugins: Plugin[];
};

type Device = {
  index: number;
  name: string;
  type: string;
  plugin: boolean;
  enabled: boolean;
  windowOpen: boolean;
};

type Snapshot = {
  service: { state: string; name: string; version: string; localOnly: boolean };
  bridge: {
    state: "online" | "waiting";
    message: string;
    detail?: string;
    status: null | {
      project: string;
      projectModified: boolean;
      transport: { playing: boolean; recording: boolean; tempo: number; tempoDisplay: string };
      selectedTrack: null | { name: string; position: number };
      selectedDevice: null | { name: string; position: number };
    };
    tracks: null | { total: number };
    devices: null | { total: number; devices: Device[] };
  };
  library: {
    generatedAt: string | null;
    uniquePlugins: number;
    pluginBundles: number;
    formatCounts: Record<string, number>;
  };
};

function compactNumber(value: number | undefined) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function timeLabel(value: string | null | undefined) {
  if (!value) return "Not indexed yet";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function Home() {
  const { preferences, ready } = useDeckPreferences();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [plugins, setPlugins] = useState<PluginPage>({ generatedAt: null, total: 0, plugins: [] });
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<PluginFormat>("ALL");
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [serviceError, setServiceError] = useState(false);

  useEffect(() => {
    if (ready) setFormat(preferences.defaultFormat);
  }, [ready, preferences.defaultFormat]);

  const loadSnapshot = useCallback(async () => {
    try {
      const response = await fetch(`${preferences.apiBase}/snapshot`, { cache: "no-store" });
      if (!response.ok) throw new Error("Snapshot unavailable");
      setSnapshot(await response.json());
      setServiceError(false);
    } catch {
      setServiceError(true);
    } finally {
      setLoading(false);
    }
  }, [preferences.apiBase]);

  const loadPlugins = useCallback(async (search: string, selectedFormat: string) => {
    try {
      const params = new URLSearchParams({
        query: search,
        format: selectedFormat,
        limit: String(preferences.resultLimit),
      });
      const response = await fetch(`${preferences.apiBase}/plugins?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Plugin inventory unavailable");
      setPlugins(await response.json());
    } catch {
      setServiceError(true);
    }
  }, [preferences.apiBase, preferences.resultLimit]);

  useEffect(() => {
    if (!ready) return;
    loadSnapshot();
    if (!preferences.autoRefresh) return;
    const timer = window.setInterval(loadSnapshot, preferences.refreshMs);
    return () => window.clearInterval(timer);
  }, [ready, loadSnapshot, preferences.autoRefresh, preferences.refreshMs]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => loadPlugins(query, format), 180);
    return () => window.clearTimeout(timer);
  }, [ready, query, format, loadPlugins]);

  async function rebuildIndex() {
    if (preferences.confirmReindex && !window.confirm("Refresh the complete plug-in index now?")) return;
    setReindexing(true);
    try {
      const response = await fetch(`${preferences.apiBase}/plugins/reindex`, { method: "POST" });
      if (!response.ok) throw new Error("Reindex failed");
      await Promise.all([loadSnapshot(), loadPlugins(query, format)]);
      setServiceError(false);
    } catch {
      setServiceError(true);
    } finally {
      setReindexing(false);
    }
  }

  const online = snapshot?.bridge.state === "online";
  const status = snapshot?.bridge.status;
  const devices = snapshot?.bridge.devices?.devices || [];
  const shownPluginCount = useMemo(() => plugins.plugins.length, [plugins.plugins]);
  const connectionMessage = snapshot?.bridge.message ||
    (loading ? "Checking your local Control Deck services…" : "The local service is waiting for Bitwig.");

  return (
    <main className="deck-shell">
      <BrandHeader active="deck" />

      <section className="hero-grid" aria-labelledby="connection-title">
        <article className={`connection-panel ${online ? "is-online" : "is-waiting"}`}>
          <div className="signal-orbit" aria-hidden="true"><span /></div>
          <div className="connection-copy">
            <p className="eyebrow">BRIDGE STATUS</p>
            <h1 id="connection-title">{online ? "Bitwig is linked." : "Ready for a clean relaunch."}</h1>
            <p>{connectionMessage}</p>
            {preferences.showConnectionDetail && snapshot?.bridge.detail && (
              <p className="connection-detail">{snapshot.bridge.detail}</p>
            )}
          </div>
          <div className="connection-state">
            <span className="state-light" />
            {online ? "ONLINE" : "STAGED"}
          </div>
        </article>

        <aside className="system-panel" aria-label="System status">
          <div className="panel-heading"><span>SYSTEM CHECK</span><span>LIVE</span></div>
          <StatusRow label="Local service" value={serviceError ? "Unavailable" : "Running"} good={!serviceError} />
          <StatusRow label="Bitwig bridge" value={online ? "Connected" : "Waiting"} good={Boolean(online)} />
          <StatusRow label="Plug-in inventory" value={`${compactNumber(snapshot?.library.uniquePlugins)} ready`} good={Boolean(snapshot?.library.uniquePlugins)} />
          {!preferences.autoRefresh && (
            <button className="manual-refresh" onClick={loadSnapshot}>REFRESH STATUS</button>
          )}
        </aside>
      </section>

      <section className="session-strip" aria-label="Current Bitwig session">
        <Metric label="Project" value={status?.project || "—"} detail={status?.projectModified ? "Unsaved changes" : online ? "Saved state" : "Waiting for Bitwig"} />
        <Metric label="Tempo" value={status ? status.transport.tempoDisplay : "—"} detail="Current transport" />
        <Metric label="Transport" value={status ? (status.transport.recording ? "Recording" : status.transport.playing ? "Playing" : "Stopped") : "—"} detail={status ? `${snapshot?.bridge.tracks?.total || 0} tracks visible` : "No project data yet"} />
        <Metric label="Selected track" value={status?.selectedTrack?.name || "—"} detail={status?.selectedDevice?.name || "No selected device"} />
      </section>

      <section className="workspace-grid">
        <article className="library-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">INSTALLED LIBRARY</p>
              <h2>Plug-in index</h2>
            </div>
            <div className="library-total"><strong>{compactNumber(snapshot?.library.uniquePlugins)}</strong><span>unique plug-ins</span></div>
          </div>

          <div className="library-tools">
            <label className="search-field">
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by plug-in or maker" aria-label="Search plug-ins" />
            </label>
            <button className="reindex-button" onClick={rebuildIndex} disabled={reindexing}>{reindexing ? "INDEXING…" : "REFRESH INDEX"}</button>
          </div>

          <div className="format-row" aria-label="Filter by plug-in format">
            {FORMATS.map(item => (
              <button key={item} className={format === item ? "active" : ""} onClick={() => setFormat(item)}>
                {item}<span>{item === "ALL" ? snapshot?.library.pluginBundles || 0 : snapshot?.library.formatCounts[item] || 0}</span>
              </button>
            ))}
          </div>

          <div className="result-summary">
            <span>{compactNumber(plugins.total)} matches · showing {compactNumber(shownPluginCount)}</span>
            <span>Index refreshed {timeLabel(snapshot?.library.generatedAt)}</span>
          </div>

          <div className="plugin-list" role="list" aria-label="Indexed plug-ins">
            {plugins.plugins.map((plugin, index) => (
              <div className="plugin-row" role="listitem" key={plugin.id}>
                <span className="plugin-index">{String(index + 1).padStart(2, "0")}</span>
                <div className="plugin-identity">
                  <strong>{plugin.name}</strong>
                  <span>{plugin.manufacturers.join(" · ") || "Independent"}</span>
                </div>
                <div className="format-badges">{plugin.formats.map(item => <span key={item}>{item}</span>)}</div>
                <span className="plugin-version">{plugin.versions[0] ? `v${plugin.versions[0]}` : "version —"}</span>
              </div>
            ))}
            {!shownPluginCount && <div className="empty-state">No plug-ins match this filter.</div>}
          </div>
        </article>

        <aside className="devices-panel">
          <div className="section-head compact">
            <div><p className="eyebrow">CURRENT CHAIN</p><h2>Loaded devices</h2></div>
            <span className="device-count">{devices.length}</span>
          </div>
          <p className="devices-context">{status?.selectedTrack?.name ? `Selected track · ${status.selectedTrack.name}` : "Select a track in Bitwig to inspect its chain."}</p>
          <div className="device-list">
            {devices.map(device => (
              <div className="device-card" key={`${device.index}-${device.name}`}>
                <div className="device-order">{String(device.index + 1).padStart(2, "0")}</div>
                <div><strong>{device.name}</strong><span>{device.plugin ? "Third-party plug-in" : device.type || "Bitwig device"}</span></div>
                <span className={`device-led ${device.enabled ? "on" : ""}`} aria-label={device.enabled ? "Enabled" : "Disabled"} />
              </div>
            ))}
            {!devices.length && <div className="device-empty"><span>◇</span><p>{online ? "No devices on the selected track." : "Device details will appear after Bitwig reconnects."}</p></div>}
          </div>
          <div className="read-only-note"><span>CONTROL SURFACE</span><p>Control Deck keeps status and inventory visible here. Exact Bitwig actions continue through the verified local bridge.</p></div>
        </aside>
      </section>

      <footer>
        <span>BITWIG CONTROL DECK · 1.0</span>
        <span>127.0.0.1 · PRIVATE LOOPBACK</span>
      </footer>
    </main>
  );
}

function StatusRow({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <div className="status-row"><span className={`mini-led ${good ? "good" : ""}`} /><span>{label}</span><strong>{value}</strong></div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="metric"><span>{label}</span><strong title={value}>{value}</strong><small>{detail}</small></div>;
}

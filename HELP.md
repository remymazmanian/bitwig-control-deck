# Bitwig Control Deck — Help & Reference

Everything about installing, using, troubleshooting, and understanding Bitwig Control Deck. For a quick start, see the [README](README.md); this file is the complete reference.

---

## Contents

1. [What Control Deck is](#what-control-deck-is)
2. [Compatibility](#compatibility)
3. [The pieces, in plain language](#the-pieces-in-plain-language)
4. [Installing](#installing)
5. [Setting up Bitwig](#setting-up-bitwig)
6. [Everyday use](#everyday-use)
7. [The dashboard](#the-dashboard)
8. [Connecting AI agents](#connecting-ai-agents)
9. [MCP tool reference](#mcp-tool-reference)
10. [Files and locations](#files-and-locations)
11. [Troubleshooting](#troubleshooting)
12. [Uninstalling](#uninstalling)
13. [Security model](#security-model)
14. [FAQ](#faq)

---

## What Control Deck is

Bitwig Control Deck lets an AI agent operate Bitwig Studio the way a careful engineer would: every action names its exact target, ambiguous requests are refused, and every change is read back from Bitwig before being reported as done. It speaks the [Model Context Protocol](https://modelcontextprotocol.io) (MCP), the open standard used by Claude Code, Claude Desktop, Codex, Cursor, Gemini CLI, and most other AI agents — including fully local LLM setups.

It is not a remote-control surface, a preset manager, or a cloud service. It is a precision bridge between an agent's intent and Bitwig's controller API, plus a local dashboard for watching what's happening.

## Compatibility

**Supported today: macOS only.**

| Requirement | Minimum |
|---|---|
| macOS | 13 Ventura or newer (Apple silicon and Intel) |
| Bitwig Studio | 6.x (Controller API 18) |
| Node.js | 20 or newer |
| Xcode Command Line Tools | optional — only for the MIDI auto-detect helper and the wrapper app |

The macOS-specific parts are the service autostart (launchd), the MIDI auto-detect helper (CoreMIDI), the wrapper app (WebKit), and the plug-in scanner's folder paths. The core — the controller script, the MCP server, the UDP protocol, and the dashboard — is platform-neutral, because Bitwig's controller API and Node.js both run everywhere. **Linux and Windows are not supported yet**, but the port is well understood and modestly sized; see [PORTING.md](PORTING.md) if you'd like to help.

## The pieces, in plain language

Control Deck is one folder containing five cooperating parts:

1. **The controller script** (`controller/ControlDeck.control.js`) — a Bitwig controller extension that runs *inside* Bitwig. It listens on local UDP port `50701` for authenticated requests and is the only thing that actually touches your project. Installed into Bitwig by setup with your private secret stamped in.
2. **The MCP server** (`src/index.mjs`) — the part your AI agent talks to. Each agent launches its own copy on demand (stdio; it is not a background service) and it relays requests to the controller script.
3. **The status API** (`src/dashboard-server.mjs`) — a small read-only web service on `127.0.0.1:50702` that reports bridge health, session state, and the plug-in inventory. Runs at login.
4. **The dashboard** (`dashboard/`) — the Control Deck web UI on `127.0.0.1:50703`. Runs at login.
5. **The MIDI helper** (`bin/control-deck-midi-ports`) — optional. Publishes a virtual MIDI identity so Bitwig auto-detects the controller. Without it, you add the controller manually once and nothing else changes.

The optional **wrapper app** (`Bitwig Control Deck.app`) is a native window showing the dashboard — pure convenience; a browser tab is equivalent.

## Installing

Two equivalent paths; both are safe to re-run at any time.

**No coding required:** follow the five-step Quickstart in the [README](README.md#quickstart-no-coding-required) — install Node.js, download and move the folder somewhere permanent, right-click **Install Control Deck.command** → Open, enable the controller in Bitwig, connect your agent.

**Developers:** `npm run setup` runs the same engine: dependency installs, native and dashboard builds, secret generation, controller install, and launchd agents (written and activated). Flags: `--skip-build`, `--skip-controller`, `--skip-agents`. Granular scripts remain (`build:midi-ports`, `build:macos`, `index:plugins`, dashboard `dev`/`build`/`check`).

Setup guards the common traps: it refuses to run from Downloads/Desktop (services would break when you move the folder), detects a moved checkout and refreshes everything, and ends failed runs with what to fix.

## Setting up Bitwig

Setup installs the controller script into Bitwig's default controller-script folder (`~/Documents/Bitwig Studio/Controller Scripts/Control Deck/`), so Bitwig can already see it. One of two things happens next:

**Auto-detection (when the MIDI helper is running).** The helper publishes virtual MIDI ports named "Control Deck Bridge In/Out". The next time Bitwig starts (or rescans controllers), it recognizes that identity and adds **Control Deck Bridge** on its own — you'll see the "Control Deck Bridge online" popup inside Bitwig. Nothing to do.

**Manual add (no helper, or auto-detect didn't fire).**

1. In Bitwig, open the Dashboard (the Bitwig logo, top center) → **Settings** → **Controllers**.
2. Click **+ Add Controller**.
3. Choose vendor **Control Deck**, then **Control Deck Bridge**, and click **Add**.
4. If the "Control Deck Bridge In/Out" MIDI ports exist, assign them. If they don't, leave the ports unassigned — the bridge communicates over local UDP; the MIDI identity exists only for auto-detection and is not used for control data.
5. The entry's power button should be on. You'll see the **"Control Deck Bridge online"** popup, and the script console (the `>` icon on the controller entry) logs `Control Deck Bridge 1.0.0 listening on UDP 50701`.

**Verifying and reloading.** The dashboard's Deck page flips to "Bitwig is linked." the moment the bridge is up — that's the quickest end-to-end check. After re-running setup (which re-stamps the secret into the controller script), make Bitwig reload it: restart Bitwig, or toggle the controller's power button off and on in Settings → Controllers.

**If the controller isn't listed at all**, Bitwig is probably looking in a non-default location: Settings → **Locations** → "My Controller Scripts" should point at `~/Documents/Bitwig Studio/Controller Scripts` (the default). If you've customized it, either restore the default or copy the `Control Deck` folder into your custom location — but always the setup-installed copy, never the repo file, which has no secret stamped in.

## Everyday use

Nothing to start manually. The services launch at login; the controller loads with Bitwig; agents launch the MCP server themselves.

1. Open **Bitwig**. The bridge announces itself ("Control Deck Bridge online").
2. Ask your agent — "list my tracks", "insert a Polymer on track 2 and set its cutoff to 0.6", "build an arrangement from my launcher clips".
3. Optionally watch the **dashboard** (app or `http://127.0.0.1:50703`) to see status and devices live.

Order never matters — every piece waits gracefully for the others.

## The dashboard

- **Deck** — bridge status, current project and transport, the selected track's device chain, and a searchable inventory of every VST3, VST2, AU, and CLAP plug-in on your machine (reindex from here after installing plug-ins).
- **Connect** — copy-paste setup for every AI agent, rendered with your machine's real install path. See [Connecting AI agents](#connecting-ai-agents).
- **Settings** — bridge address, refresh cadence, plug-in library defaults, density, signal color, motion. Stored in your browser; the deck itself never writes to Bitwig.

## Connecting AI agents

The **Connect page** (`http://127.0.0.1:50703/connect`) is the canonical guide, with exact snippets for Claude Code, Claude Desktop, Codex, Cursor, VS Code, Windsurf, Gemini CLI, Grok CLI, local LLM harnesses (LM Studio, Ollama via mcphost), and any other MCP client. The universal facts:

- **Command:** `node <install-path>/src/index.mjs`
- **Transport:** stdio — no URL, no port, no network setup
- Bitwig must be open for tools to work; the agent config is one-time.

Remote cloud connectors (claude.ai, ChatGPT) are deliberately unsupported — see the [FAQ](#faq).

## MCP tool reference

All 34 tools follow the same contract: **exact targets** (mutations require both index and current name; stale names are refused), **no preset loading** (only Bitwig's Devices browser is used), and **readback verification** (writes report the value Bitwig actually shows afterward).

### Status & session

- **bitwig_status** — Check Control Deck Bridge, Bitwig, the current project, transport, and current selection.
- **bitwig_actions** — Search Bitwig Studio's native action registry by action id, name, or menu text.
- **bitwig_invoke_action** — Invoke one exact Bitwig action id previously returned by `bitwig_actions`.
- **bitwig_transport** — Read or control Bitwig transport. Tempo changes are read back before success is reported.
- **bitwig_track_meters** — Read peak signal activity captured for every track, or reset the captured maxima before a playback test.

### Tracks

- **bitwig_tracks** — List tracks with exact names, positions, safety references, types, and states.
- **bitwig_create_track** — Create an empty track without opening the Browser or loading any preset.
- **bitwig_set_track_mix** — Set exact mixer values on one verified track and read the resulting state back.
- **bitwig_rename_track** — Rename one verified track without changing its routing.
- **bitwig_delete_track** — Delete one exact track; the supplied name must still match, preventing index-drift mistakes.

### Clips & arrangement

- **bitwig_clips** — List populated launcher clips for one exact track.
- **bitwig_create_note_clip** — Create or replace a launcher MIDI clip on one exact instrument track and write its complete note content.
- **bitwig_arrange_launcher_clips** — Record existing launcher clips into the Arranger across exact beat regions, merging contiguous regions and restoring the project tempo afterward.
- **bitwig_launch_scene** — Launch one scene immediately and from the start across all tracks.
- **bitwig_cue_markers** — List Arranger cue markers, or create/update a named marker set at exact beat positions with readback verification.

### Devices

- **bitwig_devices** — List devices on one exact track (reads the chain directly; never inspects presets).
- **bitwig_find_devices** — Search Bitwig's Devices browser only. Returns actual device names; presets are excluded by design.
- **bitwig_insert_device** — Insert one exact device at the end of an exact track; refused if the name is ambiguous.
- **bitwig_insert_stock_device** — Insert a stock Bitwig device by its stable UUID, optionally before a verified device — including note-processing positions the end-of-chain Browser omits.
- **bitwig_insert_clap_device** — Insert a CLAP plug-in directly by its stable ID, bypassing Browser filters and redundant-format hiding.
- **bitwig_nest_device** — Move one verified top-level device into another device's native nested chain and verify both chains.
- **bitwig_save_device_preset** — Open Bitwig's native Save-to-Library flow for one verified device, without mouse automation.
- **bitwig_delete_device** — Delete one exact device; both track and device names must still match.
- **bitwig_open_device_window** — Open the native window for one exact device or plug-in.

### Samples

- **bitwig_find_samples** — Search Bitwig's indexed Samples browser for one exact instrument track.
- **bitwig_insert_sample** — Load one exact indexed sample into a new Sampler at the end of an instrument track.
- **bitwig_insert_sample_file** — Load an absolute WAV/AIFF/FLAC path into a new Sampler and verify the loaded sample name.

### Parameters

- **bitwig_device_parameters** — Read a device's full direct parameter list — third-party plug-ins included — with stable IDs and current values.
- **bitwig_set_device_parameter** — Set one parameter by stable ID and verify the normalized value through readback.
- **bitwig_remote_controls** — Show the compact eight-knob Remote Controls section for one exact device; optionally select a named page.
- **bitwig_selected_device_remote_controls** — Show or hide Remote Controls for the currently selected device, including nested devices.
- **bitwig_set_remote_control** — Set one visible Remote Control by page and control name via the same native path as the on-screen knobs, then verify.

### Plug-in library

- **bitwig_plugins** — Search Control Deck's local inventory of installed VST3, VST2, AU, and CLAP plug-ins without opening Bitwig's Browser.
- **bitwig_refresh_plugin_index** — Rebuild that inventory after installing or removing plug-ins.

## Files and locations

| What | Where |
|---|---|
| The install (never move without re-running setup) | wherever you placed the folder |
| Per-install secret | `<install>/data/bridge-token` |
| Plug-in inventory | `<install>/data/plugin-index.json` |
| MCP request log | `<install>/logs/control-deck.jsonl` |
| Controller script (installed copy) | `~/Documents/Bitwig Studio/Controller Scripts/Control Deck/` |
| Launch agents | `~/Library/LaunchAgents/com.controldeck.{midi-ports,api,dashboard}.plist` |
| Service logs | `/tmp/com.controldeck.*.log` and `.error.log` |
| Wrapper app (optional) | built to `<install>/build/`, typically copied to `/Applications` |

Ports (all loopback-only): `50701/udp` bridge, `50702/tcp` status API, `50703/tcp` dashboard.

## Troubleshooting

**The deck says "waiting for Bitwig."** Bitwig isn't open, or the controller isn't active. In Bitwig: Settings → Controllers → confirm "Control Deck Bridge" exists and is enabled. If it's missing, add it manually (vendor "Control Deck") or run setup again and restart Bitwig.

**"Control Deck authentication failed."** The controller script and your services disagree about the secret — usually a controller installed before the current `data/bridge-token`. Run setup again (it re-stamps the controller), then restart Bitwig.

**The controller refuses to start and mentions a missing token.** The repo copy of the controller was installed by hand instead of through setup, so the secret placeholder was never stamped. Run setup; never copy `controller/ControlDeck.control.js` into Bitwig manually.

**Dashboard won't load.** Check the services: `launchctl print gui/$(id -u)/com.controldeck.dashboard` (and `.api`). Logs live in `/tmp/com.controldeck.*.error.log`. `launchctl kickstart -k gui/$(id -u)/<label>` restarts one. Re-running setup fixes most states.

**Everything broke after moving or renaming the folder.** Expected — services pin absolute paths. Run setup from the new location (it detects the move and refreshes), and re-register the MCP server in your agent since its path changed too.

**Everything broke after upgrading Node.** The launch agents pin the Node binary that ran setup. Re-run setup with the new Node and they're re-pinned.

**"MIDI helper skipped" during setup.** Apple's command line tools are missing. Run `xcode-select --install`, accept the popup, run setup again. Or skip it forever and add the controller in Bitwig manually — the helper is only for auto-detection.

**macOS refuses to open the installer.** Downloaded, non-notarized scripts need a one-time right-click → **Open**. Everything after that first launch is normal.

**Plug-in list is empty or stale.** Use the reindex button on the deck, or `npm run index:plugins`.

**An agent connects but tools time out.** Bitwig must be open with the controller enabled; requests need a live bridge. `bitwig_status` is the cheapest way to check what the agent sees.

## Uninstalling

```sh
launchctl bootout gui/$(id -u)/com.controldeck.midi-ports
launchctl bootout gui/$(id -u)/com.controldeck.api
launchctl bootout gui/$(id -u)/com.controldeck.dashboard
rm ~/Library/LaunchAgents/com.controldeck.*.plist
rm -rf ~/Documents/"Bitwig Studio"/"Controller Scripts"/"Control Deck"
```

Then delete the install folder, remove the wrapper app from `/Applications` if you copied it there, and remove the server from your agent (for Claude Code: `claude mcp remove bitwig`). Control Deck writes nowhere else.

## Security model

- Everything binds to `127.0.0.1`. Nothing listens on, or connects to, any network.
- Every bridge request carries a per-install secret generated on your machine and never committed anywhere. The controller refuses to run without one.
- Mutations require exact index-plus-name targets and are refused on mismatch or ambiguity, so a confused agent fails loudly instead of editing the wrong thing.
- The wrapper app blocks all navigation away from the local dashboard.
- The MCP server logs requests locally to `logs/control-deck.jsonl` so you can audit what an agent did.

## FAQ

**Does it work with Claude Code / Codex / Cursor / my local LLM?**
Yes — any MCP client. The Connect page has per-client snippets. For local LLMs, the harness (LM Studio, mcphost, etc.) speaks MCP; any local model with solid tool-calling can drive Bitwig fully offline.

**Can claude.ai or ChatGPT control it from the cloud via a connector?**
Not out of the box, deliberately: connectors expect a public HTTPS endpoint, and Control Deck is loopback-only. It can be bridged with a stdio→HTTP gateway plus a tunnel, but that makes your DAW internet-reachable and the bridge secret does not protect the HTTP side — you'd need real endpoint auth, an always-awake Mac, and tolerance for cloud round-trip latency. If you need other-device access, a private overlay network (e.g. plain Tailscale) is the sane middle ground. Local agents over stdio are the supported path.

**Does it load presets or use Bitwig's browser search?**
No, by design. Only the Devices browsing session is used, so what gets inserted is always the exact named device — never a preset guess.

**Does it phone home, collect telemetry, or need an account?**
No, no, and no.

**Linux? Windows?**
Not yet — see [Compatibility](#compatibility) and [PORTING.md](PORTING.md). The core is portable; contributions welcome.

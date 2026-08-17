# Porting Bitwig Control Deck to Linux and Windows

Control Deck currently supports **macOS only**, but that's an implementation detail, not an architectural one. The two foundations — Bitwig's controller API and Node.js — are fully cross-platform, so the controller script, the MCP server, the UDP protocol, and the dashboard all run unchanged on Linux and Windows today. What's missing is the platform plumbing around them. Contributions are very welcome; this file is the map.

## What already works everywhere

| Component | Why it's portable |
|---|---|
| `controller/ControlDeck.control.js` | Runs inside Bitwig's own JS engine; the UDP listener is Bitwig API, not OS API |
| `src/index.mjs` (MCP server) | Pure Node, stdio transport, zero native dependencies |
| `src/bitwig-client.mjs` + `src/dashboard-server.mjs` | Pure Node, loopback sockets |
| `dashboard/` | Plain Next.js |

## What needs porting

| Piece | macOS implementation | Linux | Windows |
|---|---|---|---|
| Plug-in scanner paths (`src/plugin-index.mjs`) | `/Library/Audio/Plug-Ins/…` and the user equivalent; AU is macOS-only | `~/.vst3`, `/usr/lib/vst3`, `~/.clap`, `/usr/lib/clap`, VST2 dirs | `%COMMONPROGRAMFILES%\VST3`, `%COMMONPROGRAMFILES%\CLAP`, common VST2 dirs |
| Controller-script install path (`scripts/setup.mjs`) | `~/Documents/Bitwig Studio/Controller Scripts` | `~/Bitwig Studio/Controller Scripts` | `%USERPROFILE%\Documents\Bitwig Studio\Controller Scripts` |
| Service autostart (`scripts/setup.mjs`) | launchd user agents + `launchctl` | systemd user units in `~/.config/systemd/user/` | Task Scheduler entries or Startup shortcuts |
| MIDI auto-detect helper (`native/control_deck_midi_ports.c`) | CoreMIDI virtual endpoints | small ALSA sequencer client (~50 lines) | no built-in virtual MIDI; document loopMIDI, or skip |
| Wrapper app (`macos/`) | Cocoa + WKWebView | skip — browser is equivalent | skip — browser is equivalent |
| Installer entry point | `Install Control Deck.command` | shell script | `.cmd`/PowerShell script |
| Small portability nits | — | — | `process.getuid()` guard in setup; path separators are already handled by `node:path` |

Two facts shrink the job: the **MIDI helper is optional on every platform** (its only purpose is auto-detection; adding the controller manually in Bitwig is a one-time equivalent), and the **wrapper app is cosmetic** (the dashboard in a browser is the same product). A minimum viable port is: plugin paths, controller path, autostart, installer script, docs.

## Ground rules for a port

- Keep the security posture: loopback-only binds, per-install secret, no new listening surfaces.
- Keep `npm run setup` as the single entry point, branching on `process.platform` — don't fork per-OS setup scripts.
- Keep every user-facing setup message understandable without a coding background; the double-click installer runs the same engine.
- Verify with the existing checks: `npm run check`, `npm test`, and `dashboard npm run check` must pass on the target platform.

If you start a port, open an issue so effort doesn't get duplicated.

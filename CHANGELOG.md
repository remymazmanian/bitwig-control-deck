# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-10-10

Fixes a case where the bridge could stop responding until Bitwig was restarted, and reports tempo, mixer and parameter changes as errors when Bitwig does not confirm them. Tested with Bitwig Studio 6.1.3.

### Fixed

- The bridge no longer stops responding after an internal error. One failed step could leave it busy until the controller script was restarted, so every later request timed out or was refused as busy.
- Requests that run too long inside Bitwig now end with an error at their time limit, and requests the client has already stopped waiting for are skipped.
- Recording launcher clips into the Arranger restores the project's own tempo afterwards. It previously set 122 BPM unless `restoreTempo` was given.
- Tempo changes are read back from Bitwig and reported as an error, with the actual tempo, when Bitwig did not apply them.
- Volume, pan, mute, solo and arm changes are read back the same way.
- Parameter and Remote Control changes that Bitwig does not confirm are reported as errors showing the requested and actual values. They previously returned success with `verifiedByBitwigReadback: false`.
- Large note clips no longer fail with a misleading "make sure Control Deck Bridge is enabled" timeout. Requests larger than macOS's default 9 KB message size now go through, and a request too large for one message is refused straight away with a clear explanation.

### Changed

- Note clips are limited to 750 notes per request. The previous limit of 4,096 could never fit in a single message to Bitwig.
- `restoreTempo` on `bitwig_arrange_launcher_clips` is now optional.

### Security

- The status service only answers requests addressed to `localhost` or `127.0.0.1`, which stops web pages from reaching it through DNS rebinding, and it no longer sends a fixed fallback CORS origin.
- Updated the MCP SDK to 1.32.1, which fixes advisory GHSA-6qxp-vccf-f47h, and Next.js to 16.4.0. This clears the npm audit advisories in the code that ships.

## [1.0.0] - 2026-08-17

First release of Bitwig Control Deck, a local MCP bridge that lets an AI agent control Bitwig Studio 6 on your Mac and checks its changes against what Bitwig reports. It needs macOS 13 or newer and Node.js 20 or newer.

### Added

- One-step installer, `Install Control Deck.command`, that sets up the bridge, the Bitwig controller extension and the background services, then opens a connection guide. It is safe to run again at any time.
- Transport control for play, stop, tempo and playback position, plus Arranger cue markers placed at exact beat positions.
- Track tools to list, create, rename and delete tracks, set volume, pan, mute, solo and arm, and read peak meters. Renaming and deleting need the track's exact current name, so a shifted track list cannot redirect a change.
- Clip tools to write launcher MIDI clips with their full note content, launch scenes, and record existing launcher clips into the Arranger at exact beat positions.
- Device tools that search Bitwig's Devices browser and insert one exact device, refusing ambiguous names. Stock devices and CLAP plug-ins can also be inserted by stable ID, and devices can be nested, deleted, opened in their own window or saved through Bitwig's Save to Library flow.
- Parameter control for native and third-party devices: read the full parameter list with stable IDs, set a value by ID or through a Remote Controls page, and get back the value Bitwig reports after the change.
- Sample loading from Bitwig's Samples browser, or from a WAV, AIFF or FLAC file, into a new Sampler device on an exact track.
- Action tools to search Bitwig's built-in action list and run one action by its exact ID.
- Local dashboard at `http://127.0.0.1:50703` showing bridge health, the current session, loaded devices and a searchable inventory of installed VST3, VST2, Audio Unit and CLAP plug-ins. Its Connect page has copy-paste setup guides for Claude Code, Codex, Cursor, VS Code, Gemini CLI, local LLM setups and other MCP clients.
- Local operation: the status service and dashboard listen on this Mac only, and every request to the Bitwig bridge must carry a secret generated for your install.

[Unreleased]: https://github.com/remymazmanian/bitwig-control-deck/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/remymazmanian/bitwig-control-deck/releases/tag/v1.0.1
[1.0.0]: https://github.com/remymazmanian/bitwig-control-deck/releases/tag/v1.0.0

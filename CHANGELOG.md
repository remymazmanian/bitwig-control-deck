# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Tools identified a track by its index and checked its name, but two tracks with the same name could pass that check after the tracks moved. Track tools now refuse a track whose name another track shares and ask for a rename. `bitwig_rename_track` still works on duplicates, refuses a name that another track already has, and `bitwig_tracks` reports clashing names under `duplicateNames`. Permanent track IDs need controller API 20 and are planned for a later version.
- `bitwig_create_track` created the track first and only then checked the 128-track limit, so a 129th track was created and reported as a failure. It now refuses before creating anything.
- `bitwig_create_track` assumed the new track was the last one in the main track list. Effect tracks never appear there, so creating one always reported an error after the track was made, and a track Bitwig placed elsewhere could leave the wrong track renamed. The bridge now compares the track list (or the effect track list) before and after, names the track that was added, and checks the name took. If the new track cannot be told apart from a neighbour with the same name, it is left unnamed and the tool says so.
- `bitwig_delete_track` and `bitwig_delete_device` reported success without checking anything. They now succeed only once Bitwig's list shows the item gone and the rest in their original order. A deleted group reports how many tracks went with it.
- `bitwig_cue_markers` upsert moved the playhead to a spot past the last marker for every new marker and then jumped back, which was audible during playback. New markers are now added at the current playhead and moved into place, so the playhead stays where it is. The only exception is a stopped transport with a marker already under the playhead: the bridge then moves the playhead aside for the add and puts it back before replying.
- Launcher tools are no longer limited to the first eight scenes. `bitwig_create_note_clip`, `bitwig_clip_notes` and `bitwig_launch_scene` accept slots up to 1023 and scroll Bitwig's scene window to reach them, and `bitwig_clips` lists clips in every scene.
- `bitwig_create_note_clip` can add a clip one slot past the last scene; Bitwig creates the scene for it.
- `bitwig_arrange_launcher_clips` disarms armed tracks and turns off Arranger and Launcher overdub while it records, so live input and overdub no longer land in the print. Both are put back afterwards.
- `bitwig_arrange_launcher_clips` starts recording at the earliest requested region instead of beat 0, and refuses a print longer than 1024 beats, which could not finish inside its time limit.
- `bitwig_arrange_launcher_clips` stops with an error as soon as the transport stops mid-print, instead of waiting out its 115-second limit.
- When `bitwig_arrange_launcher_clips` fails or times out, Bitwig gets back its tempo, loop, overdub, track arms and playhead position, and the tracks return to the Arranger. This now happens as soon as the request ends, without waiting for the recording loop to notice.

### Removed

- Unused copy-and-paste arrangement code in the controller script, and the Bitwig actions only it used.
- A reply too large for one message could silently never arrive, and the client only saw a timeout. The bridge now checks every reply against a 60,000-byte limit (the same limit the client uses for requests) and sends a clear error instead. If Bitwig cannot send a reply at all, the bridge logs it as an error and tries to tell the client with a short error reply.
- After a request timed out or failed, its remaining delayed steps kept running. They could keep changing Bitwig, and an error in one of them could fail the next, unrelated request. Those steps are now dropped once their request has been answered.

## [1.1.0] - 2026-10-28

Adds note read-back for launcher clips and checks every note clip write against what Bitwig reports. Tested in Bitwig Studio 6.1.3 with 16- and 128-beat clips, grids down to 1/128 notes, and notes on several MIDI channels.

### Added

- `bitwig_clip_notes` reads every note in a launcher clip, with start, pitch, velocity, length, MIDI channel and mute state, across all 16 channels and the full clip length.

### Changed

- `bitwig_create_note_clip` re-reads the clip after writing and reports an error if any note is missing, changed or extra. The result now includes `notesVerified`.
- Note clip writes can take up to 120 seconds, up from 30, to leave room for the read-back on long clips.
- `bitwig_arrange_launcher_clips` keeps notes on every MIDI channel when it copies clip notes, not only channel 1.

## [1.0.2] - 2026-10-11

### Fixed

- Device tools refused every track inside a group with "Bitwig did not select the requested track", even though Bitwig had selected it. The check compared track positions, which Bitwig counts within the group for the selected track but across the whole project in the track list. The bridge now asks Bitwig whether the selected track is the requested one. Tested with the Ferrous Rhythm demo project in Bitwig Studio 6.3.

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

https://github.com/remymazmanian/bitwig-control-deck/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/remymazmanian/bitwig-control-deck/releases/tag/v1.1.0
[1.0.2]: https://github.com/remymazmanian/bitwig-control-deck/releases/tag/v1.0.2
[1.0.1]: https://github.com/remymazmanian/bitwig-control-deck/releases/tag/v1.0.1
[1.0.0]: https://github.com/remymazmanian/bitwig-control-deck/releases/tag/v1.0.0

# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `bitwig_place_audio_file` reads a WAV, AIFF, or FLAC header and reports how long Raw playback would be at the project tempo. It does not place the file or create a track. Controller API 18 cannot put an audio file on an Arranger beat and then set Raw / no stretch, and `insertFile` follows the same path as a drag and drop, which can tempo-detect and stretch the audio.
- `bitwig_arranger_clips` lists the Arranger clips the clip cursor can see: track, start beat, end beat, and audio or note from the track type. If the host cursor cannot move, only the selected clip is returned. Names and stretch mode are not readable on API 18, including in the published API surface through version 25.
- `bitwig_rename_clip` renames a launcher clip and reads the slot name back. An Arranger clip is renamed with `Clip.setName` when the cursor can land on that track and start beat. API 18 has no clip name getter, so an Arranger rename is reported as sent, not verified.
- `bitwig_write_automation` plays a linear or curved ramp between two beats onto track volume, track pan, a Remote Control, or a direct device parameter, in latch automation-write mode, then checks the value at the playhead. API 18 cannot insert automation breakpoints. A direct parameter that does not follow the playhead fails the call; a Remote Control is the path that Bitwig can touch.
- `bitwig_find_presets` and `bitwig_load_preset` browse the preset tab for one device, or load an absolute `.bwpreset` or `.vstpreset` file. The device name has to stay the same and the preset name has to change. A plug-in's own preset browser, including instruments that sit on their init patch, is not reachable. A load that replaces the device is undone.
- `bitwig_cue_markers` can rename or delete one marker by index and current name, and reads the marker list back.

### Fixed

- `bitwig_arrange_launcher_clips` restores record-arm on the tracks that were armed, matched by name. Saving the bank slot could arm a different track after the bank scrolled during the print.
- A request that runs past its time limit now ends with `Timed out:` from the bridge. The bridge drops the rest of that request, stops the transport and restores record-arm when the request had changed them, and closes a browser the request opened. The client waits slightly past that deadline so this error is what the caller sees.

## [1.2.1] - 2026-10-28

Fixes security advisories in the dashboard and MCP server dependencies, lists the agents Control Deck works with in the docs and on the Connect page, and clears the dashboard lint errors.

### Security

- Updated Next.js to 16.4.1, which fixes GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr and GHSA-p3m5-59mp-jv5r (CVE-2026-94482) in the dashboard.
- Updated the MCP server's dependencies body-parser (2.4.0), fast-uri (3.1.9), ip-address (10.7.5) and qs (6.17.1), which fixes GHSA-27r3-jxmh-p828, GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp, GHSA-rxp7-6hxx-x8q5 and GHSA-6pq8-jhm2-2vcw.
- Updated zod to 4.6.7 in the MCP server, which fixes GHSA-mrhx-c7xc-m3w5. Tool inputs validate the same way as before.
- Updated zod to 4.6.7 in the dashboard's lint tooling, which fixes GHSA-mrhx-c7xc-m3w5 there too.

### Changed

- README and HELP list the agents Control Deck works with: Claude Desktop, Claude Code, Cursor, OpenAI Codex, Grok CLI, Windsurf, Cline, and GitHub Copilot in VS Code, plus any MCP-compatible agent that can run a local server, with setup snippets for each.
- The dashboard's Connect page lists the same agents, with a snippet for each that uses your real install path.
- Docs and the setup script use SI wording.

### Fixed

- Fixed the dashboard lint errors. Saved preferences are now read as an external store, and the Settings draft and default format follow saved changes without effects. The dashboard behaves the same as before.

## [1.2.0] - 2026-10-28

Makes the bridge safer and more exact: it ignores requests with the wrong auth token, track and device tools check Bitwig's lists before reporting success, launcher tools reach every scene, and your selection and transport settings come back after a tool runs. Tested live in Bitwig Studio 6.1.3.

### Security

- The bridge no longer replies to requests with the wrong auth token, including from its error path. It shows a popup the first time and logs the 1st and every 100th ignored request.

### Changed

- `bitwig_actions` now matches case-insensitively after trimming the query, and reports `totalActions` and `matched` alongside up to 100 actions.
- `bitwig_status` reports `audioEngineActive`.

### Fixed

- A reply too large for one message could silently never arrive, and the client only saw a timeout. The bridge now checks every reply against a 60,000-byte limit (the same limit the client uses for requests) and sends a clear error instead. If Bitwig cannot send a reply at all, the bridge logs it as an error and tries to tell the client with a short error reply.
- After a request timed out or failed, its remaining delayed steps kept running. They could keep changing Bitwig, and an error in one of them could fail the next, unrelated request. Those steps are now dropped once their request has been answered.
- Device, sample and clip tools selected their track (and device) in Bitwig and left it that way, so your selection moved every time an agent worked. The selection you had now comes back when the tool finishes, whether it succeeded or failed.
- `bitwig_save_device_preset` pressed Enter by default about a second after opening Save to Library, whether or not the dialog had appeared, so the key could land somewhere else in Bitwig. The dialog now stays open by default. With `confirm: true`, Enter is pressed only if the same device is still selected, and the reply shows the device's preset name before and after.
- `bitwig_track_meters` kept peak maxima by track position, so after tracks were added, deleted or moved, a track could report another track's peak. A maximum now belongs to the track it was measured on and starts again when a different track takes that position.
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
- When `bitwig_arrange_launcher_clips` fails or times out, Bitwig gets back its tempo, loop, overdub, track arms and playhead position, and the tracks return to the Arranger. This now happens as soon as the request ends, without waiting for the recording loop to notice. The playhead is moved back a second time once the stop lands, because Bitwig can drop a move made while the transport is still stopping.

### Removed

- The bridge methods `audio_engine`, `restart_bridge`, `selection_state` and `list_actions`. No MCP tool, dashboard view or script used them. `list_actions` was a second copy of the action search and is now the only one, behind `bitwig_actions`. Engine on/off switching could cut audio during a session, so only the read-only engine state remains, in `bitwig_status`. `restart_bridge` could not help a stuck bridge because it waited in the same request queue, and `selection_state` repeated what `bitwig_status` and `bitwig_devices` already report.
- Unused copy-and-paste arrangement code in the controller script, and the Bitwig actions only it used.

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

[Unreleased]: https://github.com/remymazmanian/bitwig-control-deck/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/remymazmanian/bitwig-control-deck/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/remymazmanian/bitwig-control-deck/releases/tag/v1.2.0
[1.1.0]: https://github.com/remymazmanian/bitwig-control-deck/releases/tag/v1.1.0
[1.0.2]: https://github.com/remymazmanian/bitwig-control-deck/releases/tag/v1.0.2
[1.0.1]: https://github.com/remymazmanian/bitwig-control-deck/releases/tag/v1.0.1
[1.0.0]: https://github.com/remymazmanian/bitwig-control-deck/releases/tag/v1.0.0

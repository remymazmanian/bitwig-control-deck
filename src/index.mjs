#!/usr/bin/env node
import { appendFile, mkdir } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BitwigClient } from "./bitwig-client.mjs";
import { buildPluginIndex, readPluginIndex, searchPluginIndex } from "./plugin-index.mjs";

const client = new BitwigClient();
const server = new McpServer({ name: "Bitwig Control Deck", version: "1.0.0" });
const logDirectory = new URL("../logs/", import.meta.url);
const logFile = new URL("control-deck.jsonl", logDirectory);

const trackSelector = {
  trackIndex: z.number().int().nonnegative().describe("Zero-based track index returned by bitwig_tracks"),
  trackName: z.string().min(1).describe("Exact track name returned by bitwig_tracks; used as a safety check")
};
const deviceSelector = {
  ...trackSelector,
  deviceIndex: z.number().int().nonnegative().describe("Zero-based device index returned by bitwig_devices"),
  deviceName: z.string().min(1).describe("Exact device name returned by bitwig_devices; used as a safety check")
};

function output(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

function logValue(value) {
  const serialized = JSON.stringify(value);
  if (serialized.length <= 12000) return value;
  return { truncated: true, bytes: Buffer.byteLength(serialized), preview: serialized.slice(0, 12000) };
}

async function writeLog(entry) {
  try {
    await mkdir(logDirectory, { recursive: true });
    await appendFile(logFile, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch {
    // Logging must never break music control.
  }
}

async function call(method, params = {}, timeoutMs) {
  const startedAt = performance.now();
  try {
    const response = await client.request(method, params, timeoutMs);
    await writeLog({ method, arguments: params, durationMs: Math.round(performance.now() - startedAt), success: true, response: logValue(response) });
    return output(response);
  } catch (error) {
    await writeLog({ method, arguments: params, durationMs: Math.round(performance.now() - startedAt), success: false, error: error.message });
    return { content: [{ type: "text", text: error.message }], isError: true };
  }
}

server.registerTool("bitwig_status", {
  description: "Check Control Deck Bridge, Bitwig, the current project, transport, and current selection.",
  inputSchema: {}
}, async () => call("status"));

server.registerTool("bitwig_actions", {
  description: "Search Bitwig Studio's native action registry by action id, name, or menu text.",
  inputSchema: {
    query: z.string().max(120).default("")
  }
}, async args => call("find_actions", args));

server.registerTool("bitwig_invoke_action", {
  description: "Invoke one exact Bitwig action id previously returned by bitwig_actions.",
  inputSchema: {
    actionId: z.string().min(1).max(160)
  }
}, async args => call("invoke_action", args));

server.registerTool("bitwig_transport", {
  description: "Read or control Bitwig transport. Tempo changes are read back before success is reported.",
  inputSchema: {
    action: z.enum(["status", "play", "stop", "toggle", "set_tempo", "set_position"]),
    tempo: z.number().min(20).max(666).optional(),
    positionBeats: z.number().nonnegative().optional()
  }
}, async args => call("transport", args));

server.registerTool("bitwig_cue_markers", {
  description: "List Arranger cue markers, or create/update a named marker set at exact beat positions with Bitwig readback verification.",
  inputSchema: {
    action: z.enum(["list", "upsert"]).default("list"),
    markers: z.array(z.object({
      name: z.string().min(1).max(120),
      positionBeats: z.number().nonnegative()
    })).min(1).max(64).optional()
  }
}, async args => call("cue_markers", args, 30000));

server.registerTool("bitwig_tracks", {
  description: "List Bitwig tracks with exact names, positions, safety references, types, and states.",
  inputSchema: {}
}, async () => call("list_tracks"));

server.registerTool("bitwig_track_meters", {
  description: "Read peak signal activity captured for every Bitwig track, or reset the captured maxima before a playback test.",
  inputSchema: {
    action: z.enum(["read", "reset"]).default("read"),
    resetAfterRead: z.boolean().default(false)
  }
}, async args => call("track_meters", args));

server.registerTool("bitwig_plugins", {
  description: "Search Control Deck's local inventory of installed VST3, VST2, Audio Unit, and CLAP plug-ins without opening Bitwig's Browser.",
  inputSchema: {
    query: z.string().default(""),
    format: z.enum(["all", "VST3", "VST2", "AU", "CLAP"]).default("all"),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(200).default(80)
  }
}, async args => {
  const startedAt = performance.now();
  try {
    const result = searchPluginIndex(await readPluginIndex(), args);
    await writeLog({ method: "plugin_inventory", arguments: args, durationMs: Math.round(performance.now() - startedAt), success: true, response: { total: result.total, returned: result.plugins.length } });
    return output(result);
  } catch (error) {
    await writeLog({ method: "plugin_inventory", arguments: args, durationMs: Math.round(performance.now() - startedAt), success: false, error: error.message });
    return { content: [{ type: "text", text: error.message }], isError: true };
  }
});

server.registerTool("bitwig_refresh_plugin_index", {
  description: "Refresh Control Deck's read-only plug-in inventory after installing or removing audio plug-ins.",
  inputSchema: {}
}, async () => {
  const startedAt = performance.now();
  try {
    const index = await buildPluginIndex();
    const result = { generatedAt: index.generatedAt, uniquePlugins: index.uniquePlugins, pluginBundles: index.pluginBundles, formatCounts: index.formatCounts };
    await writeLog({ method: "refresh_plugin_inventory", arguments: {}, durationMs: Math.round(performance.now() - startedAt), success: true, response: result });
    return output(result);
  } catch (error) {
    await writeLog({ method: "refresh_plugin_inventory", arguments: {}, durationMs: Math.round(performance.now() - startedAt), success: false, error: error.message });
    return { content: [{ type: "text", text: error.message }], isError: true };
  }
});

server.registerTool("bitwig_create_track", {
  description: "Create an empty Bitwig track without opening the Browser or loading any preset.",
  inputSchema: {
    kind: z.enum(["instrument", "audio", "effect"]),
    name: z.string().min(1).max(120)
  }
}, async args => call("create_track", args));

server.registerTool("bitwig_set_track_mix", {
  description: "Set exact mixer values on one verified track and read the resulting state back from Bitwig.",
  inputSchema: {
    ...trackSelector,
    volumeNormalized: z.number().min(0).max(1).optional(),
    panNormalized: z.number().min(0).max(1).optional().describe("0 is left, 0.5 is center, and 1 is right"),
    mute: z.boolean().optional(),
    solo: z.boolean().optional(),
    arm: z.boolean().optional()
  }
}, async args => call("set_track_mix", args));

server.registerTool("bitwig_rename_track", {
  description: "Rename one verified Bitwig track without changing its audio or MIDI routing.",
  inputSchema: {
    ...trackSelector,
    newName: z.string().min(1).max(120)
  }
}, async args => call("rename_track", args));

server.registerTool("bitwig_delete_track", {
  description: "Delete one exact track. The supplied name must still match, preventing index drift mistakes.",
  inputSchema: trackSelector
}, async args => call("delete_track", args));

server.registerTool("bitwig_devices", {
  description: "List devices on one exact track. This reads the device chain directly; it does not inspect presets.",
  inputSchema: trackSelector
}, async args => call("list_devices", args));

server.registerTool("bitwig_nest_device", {
  description: "Move one verified top-level device into another device’s native nested chain and verify the resulting parent and child chains.",
  inputSchema: {
    ...trackSelector,
    parentDeviceIndex: z.number().int().nonnegative(),
    parentDeviceName: z.string().min(1),
    childDeviceIndex: z.number().int().nonnegative(),
    childDeviceName: z.string().min(1),
    slotName: z.string().min(1).default("Post FX")
  }
}, async args => call("nest_device", args, 15000));

server.registerTool("bitwig_save_device_preset", {
  description: "Open Bitwig’s native Save to Library flow for one verified device and optionally confirm its prefilled name without mouse automation.",
  inputSchema: {
    ...deviceSelector,
    presetName: z.string().min(1).max(120),
    confirm: z.boolean().default(true)
  }
}, async args => call("save_device_preset", args, 15000));

server.registerTool("bitwig_create_note_clip", {
  description: "Create or replace a launcher MIDI clip on one exact instrument track and write its complete note content.",
  inputSchema: {
    ...trackSelector,
    slotIndex: z.number().int().min(0).max(7).default(0),
    clipName: z.string().min(1).max(120),
    lengthBeats: z.number().int().min(1).max(512),
    stepSize: z.number().min(0.03125).max(4).default(0.25),
    replace: z.boolean().default(false),
    notes: z.array(z.object({
      beat: z.number().nonnegative(),
      pitch: z.number().int().min(0).max(127),
      velocity: z.number().int().min(1).max(127).default(100),
      duration: z.number().positive(),
      channel: z.number().int().min(0).max(15).default(0)
    })).max(4096)
  }
}, async args => call("create_note_clip", args, 30000));

server.registerTool("bitwig_arrange_launcher_clips", {
  description: "Record existing launcher clips into Bitwig's Arranger across exact requested beat regions, merging contiguous regions and restoring the project tempo afterward.",
  inputSchema: {
    regions: z.array(z.object({
      ...trackSelector,
      slotIndex: z.number().int().min(0).max(7).default(0),
      startBeats: z.number().nonnegative(),
      lengthBeats: z.number().int().min(1).max(512),
      clipName: z.string().min(1).max(120)
    })).min(1).max(64),
    restoreTempo: z.number().min(20).max(666).default(122)
  }
}, async args => call("arrange_launcher_clips", args, 120000));

server.registerTool("bitwig_clips", {
  description: "List populated launcher clips for one exact track.",
  inputSchema: trackSelector
}, async args => call("list_clips", args));

server.registerTool("bitwig_launch_scene", {
  description: "Launch one Control Deck scene immediately and from the start across all tracks.",
  inputSchema: { slotIndex: z.number().int().min(0).max(7).default(0) }
}, async args => call("launch_scene", args));

server.registerTool("bitwig_find_devices", {
  description: "Search Bitwig's Devices browser only. Returns actual device names; presets are excluded by design.",
  inputSchema: {
    ...trackSelector,
    query: z.string().min(1),
    deviceType: z.string().min(1).optional().describe("Optional exact Bitwig filter, such as VST 3 or Bitwig"),
    category: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).default(50)
  }
}, async args => call("find_devices", args, 15000));

server.registerTool("bitwig_insert_device", {
  description: "Insert one exact device at the end of an exact track. Only the Devices session is scanned; insertion is refused if the name is ambiguous.",
  inputSchema: {
    ...trackSelector,
    exactName: z.string().min(1),
    deviceType: z.string().min(1).optional().describe("Recommended when VST2/VST3/CLAP variants share a name"),
    category: z.string().min(1).optional()
  }
}, async args => call("insert_device", args, 20000));

server.registerTool("bitwig_insert_stock_device", {
  description: "Insert a stock Bitwig device by its stable UUID, optionally immediately before one verified device. This supports valid note-processing positions that Bitwig's end-of-chain Browser omits.",
  inputSchema: {
    ...trackSelector,
    bitwigId: z.string().uuid().describe("Stable Bitwig device UUID"),
    beforeDeviceIndex: z.number().int().nonnegative().optional().describe("Optional zero-based target device index"),
    beforeDeviceName: z.string().min(1).optional().describe("Exact target device name; required with beforeDeviceIndex as a safety check")
  }
}, async args => call("insert_bitwig_device", args, 20000));

server.registerTool("bitwig_insert_clap_device", {
  description: "Insert a CLAP plug-in directly by its stable ID, optionally immediately before one verified device, bypassing Bitwig Browser filters and redundant-format hiding.",
  inputSchema: {
    ...trackSelector,
    clapId: z.string().min(1).describe("Stable CLAP ID, such as org.surge-synth-team.surge-xt"),
    beforeDeviceIndex: z.number().int().nonnegative().optional().describe("Optional zero-based target device index"),
    beforeDeviceName: z.string().min(1).optional().describe("Exact target device name; required with beforeDeviceIndex as a safety check")
  }
}, async args => call("insert_clap_device", args, 20000));

server.registerTool("bitwig_find_samples", {
  description: "Search Bitwig's indexed Samples browser on one exact instrument track.",
  inputSchema: {
    ...trackSelector,
    query: z.string().min(1),
    limit: z.number().int().min(1).max(100).default(50)
  }
}, async args => call("find_samples", args, 20000));

server.registerTool("bitwig_insert_sample", {
  description: "Load one exact indexed sample into a new Bitwig Sampler device at the end of an exact instrument track.",
  inputSchema: {
    ...trackSelector,
    exactName: z.string().min(1)
  }
}, async args => call("insert_sample", args, 25000));

server.registerTool("bitwig_insert_sample_file", {
  description: "Load an absolute WAV, AIFF, or FLAC file path into a new Bitwig Sampler device on an exact instrument track and verify the loaded sample name.",
  inputSchema: {
    ...trackSelector,
    path: z.string().min(1)
  }
}, async args => call("insert_sample_file", args, 20000));

server.registerTool("bitwig_delete_device", {
  description: "Delete one exact device. Both the track and device names must still match.",
  inputSchema: deviceSelector
}, async args => call("delete_device", args));

server.registerTool("bitwig_device_parameters", {
  description: "Read a device's full direct parameter list, including third-party plug-ins, with stable IDs and current values.",
  inputSchema: {
    ...deviceSelector,
    query: z.string().optional().describe("Optional case-insensitive parameter name filter"),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(200).default(100)
  }
}, async args => call("list_parameters", args, 10000));

server.registerTool("bitwig_remote_controls", {
  description: "Show Bitwig’s compact eight-knob Remote Controls section for one exact device, hide its long generic parameter list, and optionally select a named page.",
  inputSchema: {
    ...deviceSelector,
    action: z.enum(["status", "show", "hide"]).default("status"),
    pageName: z.string().min(1).optional(),
    pageIndex: z.number().int().nonnegative().optional()
  }
}, async args => call("remote_controls", args, 10000));

server.registerTool("bitwig_selected_device_remote_controls", {
  description: "Show or hide the compact eight-knob Remote Controls section for the currently selected device, including a device nested inside another device.",
  inputSchema: {
    deviceName: z.string().min(1),
    action: z.enum(["status", "show", "hide"]).default("status"),
    pageName: z.string().min(1).optional(),
    pageIndex: z.number().int().nonnegative().optional()
  }
}, async args => call("selected_device_remote_controls", args, 10000));

server.registerTool("bitwig_set_remote_control", {
  description: "Set one visible Bitwig Remote Control by page and control name, using the same native parameter path as the on-screen knobs, then verify the value.",
  inputSchema: {
    ...deviceSelector,
    pageName: z.string().min(1).optional(),
    pageIndex: z.number().int().nonnegative().optional(),
    controlName: z.string().min(1).optional(),
    controlIndex: z.number().int().min(0).max(7).optional(),
    value: z.number().min(0).max(1)
  }
}, async args => call("set_remote_control", args, 10000));

server.registerTool("bitwig_set_device_parameter", {
  description: "Set one device parameter by its stable ID and verify the normalized value through Bitwig readback.",
  inputSchema: {
    ...deviceSelector,
    parameterId: z.string().min(1).describe("Stable ID returned by bitwig_device_parameters"),
    value: z.number().min(0).max(1).describe("Normalized value from 0 to 1")
  }
}, async args => call("set_parameter", args, 10000));

server.registerTool("bitwig_open_device_window", {
  description: "Open the native window for one exact device or plug-in.",
  inputSchema: deviceSelector
}, async args => call("open_device_window", args));

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", () => {
  client.close();
  process.exit(0);
});

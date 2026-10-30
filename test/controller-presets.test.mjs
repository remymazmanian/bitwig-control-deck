import test from "node:test";
import assert from "node:assert/strict";
import { loadController, value } from "./support/load-controller.mjs";

function setup({ results = ["Init", "Pad Warm", "Bass"], types = ["Devices", "Presets"] } = {}) {
  const loaded = loadController();
  const { context } = loaded;
  context.dispatch = loaded.originalDispatch;
  const state = {
    open: false, audition: true, type: 0, preset: "Init", deviceName: "Pigments",
    picked: "", inserted: null, undos: 0, results
  };
  const device = {
    name: () => value(() => state.deviceName),
    presetName: () => value(() => state.preset),
    replaceDeviceInsertionPoint: () => ({
      browse: () => { state.open = true; },
      insertFile: path => { state.inserted = path; state.preset = "From File"; }
    })
  };
  context.selectDevice = (request, params, callback) => callback(device);
  context.popupBrowser = {
    exists: () => value(() => state.open),
    shouldAudition: () => value(() => state.audition, next => { state.audition = next; }),
    contentTypeNames: () => value(() => types),
    selectedContentTypeIndex: () => value(() => state.type, next => { state.type = next; }),
    cancel: () => { state.open = false; },
    commit: () => { state.preset = state.picked; state.open = false; }
  };
  context.resultColumn = { entryCount: () => value(() => state.results.length) };
  context.resultBank = {
    scrollPosition: () => value(() => 0, () => {}),
    getItemAt: index => ({
      exists: () => value(() => index < state.results.length),
      name: () => value(() => state.results[index] || ""),
      isSelected: () => value(() => false, () => { state.picked = state.results[index]; })
    })
  };
  context.application = { undo: () => { state.undos += 1; state.preset = "Init"; state.deviceName = "Pigments"; } };
  return { ...loaded, state, device };
}

const deviceArgs = { trackIndex: 0, trackName: "Keys", deviceIndex: 0, deviceName: "Pigments" };

test("find_presets searches the preset tab and does not load one", () => {
  const { context, responses, advance, state } = setup();
  context.enqueue(5000, "1", "find_presets", { ...deviceArgs, query: "pad" }, 20000);
  advance(5000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.deepEqual(JSON.parse(JSON.stringify(responses[0].payload.matches.map(match => match.name))), ["Pad Warm"]);
  assert.equal(state.preset, "Init");
  assert.equal(state.open, false);
  assert.equal(state.audition, false);
  assert.match(responses[0].payload.limit, /own preset browser/);
});

test("find_presets reports a device browser with no preset tab", () => {
  const { context, responses, advance, state } = setup({ types: ["Devices"] });
  context.enqueue(5000, "1", "find_presets", { ...deviceArgs, query: "pad" }, 20000);
  advance(2000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /no Presets tab/);
  assert.equal(state.open, false);
  assert.equal(state.preset, "Init");
});

test("load_preset commits one exact browser preset and reads the name back", () => {
  const { context, responses, advance, state } = setup();
  context.enqueue(5000, "1", "load_preset", { ...deviceArgs, exactName: "Pad Warm" }, 20000);
  advance(8000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.equal(responses[0].payload.presetNameAfter, "Pad Warm");
  assert.equal(responses[0].payload.deviceNameUnchanged, true);
  assert.equal(state.preset, "Pad Warm");
});

test("load_preset inserts a preset file and undoes a device swap", () => {
  const { context, responses, advance, state } = setup();
  context.selectDevice = (request, params, callback) => callback({
    name: () => value(() => state.deviceName),
    presetName: () => value(() => state.preset),
    replaceDeviceInsertionPoint: () => ({
      insertFile: () => { state.deviceName = "Wavetable"; state.preset = "Other"; }
    })
  });
  context.enqueue(5000, "1", "load_preset", { ...deviceArgs, path: "/Users/remy/Presets/Pad.bwpreset" }, 20000);
  advance(3000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /Undo was used/);
  assert.equal(state.undos, 1);
  assert.equal(state.deviceName, "Pigments");
});

test("a preset path has to be a Bitwig or VST3 preset file", () => {
  const { context, responses, advance, state } = setup();
  context.enqueue(5000, "1", "load_preset", { ...deviceArgs, path: "/tmp/kick.wav" }, 20000);
  advance(200);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /bwpreset/);
  assert.equal(state.inserted, null);
});

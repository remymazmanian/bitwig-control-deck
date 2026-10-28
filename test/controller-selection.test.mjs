import test from "node:test";
import assert from "node:assert/strict";
import { loadController, value } from "./support/load-controller.mjs";

function meterSetup(names) {
  const loaded = loadController();
  const { context } = loaded;
  const items = names.map(name => ({ name, meter: null }));
  const tracks = items.map((item, index) => ({
    exists: () => value(() => Boolean(items[index])),
    name: () => value(() => items[index].name),
    addVuMeterObserver: (range, channel, peak, callback) => { item.meter = callback; }
  }));
  context.trackBank = {
    itemCount: () => value(() => items.length),
    getItemAt: index => tracks[index]
  };
  tracks.forEach((track, index) => context.observeTrackMeter(track, index));
  return { ...loaded, items };
}

test("meter maxima stay with the track that produced them", () => {
  const { context, items } = meterSetup(["Drums", "Pad"]);
  items[0].meter(120);
  items[0].meter(30);
  items[1].meter(10);
  let meters = JSON.parse(JSON.stringify(context.readTrackMeters(false).meters));
  assert.deepEqual(meters.map(m => [m.name, m.maximum]), [["Drums", 120], ["Pad", 10]]);

  // A new track is inserted above: Drums moves to position 1 and "Bass" sits at 0.
  items[1].name = "Drums";
  items[0].name = "Bass";
  meters = JSON.parse(JSON.stringify(context.readTrackMeters(false).meters));
  assert.deepEqual(meters.map(m => [m.name, m.maximum]), [["Bass", 30], ["Drums", 10]]);
});

test("a level arriving after a move starts a fresh maximum", () => {
  const { context, items } = meterSetup(["Drums"]);
  items[0].meter(120);
  items[0].name = "Bass";
  items[0].meter(20);
  const meters = context.readTrackMeters(false).meters;
  assert.equal(meters[0].maximum, 20);
  items[0].meter(40);
  assert.equal(context.readTrackMeters(false).meters[0].maximum, 40);
});

function presetSetup() {
  const loaded = loadController();
  const { context } = loaded;
  context.dispatch = loaded.originalDispatch;
  const state = { enters: 0, invoked: 0, preset: "Init", cursorName: "Polymer", cursorTrack: "Lead" };
  const device = {
    name: () => value(() => "Polymer"),
    position: () => value(() => 0),
    presetName: () => value(() => state.preset),
    selectInEditor: () => {}
  };
  context.selectDevice = (request, params, callback) => callback(device);
  context.deviceSnapshot = (d, index) => ({ index, name: d.name().get() });
  context.cursorTrack = { name: () => value(() => state.cursorTrack) };
  context.cursorDevice = {
    exists: () => value(() => true),
    name: () => value(() => state.cursorName),
    position: () => value(() => 0)
  };
  context.application = { enter: () => { state.enters++; state.preset = "Bright Lead"; } };
  context.saveToLibraryAction = { invoke: () => { state.invoked++; } };
  const params = { trackIndex: 0, trackName: "Lead", deviceIndex: 0, deviceName: "Polymer", presetName: "Bright Lead" };
  return { ...loaded, state, params };
}

test("save_device_preset leaves the dialog open unless confirm is true", () => {
  const { context, responses, advance, state, params } = presetSetup();
  context.enqueue(15000, "1", "save_device_preset", params, 15000);
  advance(3000);
  assert.equal(responses[0].ok, true);
  assert.equal(state.invoked, 1);
  assert.equal(state.enters, 0);
  assert.equal(responses[0].payload.confirmationSent, false);
  assert.equal(responses[0].payload.nameEntryRequired, true);
});

test("save_device_preset presses Enter only while the same device is selected", () => {
  const { context, responses, advance, state, params } = presetSetup();
  context.enqueue(15000, "1", "save_device_preset", { ...params, confirm: true }, 15000);
  advance(3000);
  assert.equal(responses[0].ok, true);
  assert.equal(state.enters, 1);
  assert.equal(responses[0].payload.presetNameBefore, "Init");
  assert.equal(responses[0].payload.presetNameAfter, "Bright Lead");
});

test("save_device_preset does not press Enter after the selection moved", () => {
  const { context, responses, advance, state, params } = presetSetup();
  context.saveToLibraryAction = { invoke: () => { state.invoked++; state.cursorName = "EQ+"; } };
  context.enqueue(15000, "1", "save_device_preset", { ...params, confirm: true }, 15000);
  advance(3000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /Enter was not pressed/);
  assert.equal(state.enters, 0);
});

test("save_device_preset explains a missing Save to Library action", () => {
  const { context, responses, advance, params } = presetSetup();
  context.saveToLibraryAction = null;
  context.enqueue(15000, "1", "save_device_preset", params, 15000);
  advance(3000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /no Save to Library action/);
});

function selectionSetup() {
  const loaded = loadController();
  const { context } = loaded;
  const tracks = [
    { name: "Drums", devices: ["Drum Machine", "EQ+"], selectedDevice: 1 },
    { name: "Lead", devices: ["Polymer", "Delay+"], selectedDevice: 0 }
  ];
  const state = { track: 0 };
  const current = () => tracks[state.track];
  const deviceItem = index => ({
    name: () => value(() => current().devices[index]),
    index
  });
  context.trackBank = {
    itemCount: () => value(() => tracks.length),
    getItemAt: index => ({
      exists: () => value(() => Boolean(tracks[index])),
      name: () => value(() => tracks[index].name),
      selectInMixer: () => { state.track = index; }
    })
  };
  context.trackIsCursor = tracks.map((track, index) => value(() => state.track === index));
  context.cursorTrack = { name: () => value(() => current().name) };
  context.cursorDevice = {
    exists: () => value(() => current().selectedDevice >= 0),
    isNested: () => value(() => false),
    name: () => value(() => current().devices[current().selectedDevice]),
    position: () => value(() => current().selectedDevice),
    selectDevice: item => { current().selectedDevice = item.index; }
  };
  context.deviceBank = {
    itemCount: () => value(() => current().devices.length),
    getItemAt: deviceItem
  };
  const request = { id: "1", source: 0, done: false };
  return { ...loaded, tracks, state, request };
}

test("the selected track comes back after a tool selected another one", () => {
  const { context, advance, state, request } = selectionSetup();
  let reached = false;
  context.selectTrack(request, { trackIndex: 1, trackName: "Lead" }, () => { reached = true; });
  advance(200);
  assert.equal(reached, true);
  assert.equal(state.track, 1);
  context.finish(request, true, {});
  assert.equal(state.track, 0);
});

test("the selected device comes back on the same track, following it by name", () => {
  const { context, advance, tracks, request } = selectionSetup();
  context.selectTrack(request, { trackIndex: 0, trackName: "Drums" }, () => {
    tracks[0].devices.unshift("Note FX");   // a device inserted in front
    tracks[0].selectedDevice = 0;
  });
  advance(200);
  context.finish(request, false, { message: "failed" });
  assert.equal(tracks[0].selectedDevice, 2);
  assert.equal(tracks[0].devices[2], "EQ+");
});

test("nothing is reselected when the original track is gone", () => {
  const { context, advance, tracks, state, request } = selectionSetup();
  context.selectTrack(request, { trackIndex: 1, trackName: "Lead" }, () => {});
  advance(200);
  tracks[0].name = "Renamed";
  context.finish(request, true, {});
  assert.equal(state.track, 1);
});

test("an earlier cleanup still runs when the selection is restored", () => {
  const { context, advance, state, request } = selectionSetup();
  const order = [];
  request.cleanup = () => order.push("earlier");
  context.selectTrack(request, { trackIndex: 1, trackName: "Lead" }, () => {});
  advance(200);
  context.finish(request, true, {});
  assert.deepEqual(order, ["earlier"]);
  assert.equal(state.track, 0);
});

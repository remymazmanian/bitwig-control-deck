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

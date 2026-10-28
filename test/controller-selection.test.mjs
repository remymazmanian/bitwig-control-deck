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

import test from "node:test";
import assert from "node:assert/strict";
import { loadController, value } from "./support/load-controller.mjs";

function setup(names) {
  const loaded = loadController();
  const { context } = loaded;
  context.dispatch = loaded.originalDispatch;
  const items = names.map(name => ({ name }));
  context.trackBank = {
    itemCount: () => value(() => items.length),
    getItemAt: index => ({
      exists: () => value(() => Boolean(items[index])),
      name: () => value(() => items[index].name),
      setName: next => { items[index].name = next; },
      selectInMixer: () => {}
    })
  };
  context.trackSnapshot = (track, index) => ({ index, name: track.name().get() });
  return { ...loaded, items };
}

test("tools refuse a track whose name another track shares", () => {
  const { context, responses, advance } = setup(["Drums", "Audio", "Bass", "Audio"]);
  context.enqueue(5000, "1", "set_track_mix", { trackIndex: 3, trackName: "Audio", mute: true }, 5000);
  advance(1000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /Tracks 1, 3 are all named ‘Audio’/);
});

test("a track with a unique name passes the check", () => {
  const { context } = setup(["Drums", "Audio", "Bass", "Audio"]);
  assert.equal(context.requireTrack({ trackIndex: 2, trackName: "Bass" }).name().get(), "Bass");
});

test("rename_track still works on a duplicate so the clash can be fixed", () => {
  const { context, responses, advance, items } = setup(["Audio", "Audio"]);
  context.enqueue(5000, "1", "rename_track", { trackIndex: 1, trackName: "Audio", newName: "Vox" }, 5000);
  advance(1000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.deepEqual(items.map(i => i.name), ["Audio", "Vox"]);
});

test("rename_track refuses a name another track already has", () => {
  const { context, responses, advance, items } = setup(["Drums", "Bass"]);
  context.enqueue(5000, "1", "rename_track", { trackIndex: 1, trackName: "Bass", newName: "Drums" }, 5000);
  advance(1000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /Track 0 is already named ‘Drums’/);
  assert.deepEqual(items.map(i => i.name), ["Drums", "Bass"]);
});

test("rename_track to its own current name is allowed", () => {
  const { context, responses, advance } = setup(["Drums", "Bass"]);
  context.enqueue(5000, "1", "rename_track", { trackIndex: 1, trackName: "Bass", newName: "Bass" }, 5000);
  advance(1000);
  assert.equal(responses[0].ok, true);
});

test("bitwig_tracks lists names that need fixing", () => {
  const { context } = setup(["Audio", "Bass", "Audio", "Audio"]);
  context.trackSnapshot = (track, index) => ({ index, name: track.name().get() });
  const result = context.listTracks();
  assert.deepEqual(JSON.parse(JSON.stringify(result.duplicateNames)), ["Audio"]);
  assert.match(result.note, /bitwig_rename_track/);
});

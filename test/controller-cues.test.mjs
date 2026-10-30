import test from "node:test";
import assert from "node:assert/strict";
import { loadController, value } from "./support/load-controller.mjs";

// Bitwig 18 adds cue markers only at the play position. This fake adds the
// marker a tick later and records every playhead move the bridge makes.
function setup({ playhead = 16, playing = false, markers = [], addWorks = true } = {}) {
  const loaded = loadController();
  const { context } = loaded;
  context.dispatch = loaded.originalDispatch;
  const state = { playhead, playing, markers: markers.map(m => ({ ...m })), moves: [] };
  const view = marker => ({
    exists: () => value(() => state.markers.includes(marker)),
    name: () => value(() => marker.name, next => { marker.name = next; }),
    position: () => ({ ...value(() => marker.positionBeats), setRaw: next => { marker.positionBeats = next; } }),
    deleteObject: () => {
      context.host.scheduleTask(() => {
        const at = state.markers.indexOf(marker);
        if (at >= 0) state.markers.splice(at, 1);
      }, 30);
    }
  });
  context.transport = {
    getPosition: () => value(() => state.playhead),
    setPosition: next => { state.moves.push(next); context.host.scheduleTask(() => { state.playhead = next; }, 20); },
    isPlaying: () => value(() => state.playing),
    addCueMarkerAtPlaybackPosition: () => {
      if (!addWorks) return;
      const at = state.playhead;
      context.host.scheduleTask(() => state.markers.push({ name: "", positionBeats: at }), 30);
    }
  };
  context.cueMarkerBank = {
    itemCount: () => value(() => state.markers.length),
    getItemAt: index => (state.markers[index] ? view(state.markers[index]) : { exists: () => value(() => false) })
  };
  context.arranger = { areCueMarkersVisible: () => value(() => true) };
  return { ...loaded, state };
}

function upsert(context, markers) {
  context.enqueue(5000, "1", "cue_markers", { action: "upsert", markers }, 30000);
}

const plain = list => JSON.parse(JSON.stringify(list)).sort((a, b) => a.positionBeats - b.positionBeats);

test("new cue markers are added without moving a stopped playhead", () => {
  const { context, responses, advance, state } = setup({ playhead: 16 });
  upsert(context, [{ name: "Intro", positionBeats: 0 }, { name: "Drop", positionBeats: 32 }]);
  advance(5000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.equal(responses[0].payload.created, 2);
  assert.deepEqual(plain(state.markers), [{ name: "Intro", positionBeats: 0 }, { name: "Drop", positionBeats: 32 }]);
  assert.deepEqual(state.moves, []);
  assert.equal(state.playhead, 16);
});

test("new cue markers are added during playback without a jump", () => {
  const { context, responses, advance, state } = setup({ playhead: 40, playing: true, markers: [{ name: "Old", positionBeats: 40 }] });
  upsert(context, [{ name: "Bridge", positionBeats: 96 }]);
  advance(5000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.deepEqual(state.moves, []);
});

test("a marker at the playhead is added last so the playhead stays put", () => {
  const { context, responses, advance, state } = setup({ playhead: 0 });
  upsert(context, [{ name: "Intro", positionBeats: 0 }, { name: "Verse", positionBeats: 8 }]);
  advance(5000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.deepEqual(plain(state.markers), [{ name: "Intro", positionBeats: 0 }, { name: "Verse", positionBeats: 8 }]);
  assert.deepEqual(state.moves, []);
});

test("a stopped playhead sitting on a marker is moved aside and put back", () => {
  const { context, responses, advance, state } = setup({ playhead: 16, markers: [{ name: "Verse", positionBeats: 16 }] });
  upsert(context, [{ name: "Chorus", positionBeats: 48 }]);
  advance(5000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.equal(state.moves.length, 2);
  assert.ok(state.moves[0] >= 112);
  assert.equal(state.moves[1], 16);
  assert.equal(state.playhead, 16);
  assert.deepEqual(plain(state.markers), [{ name: "Verse", positionBeats: 16 }, { name: "Chorus", positionBeats: 48 }]);
});

test("updating existing markers adds nothing and leaves the playhead alone", () => {
  const { context, responses, advance, state } = setup({ markers: [{ name: "A", positionBeats: 4 }] });
  upsert(context, [{ name: "Renamed", positionBeats: 4 }]);
  advance(5000);
  assert.equal(responses[0].ok, true);
  assert.equal(responses[0].payload.updated, 1);
  assert.equal(responses[0].payload.created, 0);
  assert.deepEqual(state.moves, []);
});

test("a failed add after moving the playhead aside still puts it back", () => {
  const { context, responses, advance, state } = setup({ playhead: 16, markers: [{ name: "Verse", positionBeats: 16 }], addWorks: false });
  upsert(context, [{ name: "Chorus", positionBeats: 48 }]);
  advance(10000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /did not create a new cue marker/);
  assert.equal(state.moves.at(-1), 16);
  advance(100);
  assert.equal(state.playhead, 16);
});

test("rename changes one cue marker and reads the new name back", () => {
  const { context, responses, advance, state } = setup({ markers: [{ name: "Intro", positionBeats: 0 }, { name: "Drop", positionBeats: 32 }] });
  context.enqueue(5000, "1", "cue_markers", { action: "rename", index: 1, name: "Drop", newName: "Chorus" }, 30000);
  advance(1000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.equal(state.markers[1].name, "Chorus");
  assert.equal(responses[0].payload.marker.name, "Chorus");
  assert.equal(state.markers[0].name, "Intro");
});

test("rename refuses a cue marker whose name does not match", () => {
  const { context, responses, advance, state } = setup({ markers: [{ name: "Intro", positionBeats: 0 }] });
  context.enqueue(5000, "1", "cue_markers", { action: "rename", index: 0, name: "Verse", newName: "Chorus" }, 30000);
  advance(200);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /now named/);
  assert.equal(state.markers[0].name, "Intro");
});

test("delete removes one cue marker and leaves the others", () => {
  const { context, responses, advance, state } = setup({ markers: [{ name: "Intro", positionBeats: 0 }, { name: "Drop", positionBeats: 32 }] });
  context.enqueue(5000, "1", "cue_markers", { action: "delete", index: 0, name: "Intro" }, 30000);
  advance(1000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.deepEqual(state.markers, [{ name: "Drop", positionBeats: 32 }]);
  assert.equal(responses[0].payload.deleted.name, "Intro");
});

test("a failed add without a move does not touch the playhead", () => {
  const { context, responses, advance, state } = setup({ playhead: 16, addWorks: false });
  upsert(context, [{ name: "Chorus", positionBeats: 48 }]);
  advance(10000);
  assert.equal(responses[0].ok, false);
  assert.deepEqual(state.moves, []);
});

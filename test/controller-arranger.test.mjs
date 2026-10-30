import test from "node:test";
import assert from "node:assert/strict";
import { loadController, value } from "./support/load-controller.mjs";

function beat(get, set) {
  const cell = value(get, set);
  cell.setRaw = set || (() => {});
  return cell;
}

// A cursor over a fixed list of Arranger clips. Navigation methods are optional
// so the selected-only host can be tested too.
function setup({ clips, navigate = true, selected = 0 }) {
  const loaded = loadController();
  const { context } = loaded;
  context.dispatch = loaded.originalDispatch;
  let index = selected;
  const trackFor = clip => ({
    exists: () => value(() => true),
    name: () => value(() => clip.trackName),
    trackType: () => value(() => clip.trackType)
  });
  const cursor = {
    exists: () => value(() => index >= 0 && index < clips.length),
    getTrack: () => trackFor(clips[Math.min(Math.max(index, 0), clips.length - 1)] || { trackName: "", trackType: "" }),
    getPlayStart: () => beat(() => (clips[index] ? clips[index].start : 0)),
    getPlayStop: () => beat(() => (clips[index] ? clips[index].end : 0)),
    getLoopStart: () => beat(() => 0),
    getLoopLength: () => beat(() => (clips[index] ? clips[index].end - clips[index].start : 0)),
    isLoopEnabled: () => value(() => true),
    setName: () => {}
  };
  if (navigate) {
    cursor.selectFirst = () => { index = clips.length ? 0 : -1; };
    cursor.selectNext = () => { if (index < clips.length - 1) index += 1; };
    cursor.hasNext = () => value(() => index >= 0 && index < clips.length - 1);
  }
  context.arrangerClip = cursor;
  context.trackBank = {
    itemCount: () => value(() => 2),
    getItemAt: bankIndex => ({
      exists: () => value(() => bankIndex < 2),
      name: () => value(() => ["Vocals", "Drums"][bankIndex] || "")
    })
  };
  return { ...loaded, cursor, selected: () => index };
}

const clips = [
  { trackName: "Vocals", trackType: "Audio", start: 0, end: 16 },
  { trackName: "Drums", trackType: "Instrument", start: 16, end: 32 },
  { trackName: "Vocals", trackType: "Audio", start: 32, end: 48 }
];

test("the arranger cursor lists every clip it can walk, without names or stretch mode", () => {
  const { context, responses, advance, selected } = setup({ clips, selected: 2 });
  context.enqueue(5000, "1", "list_arranger_clips", { limit: 128 }, 60000);
  advance(20000);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  const payload = responses[0].payload;
  assert.equal(payload.navigation, "cursor");
  assert.equal(payload.complete, true);
  assert.equal(payload.nameReadable, false);
  assert.equal(payload.stretchModeReadable, false);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.clips.map(clip => [clip.trackName, clip.kind, clip.playStartBeats, clip.playStopBeats, clip.name, clip.stretchMode]))), [
    ["Vocals", "audio", 0, 16, null, null],
    ["Drums", "note", 16, 32, null, null],
    ["Vocals", "audio", 32, 48, null, null]
  ]);
  assert.equal(payload.clips[0].trackIndex, 0);
  assert.equal(payload.clips[1].trackIndex, 1);
  assert.equal(selected(), 2, "the clip that was selected at the start is selected again");
});

test("a cursor that cannot move reports only the selected arranger clip", () => {
  const { context, responses, advance } = setup({ clips, navigate: false, selected: 1 });
  context.enqueue(5000, "1", "list_arranger_clips", {}, 60000);
  advance(1000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.equal(responses[0].payload.navigation, "selected-only");
  assert.equal(responses[0].payload.complete, false);
  assert.equal(responses[0].payload.clipCount, 1);
  assert.equal(responses[0].payload.clips[0].trackName, "Drums");
  assert.match(responses[0].payload.limit, /cannot move to the next clip/);
});

test("rename sends a new name for the matching arranger clip and does not claim it was read back", () => {
  const { context, responses, advance } = setup({ clips, selected: 0 });
  let renamed = null;
  context.arrangerClip.setName = name => { renamed = name; };
  context.enqueue(5000, "1", "rename_clip", { where: "arranger", trackIndex: 0, trackName: "Vocals", startBeats: 32, newName: "Chorus" }, 30000);
  advance(20000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.equal(renamed, "Chorus");
  assert.equal(responses[0].payload.verified, false);
  assert.equal(responses[0].payload.nameReadable, false);
});

test("rename refuses an arranger clip the cursor cannot find", () => {
  const { context, responses, advance } = setup({ clips, navigate: false, selected: 1 });
  context.enqueue(5000, "1", "rename_clip", { where: "arranger", trackIndex: 0, trackName: "Vocals", startBeats: 0, newName: "Chorus" }, 30000);
  advance(1000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /cannot move that cursor/);
});

test("an empty arranger selection lists nothing", () => {
  const { context, responses, advance } = setup({ clips: [], navigate: false, selected: 0 });
  context.enqueue(5000, "1", "list_arranger_clips", {}, 60000);
  advance(500);
  assert.equal(responses[0].ok, true);
  assert.equal(responses[0].payload.clipCount, 0);
  assert.equal(responses[0].payload.clips.length, 0);
});

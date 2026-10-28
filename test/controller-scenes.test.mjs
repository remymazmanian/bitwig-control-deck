import test from "node:test";
import assert from "node:assert/strict";
import { loadController, value } from "./support/load-controller.mjs";

// A scene window of eight that scrolls like Bitwig's: the move shows up on the
// next tick, and `clamp` mimics a bank that stops once the last scene is in view.
function setup({ sceneCount = 20, clips = {}, clamp = false, stuck = false } = {}) {
  const loaded = loadController();
  const { context } = loaded;
  context.dispatch = loaded.originalDispatch;
  const state = { sceneCount, position: 0, launched: [], selected: [], created: [] };
  const scrollPosition = value(() => state.position, next => {
    if (stuck) return;
    const target = clamp ? Math.max(0, Math.min(next, state.sceneCount - 8)) : next;
    context.host.scheduleTask(() => { state.position = target; }, 10);
  });
  const slot = absolute => ({
    absolute,
    exists: () => value(() => absolute < state.sceneCount),
    name: () => value(() => (clips[absolute] || "")),
    hasContent: () => value(() => Boolean(clips[absolute])),
    isSelected: () => value(() => false),
    isPlaying: () => value(() => false),
    select: () => state.selected.push(absolute),
    showInEditor: () => {},
    createEmptyClip: () => { clips[absolute] = "New"; },
    deleteObject: () => { delete clips[absolute]; }
  });
  const track = {
    clipLauncherSlotBank: () => ({ getItemAt: local => slot(state.position + local) }),
    createNewLauncherClip: (slotIndex, lengthBeats) => {
      state.created.push({ slotIndex, lengthBeats });
      context.host.scheduleTask(() => { state.sceneCount = Math.max(state.sceneCount, slotIndex + 1); clips[slotIndex] = "New"; }, 30);
    }
  };
  context.sceneBank = {
    itemCount: () => value(() => state.sceneCount),
    scrollPosition: () => scrollPosition,
    getItemAt: local => ({ launchWithOptions: (q, m) => state.launched.push({ scene: state.position + local, q, m }) })
  };
  context.requireTrack = () => track;
  context.selectTrack = (request, params, callback) => {
    try { callback(track); } catch (error) { context.finish(request, false, { message: String(error.message || error) }); }
  };
  context.readTransport = () => ({});
  return { ...loaded, state, track, clips };
}

const TRACK = { trackIndex: 0, trackName: "Keys" };

test("bitwig_clips lists clips in every scene and scrolls the window back", () => {
  const { context, responses, advance, state } = setup({ sceneCount: 20, clips: { 2: "A", 9: "B", 17: "C" } });
  context.enqueue(5000, "1", "list_clips", TRACK, 60000);
  advance(5000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.deepEqual(JSON.parse(JSON.stringify(responses[0].payload.clips.map(c => [c.slotIndex, c.name]))), [[2, "A"], [9, "B"], [17, "C"]]);
  assert.equal(responses[0].payload.sceneCount, 20);
  advance(100);
  assert.equal(state.position, 0);
});

test("bitwig_clips still reads every scene when Bitwig stops scrolling at the last full window", () => {
  const { context, responses, advance } = setup({ sceneCount: 12, clips: { 0: "A", 11: "Z" }, clamp: true });
  context.enqueue(5000, "1", "list_clips", TRACK, 60000);
  advance(5000);
  assert.deepEqual(JSON.parse(JSON.stringify(responses[0].payload.clips.map(c => c.slotIndex))), [0, 11]);
});

test("launch_scene reaches a scene past the first eight", () => {
  const { context, responses, advance, state } = setup({ sceneCount: 20 });
  context.enqueue(5000, "1", "launch_scene", { slotIndex: 12 }, 5000);
  advance(1000);
  assert.equal(responses[0].ok, true);
  assert.deepEqual(state.launched.map(l => l.scene), [12]);
  advance(100);
  assert.equal(state.position, 0);
});

test("launch_scene refuses a scene the project does not have", () => {
  const { context, responses, advance, state } = setup({ sceneCount: 10 });
  context.enqueue(5000, "1", "launch_scene", { slotIndex: 10 }, 5000);
  advance(1000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /Slot 10 does not exist. The project has 10 scenes/);
  assert.deepEqual(state.launched, []);
});

test("a scene window that will not scroll fails the request", () => {
  const { context, responses, advance } = setup({ sceneCount: 20, stuck: true });
  context.enqueue(5000, "1", "launch_scene", { slotIndex: 12 }, 5000);
  advance(3000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /did not scroll its scene window to slot 12/);
});

test("clip_notes selects the clip in the requested scene", () => {
  const { context, responses, advance, state } = setup({ sceneCount: 20, clips: { 10: "Riff" } });
  context.launcherClip = { exists: () => value(() => false) };
  context.enqueue(5000, "1", "clip_notes", { ...TRACK, slotIndex: 10 }, 60000);
  advance(2000);
  assert.deepEqual(state.selected, [10]);
  assert.match(responses[0].payload.message, /launcher clip in slot 10/);
});

test("create_note_clip writes into a slot past the first eight", () => {
  const { context, responses, advance, state, clips } = setup({ sceneCount: 20 });
  let filled;
  context.fillNewClip = (request, params, slot, slotIndex) => {
    filled = { absolute: slot.absolute, slotIndex };
    context.finish(request, true, {});
  };
  context.enqueue(5000, "1", "create_note_clip", { ...TRACK, slotIndex: 14, clipName: "Riff", lengthBeats: 4, notes: [] }, 60000);
  advance(2000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.deepEqual(filled, { absolute: 14, slotIndex: 14 });
  assert.equal(clips[14], "New");
  assert.deepEqual(state.created, []);
});

test("create_note_clip one past the last scene asks Bitwig for a new scene", () => {
  const { context, responses, advance, state } = setup({ sceneCount: 8 });
  let filled;
  context.fillNewClip = (request, params, slot, slotIndex) => {
    filled = { absolute: slot.absolute, slotIndex };
    context.finish(request, true, {});
  };
  context.enqueue(5000, "1", "create_note_clip", { ...TRACK, slotIndex: 8, clipName: "Riff", lengthBeats: 16, notes: [] }, 60000);
  advance(2000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.deepEqual(state.created, [{ slotIndex: 8, lengthBeats: 16 }]);
  assert.deepEqual(filled, { absolute: 8, slotIndex: 8 });
});

test("create_note_clip refuses a slot more than one past the last scene", () => {
  const { context, responses, advance, state } = setup({ sceneCount: 8 });
  context.enqueue(5000, "1", "create_note_clip", { ...TRACK, slotIndex: 9, clipName: "Riff", lengthBeats: 4, notes: [] }, 60000);
  advance(1000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /a new clip can go in slot 8 at most/);
  assert.deepEqual(state.created, []);
});

test("slots above 1023 are refused before Bitwig is touched", () => {
  const { context, responses, advance } = setup();
  context.enqueue(5000, "1", "launch_scene", { slotIndex: 1024 }, 5000);
  advance(100);
  assert.match(responses[0].payload.message, /from 0 to 1023/);
});

test("the launcher print waits until the scene window is back on the first scenes", () => {
  const { context, responses, advance, state } = setup();
  state.position = 8;
  context.enqueue(5000, "1", "arrange_launcher_clips", { regions: [{ ...TRACK, slotIndex: 0, startBeats: 0, lengthBeats: 4, clipName: "x" }] }, 120000);
  advance(100);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /still scrolled/);
  assert.equal(state.position, 0);
});

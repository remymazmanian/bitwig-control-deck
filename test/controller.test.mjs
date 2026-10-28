import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../controller/ControlDeck.control.js", import.meta.url), "utf8");

// Loads the controller script against a fake Bitwig host with a manual clock,
// so request handling can be tested without Bitwig running.
function loadController() {
  const clock = { now: 0, tasks: [] };
  const responses = [];
  const host = {
    defineController() {},
    defineMidiPorts() {},
    addDeviceNameBasedDiscoveryPair() {},
    scheduleTask(callback, delay) { clock.tasks.push({ at: clock.now + delay, callback }); },
    println() {},
    errorln() {}
  };
  const context = vm.createContext({ loadAPI() {}, host, Date: { now: () => clock.now } });
  vm.runInContext(SOURCE, context);
  context.respond = (port, id, ok, payload) => responses.push({ id, ok, payload });

  function advance(ms) {
    const end = clock.now + ms;
    for (;;) {
      clock.tasks.sort((a, b) => a.at - b.at);
      const next = clock.tasks[0];
      if (!next || next.at > end) break;
      clock.tasks.shift();
      clock.now = next.at;
      next.callback();
    }
    clock.now = end;
  }

  return { context, responses, advance, originalDispatch: context.dispatch };
}

test("a step that throws fails its own request and frees the bridge", () => {
  const { context, responses, advance } = loadController();
  context.dispatch = request => {
    if (request.method === "bad") context.later(10, () => { throw new Error("boom"); });
    else context.finish(request, true, { done: true });
  };
  context.enqueue(5000, "1", "bad", {}, 5000);
  context.enqueue(5000, "2", "good", {}, 5000);
  advance(100);
  assert.deepEqual(responses.map(r => [r.id, r.ok]), [["1", false], ["2", true]]);
  assert.match(responses[0].payload.message, /boom/);
  assert.equal(context.requestBusy, false);
});

test("a request that stalls inside Bitwig times out and the next one runs", () => {
  const { context, responses, advance } = loadController();
  context.dispatch = request => {
    if (request.method === "good") context.finish(request, true, {});
  };
  context.enqueue(5000, "1", "hang", {}, 500);
  context.enqueue(5000, "2", "good", {}, 5000);
  advance(1400);
  assert.equal(responses.length, 0, "still within the stalled request's limit");
  advance(200);
  assert.deepEqual(responses.map(r => [r.id, r.ok]), [["1", false], ["2", true]]);
  assert.match(responses[0].payload.message, /did not finish hang within 1500 ms/);
});

test("late steps of a timed-out request don't answer twice or release the next request", () => {
  const { context, responses, advance } = loadController();
  context.dispatch = request => {
    if (request.method === "slow") context.later(2000, () => context.finish(request, true, { late: true }));
    if (request.method === "second") context.later(1000, () => context.finish(request, true, {}));
  };
  context.enqueue(5000, "1", "slow", {}, 500);
  context.enqueue(5000, "2", "second", {}, 5000);
  advance(2100);
  assert.deepEqual(responses.map(r => [r.id, r.ok]), [["1", false]]);
  assert.equal(context.currentRequest.id, "2", "second request is still running");
  advance(500);
  assert.deepEqual(responses.map(r => [r.id, r.ok]), [["1", false], ["2", true]]);
});

test("requests the client already gave up on are skipped", () => {
  const { context, responses, advance } = loadController();
  const dispatched = [];
  context.dispatch = request => dispatched.push(request.method);
  context.enqueue(5000, "1", "hang", {}, 500);
  context.enqueue(5000, "2", "abandoned", {}, 1000);
  advance(1600);
  assert.deepEqual(dispatched, ["hang"]);
  assert.deepEqual(responses.map(r => r.id), ["1"]);
});

function fakeTransport(applies) {
  let tempo = 120;
  const value = v => ({ get: () => v });
  return {
    isPlaying: () => value(false),
    isArrangerRecordEnabled: () => value(false),
    getPosition: () => value(0),
    tempo: () => ({
      value: () => ({
        setRaw: next => { if (applies) tempo = next; },
        getRaw: () => tempo,
        displayedValue: () => value(`${tempo} BPM`)
      })
    })
  };
}

test("set_tempo reports success only after Bitwig reads the new tempo back", () => {
  const { context, responses, advance, originalDispatch } = loadController();
  context.dispatch = originalDispatch;
  context.transport = fakeTransport(true);
  context.enqueue(5000, "1", "transport", { action: "set_tempo", tempo: 128 }, 5000);
  advance(200);
  assert.equal(responses[0].ok, true);
  assert.equal(responses[0].payload.tempo, 128);
});

test("set_tempo fails when Bitwig keeps the old tempo", () => {
  const { context, responses, advance, originalDispatch } = loadController();
  context.dispatch = originalDispatch;
  context.transport = fakeTransport(false);
  context.enqueue(5000, "1", "transport", { action: "set_tempo", tempo: 128 }, 5000);
  advance(1200);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /tempo is 120 BPM, requested 128 BPM/);
});

function fakeTrack(applies) {
  const state = { volume: 0.5, pan: 0.5, mute: false, solo: false, arm: false };
  const param = key => ({
    get: () => state[key],
    set: v => { if (applies) state[key] = v; },
    setImmediately: v => { if (applies) state[key] = v; },
    displayedValue: () => ({ get: () => String(state[key]) })
  });
  return {
    volume: () => param("volume"), pan: () => param("pan"),
    mute: () => param("mute"), solo: () => param("solo"), arm: () => param("arm"),
    name: () => ({ get: () => "Inst 1" }), position: () => ({ get: () => 0 }),
    trackType: () => ({ get: () => "Instrument" })
  };
}

test("set_track_mix succeeds only after Bitwig reads every requested value back", () => {
  const { context, responses, advance, originalDispatch } = loadController();
  context.dispatch = originalDispatch;
  const track = fakeTrack(true);
  context.requireTrack = () => track;
  context.enqueue(5000, "1", "set_track_mix", { trackIndex: 0, trackName: "Inst 1", volumeNormalized: 0.7, mute: true }, 5000);
  advance(200);
  assert.equal(responses[0].ok, true);
  assert.equal(responses[0].payload.track.mute, true);
});

test("set_track_mix fails with the values Bitwig actually holds", () => {
  const { context, responses, advance, originalDispatch } = loadController();
  context.dispatch = originalDispatch;
  context.requireTrack = () => fakeTrack(false);
  context.enqueue(5000, "1", "set_track_mix", { trackIndex: 0, trackName: "Inst 1", volumeNormalized: 0.7, mute: true }, 5000);
  advance(1200);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /volume is 0.5, requested 0.7; mute is false, requested true/);
});

// Fake launcher cursor clip. Notes live at absolute beats; the visible grid is
// CLIP_GRID_WIDTH steps from the scroll position, and every scroll or step-size
// change reports changed cells through the controller's note-step observer,
// the way Bitwig does. Notes off the grid show up at the step they start in.
function fakeLauncherClip(context, { notes = [], loopStart = 0, loopLength = 4, onWrite } = {}) {
  const width = context.CLIP_GRID_WIDTH;
  const state = { notes: notes.map(n => ({ channel: 0, muted: false, ...n })), stepSize: 0.25, scroll: 0, visible: new Set(), exists: true };
  const stepOf = note => Math.floor(note.beat / state.stepSize + 1e-9);
  const noteAt = (channel, x, y) => state.notes.find(n => n.channel === channel && n.pitch === y && stepOf(n) === state.scroll + x);
  const step = (channel, x, y) => {
    const note = noteAt(channel, x, y);
    return {
      channel: () => channel, x: () => x, y: () => y,
      state: () => (note ? "NoteOn" : "Empty"),
      velocity: () => (note ? note.velocity / 127 : 0),
      duration: () => (note ? note.duration : 0),
      isMuted: () => (note ? note.muted : false)
    };
  };
  function refresh() {
    const next = new Set();
    for (const note of state.notes) {
      const x = stepOf(note) - state.scroll;
      if (x >= 0 && x < width) next.add(`${note.channel}:${x}:${note.pitch}`);
    }
    for (const key of state.visible) if (!next.has(key)) context.onLauncherNoteStep(step(...key.split(":").map(Number)));
    for (const key of next) context.onLauncherNoteStep(step(...key.split(":").map(Number)));
    state.visible = next;
  }
  const value = (get, set) => ({ get, set: set || (() => {}) });
  const clip = {
    state,
    exists: () => value(() => state.exists),
    getLoopStart: () => value(() => loopStart, v => { loopStart = v; }),
    getLoopLength: () => value(() => loopLength, v => { loopLength = v; }),
    getPlayStart: () => value(() => 0),
    getPlayStop: () => value(() => loopLength),
    isLoopEnabled: () => value(() => true),
    setName() {},
    setStepSize(size) { state.stepSize = size; refresh(); },
    scrollToKey() {},
    scrollToStep(position) { state.scroll = position; refresh(); },
    getStep: step,
    setStep(channel, x, pitch, velocity, duration) {
      let note = { beat: (state.scroll + x) * state.stepSize, pitch, velocity, duration, channel, muted: false };
      if (onWrite) note = onWrite(note);
      if (note) state.notes.push(note);
      refresh();
    }
  };
  return clip;
}

function fakeSlot({ hasContent = true } = {}) {
  const slot = {
    content: hasContent,
    exists: () => ({ get: () => true }),
    name: () => ({ get: () => "Clip" }),
    hasContent: () => ({ get: () => slot.content }),
    isSelected: () => ({ get: () => true }),
    isPlaying: () => ({ get: () => false }),
    select() {}, showInEditor() {}, deleteObject() { slot.content = false; },
    createEmptyClip() { slot.content = true; }
  };
  return slot;
}

function withClip(options = {}) {
  const loaded = loadController();
  const { context } = loaded;
  context.dispatch = loaded.originalDispatch;
  const clip = fakeLauncherClip(context, options);
  const slot = fakeSlot(options.slot);
  const track = { clipLauncherSlotBank: () => ({ getItemAt: () => slot }) };
  context.launcherClip = clip;
  context.selectTrack = (request, params, callback) => {
    try { callback(track); } catch (error) { context.finish(request, false, { message: String(error.message || error) }); }
  };
  return { ...loaded, clip, slot, track };
}

const TRACK = { trackIndex: 0, trackName: "Inst 1" };

test("clip_notes reads every note from the step grid across pages and channels", () => {
  const notes = [
    { beat: 0, pitch: 60, velocity: 100, duration: 0.5 },
    { beat: 0, pitch: 64, velocity: 90, duration: 0.25, channel: 3 },
    { beat: 70.5, pitch: 67, velocity: 1, duration: 1, muted: true },
    { beat: 127.75, pitch: 127, velocity: 127, duration: 0.25 }
  ];
  const { context, responses, advance } = withClip({ notes, loopLength: 128 });
  context.enqueue(5000, "1", "clip_notes", { ...TRACK, slotIndex: 0 }, 60000);
  advance(5000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  const payload = responses[0].payload;
  assert.equal(payload.quantized, true);
  assert.equal(payload.lengthBeats, 128);
  assert.equal(payload.noteCount, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.notes)), [
    { beat: 0, pitch: 60, velocity: 100, duration: 0.5, channel: 0, muted: false },
    { beat: 0, pitch: 64, velocity: 90, duration: 0.25, channel: 3, muted: false },
    { beat: 70.5, pitch: 67, velocity: 1, duration: 1, channel: 0, muted: true },
    { beat: 127.75, pitch: 127, velocity: 127, duration: 0.25, channel: 0, muted: false }
  ]);
});

test("clip_notes snaps notes that start between steps to the step they start in", () => {
  const { context, responses, advance } = withClip({ notes: [{ beat: 1.1, pitch: 60, velocity: 100, duration: 0.25 }] });
  context.enqueue(5000, "1", "clip_notes", { ...TRACK, slotIndex: 0, stepSize: 0.25 }, 60000);
  advance(2000);
  assert.equal(responses[0].payload.notes[0].beat, 1);
  assert.equal(responses[0].payload.quantized, true);
});

test("clip_notes ignores notes past the end of the clip", () => {
  const { context, responses, advance } = withClip({ notes: [{ beat: 2, pitch: 60, velocity: 100, duration: 1 }, { beat: 6, pitch: 61, velocity: 100, duration: 1 }], loopLength: 4 });
  context.enqueue(5000, "1", "clip_notes", { ...TRACK, slotIndex: 0 }, 60000);
  advance(2000);
  assert.deepEqual([...responses[0].payload.notes.map(n => n.pitch)], [60]);
});

test("clip_notes fails on an empty slot", () => {
  const { context, responses, advance } = withClip({ slot: { hasContent: false } });
  context.enqueue(5000, "1", "clip_notes", { ...TRACK, slotIndex: 2 }, 60000);
  advance(2000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /Clip slot 2 has no clip/);
});

test("clip_notes fails when Bitwig does not expose the clip", () => {
  const { context, responses, advance, clip } = withClip();
  clip.state.exists = false;
  context.enqueue(5000, "1", "clip_notes", { ...TRACK, slotIndex: 0 }, 60000);
  advance(2000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /did not expose the launcher clip/);
});

test("clip_notes skips observer cells that getStep no longer confirms", () => {
  const { context, responses, advance } = withClip({ notes: [{ beat: 0, pitch: 60, velocity: 100, duration: 1 }] });
  context.launcherNoteCells["0:5:70"] = true;
  context.enqueue(5000, "1", "clip_notes", { ...TRACK, slotIndex: 0 }, 60000);
  advance(2000);
  assert.deepEqual([...responses[0].payload.notes.map(n => n.pitch)], [60]);
});

test("the launcher template reader keeps every channel and a minimum one-step duration", () => {
  const { context, track, advance } = withClip({ notes: [
    { beat: 0, pitch: 60, velocity: 100, duration: 0.1 },
    { beat: 1, pitch: 62, velocity: 80, duration: 1, channel: 9 }
  ] });
  let result;
  context.readLauncherTemplate(track, 0, (error, template) => { result = { error, template }; });
  advance(2000);
  assert.equal(result.error, null);
  assert.deepEqual(JSON.parse(JSON.stringify(result.template)), {
    lengthBeats: 4, stepSize: 0.25,
    notes: [
      { beat: 0, pitch: 60, velocity: 100, duration: 0.25, channel: 0 },
      { beat: 1, pitch: 62, velocity: 80, duration: 1, channel: 9 }
    ]
  });
});

test("the launcher template reader refuses a clip with no notes", () => {
  const { context, track, advance } = withClip({ notes: [] });
  let result;
  context.readLauncherTemplate(track, 0, error => { result = error; });
  advance(2000);
  assert.match(String(result && result.message), /contains no readable MIDI notes/);
});

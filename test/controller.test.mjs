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

const WRITE = {
  ...TRACK, slotIndex: 0, clipName: "Riff", lengthBeats: 128, stepSize: 0.25,
  notes: [
    { beat: 0, pitch: 60, velocity: 100, duration: 0.5 },
    { beat: 0.5, pitch: 64, velocity: 90, duration: 0.25, channel: 2 },
    { beat: 96, pitch: 67, velocity: 110, duration: 1 }
  ]
};

function createWith(onWrite, params = WRITE) {
  const run = withClip({ notes: [], loopLength: 0, slot: { hasContent: false }, onWrite });
  run.context.enqueue(5000, "1", "create_note_clip", params, 60000);
  run.advance(10000);
  return run.responses[0];
}

test("create_note_clip succeeds only after every written note reads back", () => {
  const response = createWith();
  assert.equal(response.ok, true, JSON.stringify(response.payload));
  assert.equal(response.payload.notesWritten, 3);
  assert.equal(response.payload.notesVerified, 3);
});

const mismatches = [
  ["a dropped note", note => (note.pitch === 67 ? null : note), /pitch 67 at beat 96 \(channel 0\) is missing/],
  ["a wrong velocity", note => ({ ...note, velocity: note.pitch === 60 ? 99 : note.velocity }), /pitch 60 at beat 0 \(channel 0\): velocity is 99, requested 100/],
  ["a wrong duration", note => ({ ...note, duration: note.pitch === 64 ? 0.5 : note.duration }), /pitch 64 at beat 0.5 \(channel 2\): duration is 0.5, requested 0.25/],
  ["a shifted pitch", note => ({ ...note, pitch: note.pitch === 60 ? 61 : note.pitch }), /pitch 60 at beat 0 \(channel 0\) is missing.*unexpected pitch 61 at beat 0 \(channel 0\)/],
  ["a shifted start", note => ({ ...note, beat: note.pitch === 67 ? 96.25 : note.beat }), /pitch 67 at beat 96 \(channel 0\) is missing.*unexpected pitch 67 at beat 96.25/],
  ["a wrong channel", note => ({ ...note, channel: note.pitch === 64 ? 0 : note.channel }), /pitch 64 at beat 0.5 \(channel 2\) is missing.*unexpected pitch 64 at beat 0.5 \(channel 0\)/],
  ["a muted note", note => ({ ...note, muted: note.pitch === 60 }), /pitch 60 at beat 0 \(channel 0\): note is muted/]
];

for (const [name, onWrite, message] of mismatches) {
  test(`create_note_clip fails loudly on ${name}`, () => {
    const response = createWith(onWrite);
    assert.equal(response.ok, false, `expected a failure for ${name}`);
    assert.match(response.payload.message, /^Note verification failed: clip slot 0 does not match the 3 requested notes after writing\./);
    assert.match(response.payload.message, message);
  });
}

test("create_note_clip fails when Bitwig keeps only one of two notes on the same cell", () => {
  const params = { ...WRITE, notes: [WRITE.notes[0], { ...WRITE.notes[0] }] };
  const run = withClip({ notes: [], loopLength: 0, slot: { hasContent: false } });
  const { clip } = run;
  const setStep = clip.setStep;
  clip.setStep = (channel, x, pitch, velocity, duration) => {
    clip.state.notes = clip.state.notes.filter(n => !(n.channel === channel && n.pitch === pitch && Math.round(n.beat / clip.state.stepSize) === clip.state.scroll + x));
    setStep(channel, x, pitch, velocity, duration);
  };
  run.context.enqueue(5000, "1", "create_note_clip", params, 60000);
  run.advance(10000);
  assert.equal(run.responses[0].ok, false);
  assert.match(run.responses[0].payload.message, /pitch 60 at beat 0 \(channel 0\) is missing/);
});

test("create_note_clip lists at most five differences and counts the rest", () => {
  const notes = Array.from({ length: 8 }, (_, i) => ({ beat: i, pitch: 60 + i, velocity: 100, duration: 0.25 }));
  const response = createWith(() => null, { ...WRITE, notes });
  assert.equal(response.ok, false);
  assert.match(response.payload.message, /does not match the 8 requested notes/);
  assert.match(response.payload.message, /; and 3 more\.$/);
});

test("requests with the wrong token get no reply and are counted", () => {
  const { context } = loadController();
  const popups = [];
  const errors = [];
  context.host.showPopupNotification = message => popups.push(message);
  context.host.errorln = message => errors.push(message);
  assert.equal(context.isAuthorized({ token: "wrong" }), false);
  assert.equal(context.isAuthorized(null), false);
  assert.equal(context.isAuthorized({ token: context.CONTROL_DECK_TOKEN }), true);
  for (let i = 0; i < 100; i += 1) context.noteAuthFailure();
  assert.equal(popups.length, 1);
  assert.equal(errors.length, 2);
  assert.match(errors[1], /ignored 100 request/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { loadController, value } from "./support/load-controller.mjs";

// A transport whose position moves with the fake clock while it plays.
function fakeTransport(context, state) {
  let playStartedAt = null;
  let playStartedFrom = 0;
  const position = () => playStartedAt === null
    ? state.position
    : playStartedFrom + (context.Date.now() - playStartedAt) / 60000 * state.tempo;
  const flag = name => value(() => state[name], next => { state.log.push(name + "=" + next); state[name] = next; });
  return {
    tempo: () => ({ value: () => ({ getRaw: () => state.tempo, setRaw: next => { state.log.push("tempo=" + next); state.tempo = next; } }) }),
    getPosition: () => value(position),
    setPosition: beats => { state.log.push("position=" + beats); state.position = beats; },
    isArrangerLoopEnabled: () => flag("loop"),
    isArrangerOverdubEnabled: () => flag("arrangerOverdub"),
    isClipLauncherOverdubEnabled: () => flag("launcherOverdub"),
    isArrangerRecordEnabled: () => flag("record"),
    isPlaying: () => value(() => playStartedAt !== null),
    play: () => {
      state.log.push("play");
      if (state.refusePlay) return;
      playStartedAt = context.Date.now();
      playStartedFrom = state.position;
    },
    stop: () => {
      if (playStartedAt !== null) state.position = position();
      playStartedAt = null;
      state.log.push("stop");
    }
  };
}

function fakeTrack(name, state, armed) {
  const track = {
    name,
    armed,
    launches: [],
    exists: () => value(() => true),
    arm: () => value(() => track.armed, next => { state.log.push(name + ".arm=" + next); track.armed = next; }),
    stop: () => {},
    returnToArrangement: () => { state.log.push(name + ".returnToArrangement"); },
    clipLauncherSlotBank: () => ({
      getItemAt: slotIndex => ({
        hasContent: () => value(() => true),
        launchWithOptions: (quantization, mode) => {
          state.log.push(name + ".launch(" + quantization + ")");
          track.launches.push({ slotIndex, quantization, mode, armedTracks: state.tracks.filter(t => t.armed).length });
        }
      })
    })
  };
  return track;
}

function setup(options = {}) {
  const loaded = loadController();
  const { context } = loaded;
  context.dispatch = loaded.originalDispatch;
  const state = {
    tempo: 120, position: 3, loop: true, arrangerOverdub: true, launcherOverdub: true, record: false,
    refusePlay: Boolean(options.refusePlay), log: [], jumps: 0
  };
  state.tracks = [fakeTrack("Bass", state, true), fakeTrack("Keys", state, false), fakeTrack("Vox", state, true)];
  context.transport = fakeTransport(context, state);
  context.trackBank = { itemCount: () => value(() => state.tracks.length), getItemAt: index => state.tracks[index] };
  context.requireTrack = params => state.tracks[params.trackIndex];
  context.jumpToBeginningAction = { invoke: () => { state.jumps++; state.position = 0; } };
  context.project = { isModified: () => value(() => true) };
  return { ...loaded, state };
}

const region = (trackIndex, startBeats, lengthBeats) => ({
  trackIndex, trackName: ["Bass", "Keys", "Vox"][trackIndex], slotIndex: 0, startBeats, lengthBeats, clipName: "Print"
});

function expectRestored(state) {
  assert.equal(state.tempo, 120);
  assert.equal(state.position, 3);
  assert.equal(state.loop, true);
  assert.equal(state.arrangerOverdub, true);
  assert.equal(state.launcherOverdub, true);
  assert.equal(state.record, false);
  assert.deepEqual(state.tracks.map(t => t.armed), [true, false, true]);
}

test("the print disarms tracks and turns off overdub while recording, then puts both back", () => {
  const { context, responses, advance, state } = setup();
  context.enqueue(5000, "1", "arrange_launcher_clips", { regions: [region(1, 0, 8)] }, 120000);
  advance(30000);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  const recordOn = state.log.indexOf("record=true");
  assert.ok(recordOn > 0);
  const before = state.log.slice(0, recordOn);
  assert.ok(before.includes("Bass.arm=false") && before.includes("Vox.arm=false"));
  assert.ok(before.includes("arrangerOverdub=false") && before.includes("launcherOverdub=false"));
  assert.equal(state.tracks[1].launches[0].armedTracks, 0);
  assert.equal(responses[0].payload.restoredArmedTracks, 2);
  expectRestored(state);
});

test("the print starts at the earliest region instead of beat 0", () => {
  const { context, responses, advance, state } = setup();
  context.enqueue(5000, "1", "arrange_launcher_clips", { regions: [region(1, 64, 4), region(0, 66, 4)] }, 120000);
  advance(30000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.equal(responses[0].payload.startBeats, 64);
  assert.equal(state.jumps, 0);
  assert.ok(!state.log.includes("position=0"));
  assert.deepEqual(state.tracks[1].launches.map(l => l.quantization), ["none"]);
  assert.deepEqual(state.tracks[0].launches.map(l => l.quantization), ["1"]);
  assert.ok(state.log.indexOf("Keys.launch(none)") < state.log.indexOf("play"));
  expectRestored(state);
});

test("the print refuses a span too long to finish before its time limit", () => {
  const { context, responses, advance, state } = setup();
  context.enqueue(5000, "1", "arrange_launcher_clips", { regions: [region(1, 0, 4), region(0, 2000, 4)] }, 120000);
  advance(1000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /at most 1024 beats/);
  assert.deepEqual(state.log, []);
});

test("a print that cannot start puts tempo, overdub and arms back", () => {
  const { context, responses, advance, state } = setup({ refusePlay: true });
  context.enqueue(5000, "1", "arrange_launcher_clips", { regions: [region(1, 0, 8)] }, 120000);
  advance(30000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /did not start/);
  assert.ok(state.log.includes("Keys.returnToArrangement"));
  expectRestored(state);
});

test("a print the watchdog gives up on is still put back and launches nothing more", () => {
  const { context, responses, advance, state } = setup();
  // A 10-second client timeout gives the watchdog an 11-second limit, far
  // shorter than this 512-beat print at 666 BPM.
  context.enqueue(5000, "1", "arrange_launcher_clips", { regions: [region(1, 0, 4), region(0, 500, 12)] }, 10000);
  advance(12000);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].ok, false);
  expectRestored(state);
  const launches = state.tracks[0].launches.length;
  advance(120000);
  assert.equal(state.tracks[0].launches.length, launches);
  assert.equal(launches, 0);
  expectRestored(state);
});

test("stopping the transport mid-print fails at once and puts everything back", () => {
  const { context, responses, advance, state } = setup();
  context.enqueue(5000, "1", "arrange_launcher_clips", { regions: [region(1, 0, 400)] }, 120000);
  advance(5000);
  context.transport.stop();
  advance(100);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /transport stopped at beat/);
  expectRestored(state);
});

test("a cleanup that throws is logged and the reply still goes out", () => {
  const { context, host, responses } = setup();
  const errors = [];
  host.errorln = message => errors.push(message);
  const request = { id: "9", source: 1, method: "x", params: {}, cleanup: () => { throw new Error("boom"); } };
  context.finish(request, true, { fine: true });
  assert.equal(responses.length, 1);
  assert.equal(responses[0].ok, true);
  assert.match(errors[0], /cleanup error: Error: boom/);
});

test("the unused copy-and-paste arrangement code is gone", () => {
  const { context } = setup();
  assert.equal(context.handleArrangeLauncherClips, undefined);
  assert.equal(context.readLauncherTemplate, undefined);
});

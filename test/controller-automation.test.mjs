import test from "node:test";
import assert from "node:assert/strict";
import { loadController, value } from "./support/load-controller.mjs";

function valueAt(lane, beat) {
  let chosen = lane[0] ? lane[0].v : 0;
  for (const point of lane) {
    if (point.beat <= beat + 0.0001) chosen = point.v;
  }
  return chosen;
}

function setup() {
  const loaded = loadController();
  const { context } = loaded;
  context.dispatch = loaded.originalDispatch;
  const state = {
    tempo: 100, position: 4, loop: true, arrangerOverdub: false, launcherOverdub: false,
    record: false, write: false, writeMode: "touch", playing: false, playFrom: 0, playAt: 0,
    log: []
  };
  const positionNow = () => state.playing
    ? state.playFrom + (context.Date.now() - state.playAt) / 60000 * state.tempo
    : state.position;
  const flag = (key) => value(() => state[key], next => { state[key] = next; });
  context.transport = {
    tempo: () => ({ value: () => ({ getRaw: () => state.tempo, setRaw: next => { state.tempo = next; } }) }),
    getPosition: () => value(positionNow),
    setPosition: beats => {
      state.position = beats;
      state.playFrom = beats;
      state.playAt = context.Date.now();
    },
    isArrangerLoopEnabled: () => flag("loop"),
    isArrangerOverdubEnabled: () => flag("arrangerOverdub"),
    isClipLauncherOverdubEnabled: () => flag("launcherOverdub"),
    isArrangerRecordEnabled: () => flag("record"),
    isArrangerAutomationWriteEnabled: () => flag("write"),
    automationWriteMode: () => value(() => state.writeMode, next => { state.writeMode = next; }),
    isPlaying: () => value(() => state.playing),
    play: () => {
      state.playFrom = positionNow();
      state.playAt = context.Date.now();
      state.playing = true;
    },
    stop: () => {
      if (state.playing) state.position = positionNow();
      state.playing = false;
    }
  };
  const parameter = {
    touched: false,
    lane: [],
    live: 0.25,
    set(v) {
      parameter.live = v;
      if (state.write && parameter.touched) parameter.lane.push({ beat: positionNow(), v });
    },
    get() {
      if (!state.write && parameter.lane.length) return valueAt(parameter.lane, positionNow());
      return parameter.live;
    },
    touch(on) { parameter.touched = Boolean(on); },
    restoreAutomationControl() {}
  };
  const track = { volume: () => parameter, pan: () => parameter, arm: () => value(() => false) };
  context.requireTrack = () => track;
  state.tracks = [{ name: "Pad", armed: true }, { name: "Riser", armed: false }];
  state.scroll = 0;
  context.trackBank = {
    itemCount: () => value(() => state.tracks.length),
    scrollPosition: () => value(() => state.scroll, next => { state.scroll = next; }),
    getItemAt: index => {
      const current = () => state.tracks[state.scroll + index];
      return {
        exists: () => value(() => Boolean(current())),
        name: () => value(() => (current() ? current().name : "")),
        arm: () => value(() => Boolean(current() && current().armed), next => {
          const item = current();
          if (item) item.armed = next;
        })
      };
    }
  };
  return { ...loaded, state, parameter };
}

test("a linear volume ramp is played into the lane and the project is put back", () => {
  const { context, responses, advance, state, parameter } = setup();
  context.enqueue(5000, "1", "write_automation", {
    target: "volume", trackIndex: 0, trackName: "Pad",
    startBeats: 8, endBeats: 16, from: 0.2, to: 0.8, shape: "linear"
  }, 60000);
  advance(30000);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.equal(responses[0].payload.verified, true);
  assert.ok(parameter.lane.length > 4);
  assert.ok(Math.abs(parameter.lane[0].v - 0.2) < 0.02);
  assert.ok(Math.abs(parameter.lane[parameter.lane.length - 1].v - 0.8) < 0.02);
  assert.equal(state.tempo, 100);
  assert.equal(state.position, 4);
  assert.equal(state.write, false);
  assert.equal(state.writeMode, "touch");
  assert.equal(state.playing, false);
  assert.equal(state.record, false);
  assert.deepEqual(state.tracks.map(track => track.armed), [true, false]);
});

test("a curved ramp stays nearer the start value at the midpoint", () => {
  const { context } = setup();
  assert.equal(context.automationRampValue(0, 1, 0, 2), 0);
  assert.equal(context.automationRampValue(0, 1, 1, 2), 1);
  assert.equal(context.automationRampValue(0, 1, 0.5, 1), 0.5);
  assert.ok(context.automationRampValue(0, 1, 0.5, 2) < 0.5);
  assert.ok(context.automationRampValue(0, 1, 0.5, 0.5) > 0.5);
});

test("a direct parameter that does not follow the playhead is not reported as automated", () => {
  const { context, responses, advance, state } = setup();
  const device = {
    name: "Filter",
    setDirectParameterValueNormalized(id, scaled) {
      context.directValues[id] = scaled / 127;
    }
  };
  context.directIds = ["cutoff"];
  context.directNames = { cutoff: "Cutoff" };
  context.directValues = { cutoff: 0.3 };
  context.selectDevice = (request, params, callback) => callback(device);
  context.enqueue(5000, "1", "write_automation", {
    target: "parameter", trackIndex: 0, trackName: "Pad", deviceIndex: 0, deviceName: "Filter",
    parameterId: "cutoff", startBeats: 0, endBeats: 4, from: 0.1, to: 0.9
  }, 60000);
  advance(30000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /Remote Control/);
  assert.equal(state.playing, false);
  assert.equal(state.tempo, 100);
  assert.ok(Math.abs(context.directValues.cutoff - 0.3) < 0.02);
});

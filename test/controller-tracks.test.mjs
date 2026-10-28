import test from "node:test";
import assert from "node:assert/strict";
import { loadController, value } from "./support/load-controller.mjs";

// Track and device lists that change a tick after a create or delete, like
// Bitwig's banks do. `items` holds names; a group is a name with `children`.
function fakeBank(context, names, onDelete) {
  const items = names.map(name => ({ name }));
  const bank = {
    items,
    itemCount: () => value(() => items.length),
    getItemAt: index => {
      const item = () => items[index];
      return {
        exists: () => value(() => Boolean(item())),
        name: () => value(() => (item() ? item().name : "")),
        setName: next => { const target = item(); context.host.scheduleTask(() => { target.name = next; }, 20); },
        selectInMixer: () => {},
        deleteObject: () => {
          const target = item();
          context.host.scheduleTask(() => {
            const at = items.indexOf(target);
            items.splice(at, onDelete ? onDelete(target) : 1);
          }, 30);
        }
      };
    }
  };
  return bank;
}

function setup({ tracks = ["Drums", "Bass"], effects = ["Reverb"], devices = ["EQ+", "Compressor", "Delay+"], groupSize } = {}) {
  const loaded = loadController();
  const { context } = loaded;
  context.dispatch = loaded.originalDispatch;
  context.trackBank = fakeBank(context, tracks, groupSize ? target => (target.name === "Group" ? groupSize : 1) : null);
  context.effectTrackBank = fakeBank(context, effects);
  context.deviceBank = fakeBank(context, devices);
  context.trackSnapshot = (track, index) => ({ index, name: track.name().get() });
  context.deviceSnapshot = (device, index) => ({ index, name: device.name().get() });
  context.selectTrack = (request, params, callback) => callback();
  const created = [];
  const add = (bank, name, position) => context.host.scheduleTask(() => {
    bank.items.splice(position < 0 ? bank.items.length : position, 0, { name });
  }, 40);
  context.application = {
    createInstrumentTrack: position => { created.push("instrument"); add(context.trackBank, context.nextDefaultName || "Inst", position); },
    createAudioTrack: position => { created.push("audio"); add(context.trackBank, context.nextDefaultName || "Audio", position); },
    createEffectTrack: position => { created.push("effect"); add(context.effectTrackBank, context.nextDefaultName || "FX", position); }
  };
  return { ...loaded, created };
}

const names = bank => bank.items.map(item => item.name);

test("create_track names the track Bitwig actually added", () => {
  const { context, responses, advance } = setup();
  context.enqueue(5000, "1", "create_track", { kind: "instrument", name: "Lead" }, 5000);
  advance(3000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.equal(responses[0].payload.created.index, 2);
  assert.deepEqual(names(context.trackBank), ["Drums", "Bass", "Lead"]);
});

test("create_track finds the new track when Bitwig inserts it mid-list", () => {
  const { context, responses, advance } = setup();
  context.application.createAudioTrack = () => context.host.scheduleTask(() => context.trackBank.items.splice(1, 0, { name: "Audio" }), 40);
  context.enqueue(5000, "1", "create_track", { kind: "audio", name: "Vox" }, 5000);
  advance(3000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.equal(responses[0].payload.created.index, 1);
  assert.deepEqual(names(context.trackBank), ["Drums", "Vox", "Bass"]);
});

test("create_track names new effect tracks in the effect track list", () => {
  const { context, responses, advance } = setup();
  context.enqueue(5000, "1", "create_track", { kind: "effect", name: "Delay Bus" }, 5000);
  advance(3000);
  assert.equal(responses[0].ok, true, JSON.stringify(responses[0].payload));
  assert.equal(responses[0].payload.created.effectTrackIndex, 1);
  assert.deepEqual(names(context.effectTrackBank), ["Reverb", "Delay Bus"]);
  assert.deepEqual(names(context.trackBank), ["Drums", "Bass"]);
});

test("create_track refuses at 128 main tracks before creating anything", () => {
  const tracks = Array.from({ length: 128 }, (_, i) => "T" + i);
  const { context, responses, advance, created } = setup({ tracks });
  context.enqueue(5000, "1", "create_track", { kind: "instrument", name: "Lead" }, 5000);
  advance(3000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /already has 128 main tracks.*No track was created/);
  assert.deepEqual(created, []);
});

test("create_track leaves an indistinguishable new track unnamed", () => {
  const { context, responses, advance } = setup({ tracks: ["Inst", "Inst"] });
  context.enqueue(5000, "1", "create_track", { kind: "instrument", name: "Lead" }, 5000);
  advance(5000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /cannot tell which one is new/);
  assert.deepEqual(names(context.trackBank), ["Inst", "Inst", "Inst"]);
});

test("create_track fails when no new track shows up", () => {
  const { context, responses, advance } = setup();
  context.application.createInstrumentTrack = () => {};
  context.enqueue(5000, "1", "create_track", { kind: "instrument", name: "Lead" }, 5000);
  advance(5000);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].payload.message, /did not show exactly one new track/);
});

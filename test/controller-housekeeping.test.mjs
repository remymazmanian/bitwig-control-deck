import test from "node:test";
import assert from "node:assert/strict";
import { loadController, value } from "./support/load-controller.mjs";

function setup() {
  const loaded = loadController();
  const { context } = loaded;
  context.dispatch = loaded.originalDispatch;
  const actions = [
    { id: "add_to_library", name: "Save to Library", menu: "Save to Library…" },
    { id: "focus_arranger", name: "Focus Arranger", menu: "Arranger" },
    { id: "toggle_metronome", name: "Toggle Metronome", menu: "Metronome" }
  ].map(a => ({ getId: () => a.id, getName: () => a.name, getMenuItemText: () => a.menu }));
  context.application = {
    getActions: () => actions,
    projectName: () => value(() => "Song"),
    hasActiveEngine: () => value(() => true)
  };
  context.project = { isModified: () => value(() => false) };
  context.readTransport = () => ({});
  context.cursorTrack = { exists: () => value(() => false) };
  context.cursorDevice = { exists: () => value(() => false) };
  return loaded;
}

test("bitwig_actions searches case-insensitively and reports totals", () => {
  const { context, responses, advance } = setup();
  context.enqueue(5000, "1", "find_actions", { query: "  ARRANGER " }, 5000);
  advance(100);
  assert.equal(responses[0].ok, true);
  const payload = JSON.parse(JSON.stringify(responses[0].payload));
  assert.equal(payload.totalActions, 3);
  assert.equal(payload.matched, 1);
  assert.deepEqual(payload.actions.map(a => a.id), ["focus_arranger"]);
});

test("bitwig_actions returns at most 100 actions", () => {
  const { context, responses, advance } = setup();
  const many = Array.from({ length: 250 }, (_, i) => ({ getId: () => "a" + i, getName: () => "A", getMenuItemText: () => "" }));
  context.application.getActions = () => many;
  context.enqueue(5000, "1", "find_actions", {}, 5000);
  advance(100);
  assert.equal(responses[0].payload.matched, 250);
  assert.equal(responses[0].payload.actions.length, 100);
});

test("status reports whether the audio engine is on", () => {
  const { context, responses, advance } = setup();
  context.enqueue(5000, "1", "status", {}, 5000);
  advance(100);
  assert.equal(responses[0].payload.audioEngineActive, true);
});

for (const method of ["audio_engine", "restart_bridge", "selection_state", "list_actions"]) {
  test(`${method} is no longer a bridge method`, () => {
    const { context, responses, advance } = setup();
    context.enqueue(5000, "1", method, { action: "deactivate" }, 5000);
    advance(100);
    assert.equal(responses[0].ok, false);
    assert.match(responses[0].payload.message, /Unknown Control Deck method/);
  });
}

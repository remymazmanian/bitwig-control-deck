import assert from "node:assert/strict";
import test from "node:test";
import { loadController } from "./support/load-controller.mjs";

test("steps of a timed-out request stop running", () => {
  const { context, responses, advance } = loadController();
  let ticks = 0;
  context.dispatch = request => {
    if (request.method !== "loop") return;
    (function tick() { ticks++; context.later(100, tick); })();
  };
  context.enqueue(5000, "1", "loop", {}, 500);
  advance(1500);
  assert.deepEqual(responses.map(r => [r.id, r.ok]), [["1", false]]);
  const afterTimeout = ticks;
  advance(2000);
  assert.equal(ticks, afterTimeout, "no step runs after the watchdog failed the request");
});

test("a late step of a timed-out request can't fail the next request", () => {
  const { context, responses, advance } = loadController();
  context.dispatch = request => {
    if (request.method === "stale") {
      context.later(2000, () => context.later(10, () => { throw new Error("stale step"); }));
    }
    if (request.method === "next") context.later(1000, () => context.finish(request, true, { fine: true }));
  };
  context.enqueue(5000, "1", "stale", {}, 500);
  context.enqueue(5000, "2", "next", {}, 5000);
  advance(4000);
  assert.deepEqual(responses.map(r => [r.id, r.ok]), [["1", false], ["2", true]]);
});

test("steps scheduled outside any request still run", () => {
  const { context, advance } = loadController();
  let ran = false;
  context.later(10, () => { ran = true; });
  advance(20);
  assert.equal(ran, true);
});

test("restart_bridge still restarts after answering", () => {
  const { context, host, responses, advance } = loadController();
  let restarted = false;
  host.restart = () => { restarted = true; };
  context.enqueue(5000, "1", "restart_bridge", {}, 5000);
  advance(500);
  assert.equal(responses[0].ok, true);
  assert.equal(restarted, true);
});

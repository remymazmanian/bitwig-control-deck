import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../../controller/ControlDeck.control.js", import.meta.url), "utf8");

// Loads the controller script against a fake Bitwig host with a manual clock,
// so request handling can be tested without Bitwig running. Tests replace the
// Bitwig objects they need (transport, trackBank, ...) on `context`.
export function loadController() {
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
  const realRespond = context.respond;
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

  return { context, host, responses, advance, realRespond, originalDispatch: context.dispatch };
}

export function value(get, set) {
  return { get, set: set || (() => {}), markInterested() {} };
}

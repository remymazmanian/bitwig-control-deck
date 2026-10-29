import assert from "node:assert/strict";
import test from "node:test";
import { loadController } from "./support/load-controller.mjs";

function capture() {
  const loaded = loadController();
  const sent = [];
  const errors = [];
  loaded.host.sendDatagramPacket = (address, port, bytes) => sent.push({ port, bytes, reply: JSON.parse(Buffer.from(bytes.map(b => b & 255)).toString("utf8")) });
  loaded.host.errorln = message => errors.push(message);
  loaded.context.respond = loaded.realRespond;
  return { ...loaded, sent, errors };
}

test("a reply under the limit goes out unchanged", () => {
  const { context, sent } = capture();
  context.respond(4000, "1", true, { text: "Rémy" }, "status");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].port, 4000);
  assert.deepEqual(sent[0].reply, { protocol: "control-deck/1", id: "1", ok: true, payload: { text: "Rémy" } });
});

test("an oversized reply becomes a clear error that fits", () => {
  const { context, sent, errors } = capture();
  context.respond(4000, "1", true, { text: "x".repeat(70000) }, "list_parameters");
  assert.equal(sent.length, 1);
  assert.ok(sent[0].bytes.length <= context.MAX_REPLY_BYTES);
  assert.equal(sent[0].reply.ok, false);
  assert.match(sent[0].reply.payload.message, /over the 60000-byte limit for one reply/);
  assert.ok(sent[0].reply.payload.replyBytes > 70000);
  assert.match(errors[0], /the list_parameters reply is \d+ bytes/);
});

test("the size limit counts UTF-8 bytes", () => {
  const { context, sent } = capture();
  context.respond(4000, "1", true, { text: "é".repeat(31000) });
  assert.equal(sent[0].reply.ok, false, "31000 two-byte characters exceed 60000 bytes");
});

test("a failed send is logged and reported with a short error reply", () => {
  const { context, host, errors } = capture();
  const attempts = [];
  host.sendDatagramPacket = (address, port, bytes) => {
    attempts.push(bytes.length);
    if (attempts.length === 1) throw new Error("Message too long");
  };
  context.respond(4000, "1", true, { text: "x".repeat(20000) }, "list_tracks");
  assert.equal(attempts.length, 2);
  assert.ok(attempts[1] < 1000);
  assert.match(errors[0], /could not send the list_tracks reply \(\d+ bytes\): .*Message too long/);
});

test("finish passes the method name into the reply check", () => {
  const { context, sent, advance } = capture();
  context.dispatch = request => context.finish(request, true, { text: "x".repeat(70000) });
  context.enqueue(4000, "1", "find_actions", {}, 5000);
  advance(10);
  assert.equal(sent[0].reply.ok, false);
  assert.equal(context.requestBusy, false);
});

import assert from "node:assert/strict";
import dgram from "node:dgram";
import test from "node:test";
import { BitwigClient, BRIDGE_HOST, BRIDGE_PORT, BRIDGE_PROTOCOL } from "../src/bitwig-client.mjs";

test("bridge defaults are local and non-privileged", () => {
  assert.equal(BRIDGE_HOST, "127.0.0.1");
  assert.equal(BRIDGE_PORT, 50701);
  assert.ok(BRIDGE_PORT > 1024 && BRIDGE_PORT < 65536);
});

test("authenticated local packets round-trip Control Deck requests", async () => {
  const server = dgram.createSocket("udp4");
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.bind(0, "127.0.0.1", resolve);
  });

  server.on("message", packet => {
    const request = JSON.parse(packet.toString("utf8"));
    const response = Buffer.from(JSON.stringify({
      protocol: BRIDGE_PROTOCOL,
      id: request.id,
      ok: true,
      payload: { method: request.method, params: request.params }
    }), "utf8");
    server.send(response, request.replyPort, "127.0.0.1");
  });

  const client = new BitwigClient({ port: server.address().port, token: "test-token", timeoutMs: 1000 });
  try {
    assert.deepEqual(await client.request("status", { label: "Rémy" }), {
      method: "status",
      params: { label: "Rémy" }
    });
  } finally {
    client.close();
    server.close();
  }
});

import assert from "node:assert/strict";
import dgram from "node:dgram";
import test from "node:test";
import { BitwigClient, BRIDGE_HOST, BRIDGE_PORT, BRIDGE_PROTOCOL, BRIDGE_TIMEOUT_GRACE_MS, MAX_PACKET_BYTES } from "../src/bitwig-client.mjs";

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

async function echoServer(onPacket) {
  const server = dgram.createSocket("udp4");
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.bind(0, "127.0.0.1", resolve);
  });
  server.on("message", packet => {
    const request = JSON.parse(packet.toString("utf8"));
    onPacket?.(request, packet);
    server.send(Buffer.from(JSON.stringify({
      protocol: BRIDGE_PROTOCOL, id: request.id, ok: true, payload: { bytes: packet.length }
    }), "utf8"), request.replyPort, "127.0.0.1");
  });
  return server;
}

test("requests larger than macOS's default 9216-byte datagram reach the bridge", async () => {
  const server = await echoServer();
  const client = new BitwigClient({ port: server.address().port, token: "t", timeoutMs: 1000 });
  try {
    const { bytes } = await client.request("create_note_clip", { padding: "x".repeat(30000) });
    assert.ok(bytes > 30000);
  } finally {
    client.close();
    server.close();
  }
});

test("oversized requests fail at once with a clear message instead of timing out", async () => {
  const client = new BitwigClient({ port: 9, token: "t", timeoutMs: 5000 });
  try {
    const startedAt = Date.now();
    await assert.rejects(
      client.request("create_note_clip", { padding: "x".repeat(MAX_PACKET_BYTES) }),
      /over the 60000-byte limit/
    );
    assert.ok(Date.now() - startedAt < 500);
  } finally {
    client.close();
  }
});

test("a bridge timeout that arrives after the stated limit is the error the caller sees", async () => {
  const server = dgram.createSocket("udp4");
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.bind(0, "127.0.0.1", resolve);
  });
  server.on("message", packet => {
    const request = JSON.parse(packet.toString("utf8"));
    setTimeout(() => {
      server.send(Buffer.from(JSON.stringify({
        protocol: BRIDGE_PROTOCOL,
        id: request.id,
        ok: false,
        payload: { message: "Timed out: status did not finish within 200 ms. The transport is stopped and record-arm is restored.", timedOut: true }
      }), "utf8"), request.replyPort, "127.0.0.1");
    }, 350);
  });
  const client = new BitwigClient({ port: server.address().port, token: "t", timeoutMs: 5000 });
  try {
    await assert.rejects(client.request("status", {}, 200), /Timed out: status did not finish within 200 ms/);
  } finally {
    client.close();
    server.close();
  }
});

test("silence until the grace period reports a timeout, not a missing bridge", async () => {
  const client = new BitwigClient({ port: 9, token: "t", timeoutMs: 5000 });
  try {
    const startedAt = Date.now();
    await assert.rejects(client.request("status", {}, 200), /Timed out waiting .* record-arm restored/);
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed >= 200 + BRIDGE_TIMEOUT_GRACE_MS - 50, `gave up too soon (${elapsed} ms)`);
  } finally {
    client.close();
  }
});

test("each request tells the bridge how long the client will wait", async () => {
  let seen;
  const server = await echoServer(request => { seen = request.timeoutMs; });
  const client = new BitwigClient({ port: server.address().port, token: "t", timeoutMs: 1000 });
  try {
    await client.request("status", {}, 2500);
    assert.equal(seen, 2500);
  } finally {
    client.close();
    server.close();
  }
});

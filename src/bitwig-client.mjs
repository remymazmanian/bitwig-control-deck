import { randomUUID } from "node:crypto";
import dgram from "node:dgram";
import { readFileSync } from "node:fs";

export const BRIDGE_HOST = process.env.CONTROL_DECK_HOST || "127.0.0.1";
export const BRIDGE_PORT = Number(process.env.CONTROL_DECK_PORT || 50701);
export const BRIDGE_PROTOCOL = "control-deck/1";
export const TOKEN_FILE = new URL("../data/bridge-token", import.meta.url);
// macOS caps a UDP datagram at the socket's send buffer, which defaults to
// 9216 bytes (net.inet.udp.maxdgram). Raising it lets large note clips through.
export const SEND_BUFFER_BYTES = 65536;
// Largest request packet the client will try to send to Bitwig.
export const MAX_PACKET_BYTES = 60000;
// The bridge gives up at timeoutMs. The client waits a little longer so that
// timeout, including its transport and record-arm cleanup, is the error the
// caller sees rather than a disconnect.
export const BRIDGE_TIMEOUT_GRACE_MS = 1500;

// The per-install secret shared with the Bitwig controller script. Created by
// `npm run setup`; never committed.
export function readBridgeToken() {
  if (process.env.CONTROL_DECK_TOKEN) return process.env.CONTROL_DECK_TOKEN;
  try {
    const token = readFileSync(TOKEN_FILE, "utf8").trim();
    if (token) return token;
  } catch {
    // Fall through to the shared error below.
  }
  throw new Error(
    "No Control Deck bridge token found. Run `npm run setup` once to generate data/bridge-token and install the controller script, or set CONTROL_DECK_TOKEN."
  );
}

export class BitwigClient {
  constructor({ host = BRIDGE_HOST, port = BRIDGE_PORT, token, timeoutMs = 5000 } = {}) {
    if (token === undefined) token = readBridgeToken();
    this.host = host;
    this.port = port;
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.udp = dgram.createSocket({ type: "udp4", sendBufferSize: SEND_BUFFER_BYTES });
    this.udp.on("listening", () => this.resolveReady());
    this.udp.on("error", error => {
      if (this.rejectReady) this.rejectReady(error);
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(error);
      }
      this.pending.clear();
    });
    this.udp.on("message", packet => {
      try {
        this.onMessage(JSON.parse(packet.toString("utf8")));
      } catch {
        // Ignore unrelated or malformed local UDP packets.
      }
    });
    this.udp.bind(0, "127.0.0.1");
  }

  onMessage(message) {
    if (message?.protocol !== BRIDGE_PROTOCOL || !message.id) return;
    const { id, ok, payload } = message;
    const pending = this.pending.get(String(id));
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(String(id));
    if (ok === true) pending.resolve(payload);
    else pending.reject(new Error(payload?.message || "Bitwig rejected the request"));
  }

  async request(method, params = {}, timeoutMs = this.timeoutMs) {
    await this.readyPromise;
    const id = randomUUID();
    const waitMs = timeoutMs + BRIDGE_TIMEOUT_GRACE_MS;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(
          `Timed out waiting ${waitMs} ms for ${method}. The bridge was asked to stop at ${timeoutMs} ms and to leave the transport stopped and record-arm restored. ` +
          `If every call times out, enable Control Deck Bridge in Bitwig, or run "npm run setup" so the bridge and this client share the same auth token.`
        ));
      }, waitMs);
      this.pending.set(id, { resolve, reject, timer });
    });

    const packet = Buffer.from(JSON.stringify({
      protocol: BRIDGE_PROTOCOL,
      token: this.token,
      id,
      method,
      params,
      replyPort: this.udp.address().port,
      // Lets the bridge drop requests the client has already given up on and
      // recover if a request stalls inside Bitwig.
      timeoutMs
    }), "utf8");
    if (packet.length > MAX_PACKET_BYTES) {
      this.failPending(id, new Error(`The ${method} request is ${packet.length} bytes, over the ${MAX_PACKET_BYTES}-byte limit for one message to Bitwig. Split it into smaller requests.`));
      return response;
    }
    this.udp.send(packet, this.port, this.host, error => {
      if (error) this.failPending(id, new Error(`Could not send ${method} to Bitwig (${packet.length} bytes): ${error.message}`));
    });
    return response;
  }

  failPending(id, error) {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.reject(error);
  }

  close() {
    this.udp.close();
  }
}

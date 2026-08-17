import { randomUUID } from "node:crypto";
import dgram from "node:dgram";
import { readFileSync } from "node:fs";

export const BRIDGE_HOST = process.env.CONTROL_DECK_HOST || "127.0.0.1";
export const BRIDGE_PORT = Number(process.env.CONTROL_DECK_PORT || 50701);
export const BRIDGE_PROTOCOL = "control-deck/1";
export const TOKEN_FILE = new URL("../data/bridge-token", import.meta.url);

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

    this.udp = dgram.createSocket("udp4");
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
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bitwig did not answer ${method} within ${timeoutMs} ms. Make sure Control Deck Bridge is enabled in Bitwig.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });

    const packet = Buffer.from(JSON.stringify({
      protocol: BRIDGE_PROTOCOL,
      token: this.token,
      id,
      method,
      params,
      replyPort: this.udp.address().port
    }), "utf8");
    this.udp.send(packet, this.port, this.host);
    return response;
  }

  close() {
    this.udp.close();
  }
}

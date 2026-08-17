#!/usr/bin/env node
import http from "node:http";
import { fileURLToPath } from "node:url";
import { BitwigClient } from "./bitwig-client.mjs";
import { buildPluginIndex, readPluginIndex, searchPluginIndex } from "./plugin-index.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CONTROL_DECK_DASHBOARD_PORT || 50702);
// Where this checkout lives, so the dashboard's Connect page can render exact
// copy-paste MCP configuration for this machine.
const INSTALL_PATH = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
let client = null;
let clientError = null;
try {
  client = new BitwigClient({ timeoutMs: 1400 });
} catch (error) {
  clientError = error.message;
}

let activeIndexBuild = null;

function corsHeaders(origin) {
  const allowed = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  return {
    "access-control-allow-origin": allowed && origin ? origin : "http://127.0.0.1:3000",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin"
  };
}

function sendJson(response, status, payload, origin) {
  response.writeHead(status, {
    ...corsHeaders(origin),
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

async function bridgeSnapshot() {
  if (!client) {
    return { state: "waiting", status: null, tracks: null, devices: null, message: clientError };
  }
  try {
    const status = await client.request("status");
    const tracks = await client.request("list_tracks");
    let devices = null;
    if (status.selectedTrack) {
      const selected = tracks.tracks.find(track =>
        track.name === status.selectedTrack.name && track.position === status.selectedTrack.position
      );
      if (selected) {
        devices = await client.request("list_devices", {
          trackIndex: selected.index,
          trackName: selected.name
        });
      }
    }
    return { state: "online", status, tracks, devices, message: "Control Deck Bridge is connected to Bitwig." };
  } catch (error) {
    return {
      state: "waiting",
      status: null,
      tracks: null,
      devices: null,
      message: "Control Deck Bridge is installed. Reopen Bitwig once to activate the finalized bridge.",
      detail: error.message
    };
  }
}

async function snapshot() {
  const [bridge, index] = await Promise.all([bridgeSnapshot(), readPluginIndex()]);
  return {
    service: { state: "online", name: "Control Deck Local Service", version: "1.0.0", localOnly: true, installPath: INSTALL_PATH },
    bridge,
    library: {
      generatedAt: index.generatedAt,
      uniquePlugins: index.uniquePlugins,
      pluginBundles: index.pluginBundles,
      formatCounts: index.formatCounts
    }
  };
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(origin));
    response.end();
    return;
  }

  try {
    const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, service: "Control Deck Local Service", installPath: INSTALL_PATH }, origin);
      return;
    }
    if (request.method === "GET" && url.pathname === "/snapshot") {
      sendJson(response, 200, await snapshot(), origin);
      return;
    }
    if (request.method === "GET" && url.pathname === "/plugins") {
      const index = await readPluginIndex();
      sendJson(response, 200, searchPluginIndex(index, {
        query: url.searchParams.get("query") || "",
        format: url.searchParams.get("format") || "all",
        offset: url.searchParams.get("offset") || 0,
        limit: url.searchParams.get("limit") || 80
      }), origin);
      return;
    }
    if (request.method === "POST" && url.pathname === "/plugins/reindex") {
      activeIndexBuild ||= buildPluginIndex().finally(() => { activeIndexBuild = null; });
      const index = await activeIndexBuild;
      sendJson(response, 200, {
        ok: true,
        generatedAt: index.generatedAt,
        uniquePlugins: index.uniquePlugins,
        pluginBundles: index.pluginBundles,
        formatCounts: index.formatCounts
      }, origin);
      return;
    }
    sendJson(response, 404, { ok: false, message: "Not found" }, origin);
  } catch (error) {
    sendJson(response, 500, { ok: false, message: error.message }, origin);
  }
});

server.listen(PORT, HOST, async () => {
  console.log(`Control Deck Local Service listening at http://${HOST}:${PORT}`);
  try {
    const index = await readPluginIndex();
    console.log(`Control Deck indexed ${index.uniquePlugins} unique plug-ins.`);
  } catch (error) {
    console.error(`Control Deck plug-in index error: ${error.message}`);
  }
});

function shutdown() {
  if (client) client.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

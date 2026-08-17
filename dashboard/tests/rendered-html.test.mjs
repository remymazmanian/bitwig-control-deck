import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// Serves the production build (`next build` must have run first) and checks
// that both pages actually render.

const dashboardRoot = fileURLToPath(new URL("..", import.meta.url));
const port = 43200 + (process.pid % 500);
const baseUrl = `http://127.0.0.1:${port}`;
let server;

async function fetchPage(pathname) {
  const response = await fetch(new URL(pathname, baseUrl), { headers: { accept: "text/html" } });
  return { response, html: await response.text() };
}

before(async () => {
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "--port", String(port), "--hostname", "127.0.0.1"],
    { cwd: dashboardRoot, stdio: ["ignore", "pipe", "pipe"] }
  );
  const failure = new Promise((_, reject) => {
    server.once("exit", code => reject(new Error(`next start exited early with code ${code}`)));
  });

  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      await Promise.race([fetch(baseUrl), failure]);
      break;
    } catch (error) {
      if (String(error.message).startsWith("next start exited")) throw error;
      if (Date.now() > deadline) throw new Error(`next start did not answer on port ${port} within 30s`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}, { timeout: 40000 });

after(() => {
  server?.kill("SIGTERM");
});

test("server-renders the control deck", async () => {
  const { response, html } = await fetchPage("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  assert.match(html, /<title>Bitwig Control Deck<\/title>/i);
  assert.match(html, /LOCAL BRIDGE · BITWIG/);
  assert.match(html, /Plug-in index/);
  assert.match(html, /Loaded devices/);
  assert.match(html, /LOCAL ONLY/);
  assert.doesNotMatch(html, /BHR|bhrstudio|chatgpt|codex/i);
});

test("server-renders the connect page", async () => {
  const { response, html } = await fetchPage("/connect");
  assert.equal(response.status, 200);
  assert.match(html, /Connect any agent/i);
  assert.match(html, /Claude Code/);
  assert.match(html, /Claude Desktop/);
  assert.match(html, /Codex/);
  assert.match(html, /Gemini CLI/);
  assert.match(html, /Grok CLI/);
  assert.match(html, /Local LLMs/i);
  assert.match(html, /Remote connectors/i);
  assert.match(html, /mcpServers/);
});

test("server-renders the settings page", async () => {
  const { response, html } = await fetchPage("/settings");
  assert.equal(response.status, 200);
  assert.match(html, /Make the deck yours/i);
  assert.match(html, /Bridge address/i);
  assert.match(html, /Plug-in library/i);
  assert.match(html, /SAVE SETTINGS/i);
  assert.doesNotMatch(html, /BHR|bhrstudio|chatgpt|codex/i);
});

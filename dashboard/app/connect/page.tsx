"use client";

import { useEffect, useState } from "react";
import { BrandHeader } from "../brand-header";
import { useDeckPreferences } from "../preferences";

const PATH_PLACEHOLDER = "/path/to/bitwig-control-deck";

export default function ConnectPage() {
  const { preferences, ready } = useDeckPreferences();
  const [installPath, setInstallPath] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${preferences.apiBase}/health`, { cache: "no-store" });
        const health = await response.json();
        if (!cancelled && typeof health.installPath === "string" && health.installPath.startsWith("/")) {
          setInstallPath(health.installPath);
        }
      } catch {
        // Local service offline — the guides fall back to a placeholder path.
      }
    })();
    return () => { cancelled = true; };
  }, [ready, preferences.apiBase]);

  const p = installPath ?? PATH_PLACEHOLDER;
  const serverCommand = `node ${p}/src/index.mjs`;
  const mcpServersJson = `{
  "mcpServers": {
    "bitwig": {
      "command": "node",
      "args": ["${p}/src/index.mjs"]
    }
  }
}`;

  return (
    <main className="deck-shell settings-shell">
      <BrandHeader active="connect" />

      <section className="settings-hero">
        <div>
          <p className="eyebrow">AGENT ACCESS</p>
          <h1>Connect any agent.</h1>
          <p>
            Control Deck is a standard MCP server. Anything that speaks the Model Context
            Protocol — cloud coding agents or a fully local LLM — can drive Bitwig through
            the verified bridge on this Mac.
          </p>
        </div>
        <div className="settings-summary">
          <span>SERVER COMMAND</span>
          <strong>{installPath ? "This machine" : "Path pending"}</strong>
          <small>{installPath ? "Snippets use your real install path" : "Local service offline — snippets show a placeholder path"}</small>
        </div>
      </section>

      <div className="settings-layout">
        <nav className="settings-index" aria-label="Agent guides">
          <a href="#basics">The basics</a>
          <a href="#claude-code">Claude Code</a>
          <a href="#claude-desktop">Claude Desktop</a>
          <a href="#codex">Codex</a>
          <a href="#editors">Editors</a>
          <a href="#gemini">Gemini CLI</a>
          <a href="#grok">Grok CLI</a>
          <a href="#local-llm">Local LLMs</a>
          <a href="#generic">Anything else</a>
          <a href="#remote">Remote connectors</a>
        </nav>

        <div className="settings-stack">
          <GuideSection
            id="basics"
            eyebrow="ONE SERVER, MANY AGENTS"
            title="The basics"
            description="Every guide below configures the same thing: a local stdio MCP server."
          >
            <p className="guide-text">
              The server is a single command with no network setup. The agent launches it,
              talks MCP over stdio, and the server relays each request to Bitwig over an
              authenticated loopback channel. Before connecting any agent, make sure
              <code> npm install</code> and <code>npm run setup</code> have been run and the
              “Control Deck Bridge” controller is active in Bitwig.
            </p>
            <CodeBlock label="The server command every agent points at" code={serverCommand} />
            <p className="guide-text">
              If your agent cannot find <code>node</code>, use an absolute path to it
              (run <code>which node</code> to find yours). Requests only work while Bitwig
              is open on this Mac.
            </p>
          </GuideSection>

          <GuideSection
            id="claude-code"
            eyebrow="ANTHROPIC · CLI"
            title="Claude Code"
            description="One command registers the server for every project."
          >
            <CodeBlock
              label="Terminal"
              code={`claude mcp add --scope user bitwig -- node ${p}/src/index.mjs`}
            />
            <p className="guide-text">
              Start a new Claude Code session, then check with <code>/mcp</code>. Ask it to
              “list my Bitwig tracks” to confirm. Use <code>--scope project</code> instead to
              share the config with a repo via <code>.mcp.json</code>.
            </p>
          </GuideSection>

          <GuideSection
            id="claude-desktop"
            eyebrow="ANTHROPIC · APP"
            title="Claude Desktop"
            description="Add the server to the desktop app's local MCP config."
          >
            <p className="guide-text">
              Settings → Developer → Edit Config opens
              <code> claude_desktop_config.json</code>. Merge this in and restart the app:
            </p>
            <CodeBlock label="claude_desktop_config.json" code={mcpServersJson} />
          </GuideSection>

          <GuideSection
            id="codex"
            eyebrow="OPENAI"
            title="Codex CLI & Desktop"
            description="Codex reads MCP servers from its TOML config."
          >
            <CodeBlock
              label="~/.codex/config.toml"
              code={`[mcp_servers.bitwig]
command = "node"
args = ["${p}/src/index.mjs"]
startup_timeout_sec = 15.0`}
            />
            <p className="guide-text">
              Recent Codex CLI builds can also do this in one line:
              <code> codex mcp add bitwig -- node {p}/src/index.mjs</code>.
            </p>
          </GuideSection>

          <GuideSection
            id="editors"
            eyebrow="IDE AGENTS"
            title="Cursor, VS Code, Windsurf"
            description="The same stdio server, declared in each editor's MCP file."
          >
            <CodeBlock label="Cursor — ~/.cursor/mcp.json (or .cursor/mcp.json per project)" code={mcpServersJson} />
            <CodeBlock
              label="VS Code (Copilot agent mode) — .vscode/mcp.json"
              code={`{
  "servers": {
    "bitwig": {
      "type": "stdio",
      "command": "node",
      "args": ["${p}/src/index.mjs"]
    }
  }
}`}
            />
            <CodeBlock label="Windsurf — ~/.codeium/windsurf/mcp_config.json" code={mcpServersJson} />
          </GuideSection>

          <GuideSection
            id="gemini"
            eyebrow="GOOGLE"
            title="Gemini CLI"
            description="Gemini CLI uses the standard mcpServers block in its settings file."
          >
            <CodeBlock label="~/.gemini/settings.json" code={mcpServersJson} />
          </GuideSection>

          <GuideSection
            id="grok"
            eyebrow="XAI"
            title="Grok CLI"
            description="Grok's terminal agent takes the standard mcpServers block in its settings file."
          >
            <CodeBlock label="~/.grok/settings.json" code={mcpServersJson} />
            <p className="guide-text">
              Restart the CLI after saving, then ask Grok to list the available MCP tools to
              confirm the <code>bitwig</code> server loaded. Grok CLI is evolving quickly —
              if your build has an <code>mcp add</code> command or names the settings file
              differently, the values it needs are always the same two:
              command <code>node</code>, argument <code>{p}/src/index.mjs</code>.
            </p>
          </GuideSection>

          <GuideSection
            id="local-llm"
            eyebrow="FULLY OFFLINE"
            title="Local LLMs"
            description="A local model can drive Bitwig too — the harness is what speaks MCP."
          >
            <p className="guide-text">
              The model itself never connects to anything; its <em>harness</em> (the chat app
              or agent runtime) launches the MCP server and exposes the tools to the model.
              Any local model with solid tool-calling works. Two common setups:
            </p>
            <CodeBlock label="LM Studio — Program tab → Install → Edit mcp.json" code={mcpServersJson} />
            <CodeBlock
              label="Ollama — via an MCP harness such as mcphost"
              code={`# config.json uses the same mcpServers block as above
mcphost --config config.json -m ollama:qwen3`}
            />
            <p className="guide-text">
              With this route everything — the model, the agent, the bridge, and Bitwig —
              runs on this Mac with zero cloud involvement.
            </p>
          </GuideSection>

          <GuideSection
            id="generic"
            eyebrow="EVERYTHING ELSE"
            title="Any other MCP client"
            description="Zed, Cline, Roo Code, JetBrains, custom agents…"
          >
            <p className="guide-text">
              If a tool supports MCP, it accepts a stdio server defined by a command plus
              arguments. Most use the exact <code>mcpServers</code> JSON below; the rest ask
              for the same two values in their own settings UI.
            </p>
            <CodeBlock label="Standard config" code={mcpServersJson} />
            <ul className="guide-list">
              <li><strong>Command:</strong> <code>node</code></li>
              <li><strong>Arguments:</strong> <code>{p}/src/index.mjs</code></li>
              <li><strong>Transport:</strong> stdio (no URL, no port)</li>
            </ul>
          </GuideSection>

          <GuideSection
            id="remote"
            eyebrow="CLOUD ACCESS · READ FIRST"
            title="Remote connectors"
            description="Connecting claude.ai or ChatGPT connectors is possible — but it inverts the security model."
          >
            <p className="guide-text">
              “Connectors” in claude.ai and ChatGPT are <em>remote</em> MCP servers: the
              vendor's cloud connects to a public HTTPS endpoint. Control Deck is
              deliberately the opposite — a local stdio process, loopback-only, useless to
              anyone who is not on this Mac. A connector cannot reach{" "}
              <code>127.0.0.1</code> on your machine, so out of the box the answer is no.
            </p>
            <p className="guide-text">
              It can be bridged: a stdio→HTTP gateway (such as <code>mcp-proxy</code> or{" "}
              <code>supergateway</code>) in front of the server, published through a tunnel
              (cloudflared, ngrok, or a Tailscale Funnel). Understand what that means before
              doing it:
            </p>
            <ul className="guide-list">
              <li>Your DAW becomes internet-reachable. The bridge token only protects the local UDP hop — the HTTP endpoint needs its own auth (OAuth or a bearer token), and unauthenticated tunnels are found by scanners within minutes.</li>
              <li>The Mac must stay awake with Bitwig open, and every request pays cloud-to-home latency.</li>
              <li>A cloud agent with transport control and device deletion is a bigger blast radius than a cloud agent that can read files.</li>
            </ul>
            <p className="guide-text">
              If you want access from other devices, prefer a private overlay network
              (plain Tailscale, no Funnel) over a public tunnel — the endpoint stays
              invisible to the internet. For everything else, local agents via stdio are
              the supported, safe path.
            </p>
          </GuideSection>
        </div>
      </div>

      <footer>
        <span>BITWIG CONTROL DECK · CONNECT</span>
        <span>LOCAL MCP · STDIO</span>
      </footer>
    </main>
  );
}

function GuideSection({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-card" id={id}>
      <div className="settings-card-head">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="guide-body">{children}</div>
    </section>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable (permissions); the user can still select the text.
    }
  }

  return (
    <div className="code-block">
      <div className="code-head">
        <span>{label}</span>
        <button type="button" onClick={copy}>{copied ? "COPIED" : "COPY"}</button>
      </div>
      <pre>{code}</pre>
    </div>
  );
}

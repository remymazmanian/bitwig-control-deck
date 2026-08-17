#!/usr/bin/env node
// Full local setup for Bitwig Control Deck. Safe to re-run at any time.
//
//   npm run setup                     everything: deps, builds, token,
//                                     controller, launch agents, activation
//   npm run setup -- --skip-build     skip npm installs and builds (dev loop)
//   npm run setup -- --skip-controller
//   npm run setup -- --skip-agents    do not write or activate launch agents
//
// The double-click installer (`Install Control Deck.command`) runs this same
// script, so keep every message understandable without a coding background.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const args = new Set(process.argv.slice(2));
const home = homedir();
const skipBuild = args.has("--skip-build");

const tokenFile = path.join(root, "data", "bridge-token");
const installPathFile = path.join(root, "data", "install-path");
const controllerSource = path.join(root, "controller", "ControlDeck.control.js");
const controllerTargetDirectory = path.join(home, "Documents", "Bitwig Studio", "Controller Scripts", "Control Deck");
const controllerTarget = path.join(controllerTargetDirectory, "ControlDeck.control.js");
const agentsDirectory = path.join(home, "Library", "LaunchAgents");
const midiPortsBinary = path.join(root, "bin", "control-deck-midi-ports");
const nodePath = process.execPath;

let failures = 0;

function ok(message) { console.log(`  ✓ ${message}`); }
function warn(message) { console.log(`  ⚠ ${message}`); }
function fail(message) { failures += 1; console.log(`  ✗ ${message}`); }
function heading(message) { console.log(`\n${message}`); }

function run(command, commandArguments, { cwd = root, quiet = false } = {}) {
  const result = spawnSync(command, commandArguments, {
    cwd,
    stdio: quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    encoding: "utf8",
  });
  return result;
}

heading("Bitwig Control Deck setup");
console.log(`  Install location: ${root}`);

// ---------------------------------------------------------------- guardrails
if (/\/(Downloads|Desktop)\//.test(`${root}/`) && !args.has("--allow-any-location")) {
  console.log(`
  This folder is in your ${root.includes("/Downloads/") ? "Downloads" : "Desktop"} folder. Setup pins services to the
  folder's location, so please move it somewhere permanent first — your home
  folder works well. Then run the installer again from the new location.
`);
  process.exit(1);
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 20) {
  console.log(`
  This app needs Node.js 20 or newer; you have ${process.versions.node}.
  Download the LTS installer from https://nodejs.org and run setup again.
`);
  process.exit(1);
}
ok(`Node.js ${process.versions.node}`);

let previousPath = null;
try {
  previousPath = (await readFile(installPathFile, "utf8")).trim();
} catch {}
if (previousPath && previousPath !== root) {
  warn(`The folder moved since the last setup (was ${previousPath}). Refreshing everything for the new location.`);
}

// ------------------------------------------------------------ deps + builds
if (!skipBuild) {
  heading("Installing and building (first run can take a few minutes)");

  const rootInstall = run("npm", ["install", "--no-fund", "--no-audit"], { quiet: true });
  if (rootInstall.status === 0) ok("Bridge dependencies installed");
  else {
    fail("npm install failed in the project folder");
    console.log(rootInstall.stderr || rootInstall.stdout);
  }

  const clangCheck = run("xcode-select", ["-p"], { quiet: true });
  if (clangCheck.status !== 0) {
    warn("Apple's command line tools are missing, so the MIDI helper was skipped.");
    warn("Fix: run `xcode-select --install`, accept the popup, then run setup again.");
  } else {
    const clang = run("clang", [
      "-O2", "-framework", "CoreFoundation", "-framework", "CoreMIDI",
      path.join(root, "native", "control_deck_midi_ports.c"),
      "-o", midiPortsBinary,
    ], { quiet: true });
    if (clang.status === 0) ok("MIDI helper built");
    else {
      fail("Could not build the MIDI helper");
      console.log(clang.stderr || clang.stdout);
    }
  }

  const dashboardInstall = run("npm", ["install", "--no-fund", "--no-audit"], { cwd: path.join(root, "dashboard"), quiet: true });
  if (dashboardInstall.status === 0) ok("Dashboard dependencies installed");
  else {
    fail("npm install failed in dashboard/");
    console.log(dashboardInstall.stderr || dashboardInstall.stdout);
  }

  const dashboardBuild = run("npm", ["run", "build"], { cwd: path.join(root, "dashboard"), quiet: true });
  if (dashboardBuild.status === 0) ok("Dashboard built");
  else {
    fail("Dashboard build failed");
    console.log(dashboardBuild.stderr || dashboardBuild.stdout);
  }
}

// ------------------------------------------------------------------- secret
heading("Bridge secret");
await mkdir(path.dirname(tokenFile), { recursive: true });
if (existsSync(tokenFile)) {
  ok("Using the existing bridge secret");
} else {
  await writeFile(tokenFile, `${randomUUID()}\n`, { mode: 0o600 });
  ok("Generated a new bridge secret (data/bridge-token)");
}
const token = (await readFile(tokenFile, "utf8")).trim();

// --------------------------------------------------------------- controller
if (!args.has("--skip-controller")) {
  heading("Bitwig controller script");
  const source = await readFile(controllerSource, "utf8");
  const placeholder = "__CONTROL_DECK_TOKEN__";
  if (!source.includes(placeholder)) {
    fail(`controller/ControlDeck.control.js is missing the token placeholder ${placeholder}.`);
  } else {
    await mkdir(controllerTargetDirectory, { recursive: true });
    await writeFile(controllerTarget, source.replace(placeholder, token), { mode: 0o600 });
    ok(`Installed to ${controllerTarget}`);
  }
}

// ------------------------------------------------------------ launch agents
function plist(label, programArguments, { workingDirectory } = {}) {
  const argumentStrings = programArguments.map(value => `    <string>${value}</string>`).join("\n");
  const workingDirectoryEntry = workingDirectory
    ? `  <key>WorkingDirectory</key>\n  <string>${workingDirectory}</string>\n`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${argumentStrings}
  </array>
${workingDirectoryEntry}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>/tmp/${label}.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/${label}.error.log</string>
</dict>
</plist>
`;
}

if (!args.has("--skip-agents")) {
  heading("Background services");
  const agents = [
    {
      label: "com.controldeck.midi-ports",
      available: existsSync(midiPortsBinary),
      hint: "MIDI helper is not built yet",
      programArguments: [midiPortsBinary],
    },
    {
      label: "com.controldeck.api",
      available: true,
      programArguments: [nodePath, path.join(root, "src", "dashboard-server.mjs")],
      workingDirectory: root,
    },
    {
      label: "com.controldeck.dashboard",
      available: existsSync(path.join(root, "dashboard", "node_modules", "next")),
      hint: "dashboard is not built yet",
      programArguments: [
        nodePath,
        path.join(root, "dashboard", "node_modules", "next", "dist", "bin", "next"),
        "start",
        "--port", "50703",
        "--hostname", "127.0.0.1",
      ],
      workingDirectory: path.join(root, "dashboard"),
    },
  ];

  await mkdir(agentsDirectory, { recursive: true });
  const uid = process.getuid();
  for (const agent of agents) {
    if (!agent.available) {
      warn(`Skipped ${agent.label} (${agent.hint}).`);
      continue;
    }
    const target = path.join(agentsDirectory, `${agent.label}.plist`);
    await writeFile(target, plist(agent.label, agent.programArguments, agent));
    // Re-running setup must restart services cleanly. bootout is asynchronous —
    // the label lingers until the process exits — so wait for it to disappear
    // and give bootstrap a few attempts before declaring failure.
    run("launchctl", ["bootout", `gui/${uid}/${agent.label}`], { quiet: true });
    let bootstrap = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const lingering = run("launchctl", ["print", `gui/${uid}/${agent.label}`], { quiet: true });
      if (lingering.status !== 0) {
        bootstrap = run("launchctl", ["bootstrap", `gui/${uid}`, target], { quiet: true });
        if (bootstrap.status === 0) break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (bootstrap?.status === 0) ok(`${agent.label} is running (starts automatically at login)`);
    else {
      fail(`Could not start ${agent.label}`);
      if (bootstrap) console.log(bootstrap.stderr || bootstrap.stdout);
    }
  }
}

await writeFile(installPathFile, `${root}\n`);

// ------------------------------------------------------------------ summary
if (failures > 0) {
  heading(`Setup finished with ${failures} problem${failures === 1 ? "" : "s"} — see the ✗ lines above.`);
  console.log("  Fix the issue, then run setup again; it is always safe to re-run.\n");
  process.exit(1);
}

heading("Setup complete. Two steps left:");
console.log(`
  1. Open Bitwig → Settings → Controllers and confirm “Control Deck Bridge”
     is listed and enabled (add it manually if it was not auto-detected).
  2. Connect your AI agent: open http://127.0.0.1:50703/connect for
     copy-paste instructions for Claude Code, Codex, and every other client.
`);

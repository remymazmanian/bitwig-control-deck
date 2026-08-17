import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_PLUGIN_ROOTS = [
  { path: "/Library/Audio/Plug-Ins/VST", format: "VST2", location: "System" },
  { path: "/Library/Audio/Plug-Ins/VST3", format: "VST3", location: "System" },
  { path: "/Library/Audio/Plug-Ins/Components", format: "AU", location: "System" },
  { path: "/Library/Audio/Plug-Ins/CLAP", format: "CLAP", location: "System" },
  { path: join(process.env.HOME || "", "Library/Audio/Plug-Ins/VST"), format: "VST2", location: "User" },
  { path: join(process.env.HOME || "", "Library/Audio/Plug-Ins/VST3"), format: "VST3", location: "User" },
  { path: join(process.env.HOME || "", "Library/Audio/Plug-Ins/Components"), format: "AU", location: "User" },
  { path: join(process.env.HOME || "", "Library/Audio/Plug-Ins/CLAP"), format: "CLAP", location: "User" }
];

export const DEFAULT_PLUGIN_INDEX = new URL("../data/plugin-index.json", import.meta.url);

const EXTENSIONS = new Map([
  [".vst", "VST2"],
  [".vst3", "VST3"],
  [".component", "AU"],
  [".clap", "CLAP"]
]);

function cleanBundleName(value) {
  return String(value || "")
    .replace(/\.(vst3?|component|clap)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function manufacturerFromIdentifier(identifier) {
  const ignored = new Set(["com", "net", "org", "audio", "music", "plugin", "plugins", "vst", "vst3"]);
  const parts = String(identifier || "").split(".").filter(Boolean);
  const candidate = parts.find(part => !ignored.has(part.toLowerCase()) && !/^\d+$/.test(part));
  return candidate ? titleCase(candidate) : "Unknown";
}

async function bundleMetadata(pluginPath) {
  const plist = join(pluginPath, "Contents", "Info.plist");
  try {
    const { stdout } = await execFileAsync("/usr/bin/plutil", ["-convert", "json", "-o", "-", plist], {
      maxBuffer: 1024 * 1024,
      timeout: 2500
    });
    const info = JSON.parse(stdout);
    const identifier = String(info.CFBundleIdentifier || "");
    return {
      name: cleanBundleName(info.CFBundleDisplayName || info.CFBundleName || basename(pluginPath)),
      manufacturer: manufacturerFromIdentifier(identifier),
      version: String(info.CFBundleShortVersionString || info.CFBundleVersion || "").trim()
    };
  } catch {
    return {
      name: cleanBundleName(basename(pluginPath)),
      manufacturer: "Unknown",
      version: ""
    };
  }
}

async function findPluginBundles(root) {
  const found = [];
  const queue = [root.path];

  while (queue.length) {
    const current = queue.shift();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(current, entry.name);
      const detectedFormat = EXTENSIONS.get(extname(entry.name).toLowerCase());
      if (detectedFormat) {
        found.push({ path: fullPath, format: detectedFormat || root.format, location: root.location });
      } else if (entry.isDirectory() && dirname(fullPath).split("/").length - root.path.split("/").length < 3) {
        queue.push(fullPath);
      }
    }
  }

  return found;
}

export function mergePluginRecords(records) {
  const merged = new Map();
  for (const record of records) {
    const name = cleanBundleName(record.name);
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    const existing = merged.get(key) || {
      id: createHash("sha256").update(key).digest("hex").slice(0, 16),
      name,
      manufacturers: [],
      formats: [],
      versions: [],
      locations: []
    };
    for (const [field, value] of [
      ["manufacturers", record.manufacturer],
      ["formats", record.format],
      ["versions", record.version],
      ["locations", record.location]
    ]) {
      if (value && !existing[field].includes(value)) existing[field].push(value);
    }
    merged.set(key, existing);
  }

  return [...merged.values()]
    .map(plugin => ({
      ...plugin,
      manufacturers: plugin.manufacturers.filter(value => value !== "Unknown" || plugin.manufacturers.length === 1).sort(),
      formats: plugin.formats.sort(),
      versions: plugin.versions.sort(),
      locations: plugin.locations.sort()
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length || 1) }, worker));
  return output;
}

export async function buildPluginIndex({ roots = DEFAULT_PLUGIN_ROOTS, outputUrl = DEFAULT_PLUGIN_INDEX } = {}) {
  const bundles = (await Promise.all(roots.map(findPluginBundles))).flat();
  const records = await mapWithConcurrency(bundles, 16, async bundle => ({
    ...(await bundleMetadata(bundle.path)),
    format: bundle.format,
    location: bundle.location
  }));
  const plugins = mergePluginRecords(records);
  const formatCounts = {};
  for (const record of records) formatCounts[record.format] = (formatCounts[record.format] || 0) + 1;
  const index = {
    generatedAt: new Date().toISOString(),
    uniquePlugins: plugins.length,
    pluginBundles: records.length,
    formatCounts,
    plugins
  };

  await mkdir(new URL("./", outputUrl), { recursive: true });
  const temporaryUrl = new URL(`./.${basename(outputUrl.pathname)}.${process.pid}.tmp`, outputUrl);
  await writeFile(temporaryUrl, JSON.stringify(index, null, 2) + "\n", "utf8");
  await rename(temporaryUrl, outputUrl);
  return index;
}

export async function readPluginIndex({ inputUrl = DEFAULT_PLUGIN_INDEX, buildWhenMissing = true } = {}) {
  try {
    return JSON.parse(await readFile(inputUrl, "utf8"));
  } catch (error) {
    if (!buildWhenMissing) throw error;
    return buildPluginIndex({ outputUrl: inputUrl });
  }
}

export function searchPluginIndex(index, { query = "", format = "all", offset = 0, limit = 80 } = {}) {
  const normalizedQuery = String(query).trim().toLocaleLowerCase();
  const normalizedFormat = String(format).toUpperCase();
  const matches = index.plugins.filter(plugin => {
    const searchable = [plugin.name, ...plugin.manufacturers, ...plugin.formats].join(" ").toLocaleLowerCase();
    const queryMatches = !normalizedQuery || searchable.includes(normalizedQuery);
    const formatMatches = normalizedFormat === "ALL" || plugin.formats.includes(normalizedFormat);
    return queryMatches && formatMatches;
  });
  const start = Math.max(0, Number(offset) || 0);
  const pageSize = Math.min(200, Math.max(1, Number(limit) || 80));
  return {
    generatedAt: index.generatedAt,
    total: matches.length,
    offset: start,
    limit: pageSize,
    plugins: matches.slice(start, start + pageSize)
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const index = await buildPluginIndex();
  console.log(JSON.stringify({
    generatedAt: index.generatedAt,
    uniquePlugins: index.uniquePlugins,
    pluginBundles: index.pluginBundles,
    formatCounts: index.formatCounts
  }, null, 2));
}

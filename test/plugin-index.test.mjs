import assert from "node:assert/strict";
import test from "node:test";
import { mergePluginRecords, searchPluginIndex } from "../src/plugin-index.mjs";

test("plugin inventory merges formats without losing identity", () => {
  const plugins = mergePluginRecords([
    { name: "Pigments", manufacturer: "Arturia", format: "VST3", version: "7.0", location: "System" },
    { name: "Pigments", manufacturer: "Arturia", format: "AU", version: "7.0", location: "System" },
    { name: "Pro-Q 4", manufacturer: "FabFilter", format: "VST3", version: "4.1", location: "System" }
  ]);

  assert.equal(plugins.length, 2);
  assert.deepEqual(plugins[0].formats, ["AU", "VST3"]);
  assert.equal(plugins[0].name, "Pigments");
  assert.equal(plugins[0].id.length, 16);
});

test("plugin inventory search filters names, makers, and formats", () => {
  const plugins = mergePluginRecords([
    { name: "Pigments", manufacturer: "Arturia", format: "VST3", version: "7.0", location: "System" },
    { name: "Pro-Q 4", manufacturer: "FabFilter", format: "VST3", version: "4.1", location: "System" },
    { name: "SpaceBlender", manufacturer: "Soundtoys", format: "AU", version: "1.0", location: "System" }
  ]);
  const index = { generatedAt: "2026-07-19T00:00:00.000Z", plugins };

  assert.equal(searchPluginIndex(index, { query: "arturia" }).total, 1);
  assert.equal(searchPluginIndex(index, { format: "AU" }).plugins[0].name, "SpaceBlender");
  assert.equal(searchPluginIndex(index, { query: "pro", format: "VST3" }).total, 1);
});

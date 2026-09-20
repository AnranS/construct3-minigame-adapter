import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { unzipSync, strFromU8 } from "fflate";
import { packageAddon } from "../scripts/package-addon.mjs";

const addonDir = fileURLToPath(new URL("../addon/", import.meta.url));
const json = async name => JSON.parse(await readFile(path.join(addonDir, name), "utf8"));

test("addon metadata, ACEs and language validate against the official SDK schemas", async () => {
  for (const [filename, schemaName] of [["addon.json", "plugin.addon.schema.json"], ["aces.json", "aces.schema.json"], ["lang/en-US.json", "plugin.lang.schema.json"]]) {
    // The upstream addon and ACE schemas share an $id, so validate separately.
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    const schema = await json(`schemas/${schemaName}`);
    const value = await json(filename);
    delete value.$schema;
    const validate = ajv.compile(schema);
    assert.equal(validate(value), true, `${filename}: ${ajv.errorsText(validate.errors)}`);
  }
  const metadata = await json("addon.json");
  assert.equal(metadata["sdk-version"], 2);
  assert.equal(metadata["supports-worker-mode"], false);
  assert.equal(metadata.version, "0.2.0.0");
  const language = (await json("lang/en-US.json")).text.plugins.c3minigamebridge;
  const aces = (await json("aces.json")).bridge;
  for (const section of ["conditions", "actions", "expressions"]) {
    for (const ace of aces[section]) {
      assert.ok(language[section][ace.id], `Missing language entry for ${section}/${ace.id}`);
      for (const param of ace.params ?? []) assert.ok(language[section][ace.id].params[param.id]);
    }
  }
  assert.ok(aces.actions.every(action => action.isAsync === true));
});

test("every declared ACE maps to an implementation and generic tagged triggers keep their parameters", async () => {
  const context = { C3: { Plugins: { C3MiniGameBridge: {} } } };
  for (const filename of ["actions.js", "conditions.js", "expressions.js"])
    vm.runInNewContext(await readFile(path.join(addonDir, "c3runtime", filename), "utf8"), context, { filename });
  const runtime = context.C3.Plugins.C3MiniGameBridge;
  const aces = (await json("aces.json")).bridge;
  for (const [section, object] of [["actions", "Acts"], ["conditions", "Cnds"], ["expressions", "Exps"]]) {
    const ids = new Set();
    const declared = new Set();
    for (const ace of aces[section]) {
      assert.ok(!ids.has(ace.id), `Duplicate ${section}/${ace.id}`);
      ids.add(ace.id);
      const name = ace.scriptName ?? ace.expressionName;
      declared.add(name);
      assert.equal(typeof runtime[object][name], "function", `Missing implementation: ${name}`);
    }
    assert.deepEqual(Object.keys(runtime[object]).sort(), [...declared].sort(), `Undeclared ${object} implementation`);
  }
  for (const name of ["OnAPISucceeded", "OnAPIEvent"]) {
    const condition = aces.conditions.find(item => item.scriptName === name);
    assert.equal(condition.isTrigger, true);
    assert.deepEqual(condition.params.map(param => [param.id, param.type]), [["tag", "string"]]);
  }
  assert.deepEqual(aces.actions.find(item => item.scriptName === "CallAPI").params.map(param => param.id), ["api-name", "options-json", "tag"]);
  assert.deepEqual(aces.actions.find(item => item.scriptName === "ReadAPISync").params.map(param => param.id), ["api-name", "args-json", "tag"]);
  assert.ok(!aces.actions.some(item => item.scriptName === "CreateAPIObject"), "Native object factories are JavaScript-only");
});

test("editor scripts register a single-global plugin with matching properties and runtime entry", async () => {
  const info = {};
  const contexts = [];
  let registered;
  class PluginBase {
    constructor(id) { this.id = id; this._info = new Proxy({}, { get: (_, name) => value => { info[name] = value; } }); }
    static Register(id, type) { registered = { id, type }; }
  }
  const SDK = {
    Plugins: {}, IPluginBase: PluginBase, ITypeBase: class {}, IInstanceBase: class {},
    Lang: { PushContext: value => contexts.push(value), PopContext: () => contexts.pop() },
    PluginProperty: class { constructor(type, id, options) { Object.assign(this, { type, id, options }); } }
  };
  for (const filename of (await json("addon.json"))["editor-scripts"])
    vm.runInNewContext(await readFile(path.join(addonDir, filename), "utf8"), { SDK, lang: key => key }, { filename });
  const plugin = new registered.type();
  assert.equal(plugin.id, "C3MiniGameBridge");
  assert.equal(registered.id, "C3MiniGameBridge");
  assert.equal(info.SetIsSingleGlobal, true);
  assert.equal(info.SetRuntimeModuleMainScript, "c3runtime/main.js");
  assert.deepEqual(Array.from(info.SetProperties, property => property.id), ["platform", "score-endpoint"]);
  assert.deepEqual(Array.from(info.SetProperties[0].options.items), ["auto", "douyin", "wechat"]);
  assert.equal(contexts.length, 0);
  assert.equal(info.AddFileDependency, undefined, "must not inject the mini game adapter as a DOM script");
});

test("packaged addon has manifest at ZIP root, complete modules, and no development schemas", async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "c3-addon-test-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const outputFile = path.join(temp, "C3MiniGameBridge.c3addon");
  const result = await packageAddon({ outputFile });
  const files = unzipSync(new Uint8Array(await readFile(outputFile)));
  const manifest = JSON.parse(strFromU8(files["addon.json"]));
  assert.equal(result.fileCount, manifest["file-list"].length);
  assert.deepEqual(Object.keys(files).sort(), [...manifest["file-list"]].sort());
  assert.ok(!Object.keys(files).some(name => name.startsWith("schemas/") || name.startsWith("addon/")));
  for (const filename of ["addon.json", "aces.json", "lang/en-US.json"])
    assert.equal(JSON.parse(strFromU8(files[filename])).$schema, undefined);
  const main = strFromU8(files["c3runtime/main.js"]);
  for (const match of main.matchAll(/import "\.\/(.+?)";/g)) assert.ok(files[`c3runtime/${match[1]}`]);
  const second = path.join(temp, "repeat.c3addon");
  await packageAddon({ outputFile: second });
  assert.deepEqual(await readFile(second), await readFile(outputFile), "builds should be deterministic");
});

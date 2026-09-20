import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { convertProject } from "../src/build/convert.mjs";
import { inspectProject } from "../src/build/inspect.mjs";

async function fixture(t, files = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "c3-build-safety-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, "input");
  const output = path.join(root, "output");
  await fs.mkdir(input);
  const write = async (name, content) => {
    const target = path.join(input, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  };
  for (const [name, content] of Object.entries({
    "index.html": '<script type="module" src="main.js"></script>',
    "main.js": "globalThis.safetyFixture = true;",
    ...files
  })) await write(name, content);
  return { root, input, output, write, build: options => convertProject({ input, output, platform: "wechat", ...options }) };
}

async function snapshot(dir) {
  const result = {};
  const visit = async (current, prefix = "") => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await visit(path.join(current, entry.name), `${name}/`);
      else result[name] = (await fs.readFile(path.join(current, entry.name))).toString("base64");
    }
  };
  await visit(dir);
  return result;
}

async function assertMissing(filename) {
  await assert.rejects(fs.access(filename), { code: "ENOENT" });
}

for (const type of ["main module", "worker"]) {
  test(`${type}: reject a JSON import outside the input directory`, async t => {
    const setup = await fixture(t);
    await fs.writeFile(path.join(setup.root, "outside.json"), '{"secret":"outside-input-sentinel"}');
    await setup.write(type === "worker" ? "jobworker.js" : "main.js", 'import value from "../outside.json"; globalThis.reviewResult = value;');
    await assert.rejects(setup.build(), /超出导出目录|导出目录外/);
    await assertMissing(setup.output);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(setup.root, "outside.json"))), { secret: "outside-input-sentinel" });
    assert.ok(!(await fs.readdir(setup.root)).some(name => name.startsWith(".c3-build-")));
  });

  test(`${type}: reject an unbundled bare package import`, async t => {
    const setup = await fixture(t);
    await setup.write(type === "worker" ? "jobworker.js" : "main.js", 'import value from "unbundled-external-package"; globalThis.reviewResult = value;');
    await assert.rejects(setup.build(), /未打包的外部依赖/);
    await assertMissing(setup.output);
  });
}

test("classic scripts with shared global declarations are explicitly rejected", async t => {
  const declarations = [
    "var SharedClassicSDK = {value:42};",
    "let SharedClassicSDK = {value:42};",
    "const SharedClassicSDK = {value:42};",
    "function SharedClassicSDK() { return 42; }",
    "class SharedClassicSDK {}",
    "if (true) { var SharedClassicSDK = {value:42}; }"
  ];
  const setup = await fixture(t, {
    "index.html": '<script src="first.js"></script><script src="second.js"></script>',
    "second.js": "globalThis.sharedResult = SharedClassicSDK;"
  });
  for (const declaration of declarations) {
    await setup.write("first.js", declaration);
    const inspection = await inspectProject(setup.input);
    assert.equal(inspection.canBuild, false, declaration);
    assert.ok(inspection.findings.some(finding => finding.code === "CLASSIC_GLOBAL_SCOPE" && finding.level === "error"), declaration);
    await assert.rejects(setup.build(), /classic.*全局声明/);
    await assertMissing(setup.output);
  }
});

test("explicit globalThis sharing and module-private declarations remain accepted", async t => {
  const setup = await fixture(t, {
    "index.html": '<script src="first.js"></script><script type="module" src="second.js"></script>',
    "first.js": "(() => { const privateValue = 42; globalThis.SharedClassicSDK = {value:privateValue}; })();",
    "second.js": "const value = globalThis.SharedClassicSDK.value; globalThis.sharedResult = value;"
  });
  assert.equal((await inspectProject(setup.input)).canBuild, true);
  const result = await setup.build();
  assert.equal(result.validation, "build-only-not-device-verified");
  const boot = await fs.readFile(path.join(setup.output, "game.js"), "utf8");
  assert.match(boot, /__C3MiniGameLoaded/);
});

test("failed rebuild leaves every old output file unchanged and removes staging", async t => {
  const setup = await fixture(t);
  await setup.build();
  await fs.writeFile(path.join(setup.output, "user-review-notes.txt"), "Keep this until the rebuild succeeds.");
  const before = await snapshot(setup.output);
  await setup.write("main.js", 'import "./missing-module.js";');
  await assert.rejects(setup.build({ overwrite: true }), /missing-module/);
  assert.deepEqual(await snapshot(setup.output), before);
  assert.ok(!(await fs.readdir(setup.root)).some(name => name.startsWith(".c3-build-") || name.startsWith("output.backup-")));
});

test("refuse overwriting directories without this tool's valid marker", async t => {
  const setup = await fixture(t);
  await fs.mkdir(setup.output);
  await fs.writeFile(path.join(setup.output, "important.txt"), "Unrelated user data");
  for (const marker of [null, "{broken", '{"tool":"another-tool"}']) {
    const markerFile = path.join(setup.output, ".c3-minigame-output.json");
    if (marker === null) await fs.rm(markerFile, { force: true });
    else await fs.writeFile(markerFile, marker);
    const before = await snapshot(setup.output);
    await assert.rejects(setup.build({ overwrite: true }), /拒绝覆盖/);
    assert.deepEqual(await snapshot(setup.output), before);
  }
});

test("explicit overwrite is required even for a previous successful build", async t => {
  const setup = await fixture(t);
  await setup.build();
  const before = await snapshot(setup.output);
  await setup.write("main.js", "globalThis.changedFixture = true;");
  await assert.rejects(setup.build(), /输出目录已存在/);
  assert.deepEqual(await snapshot(setup.output), before);
  await setup.build({ overwrite: true });
  assert.notDeepEqual(await snapshot(setup.output), before);
});

for (const kind of ["file", "directory"]) {
  test(`reject input ${kind} symlinks instead of importing external files`, async t => {
    const setup = await fixture(t);
    const outside = path.join(setup.root, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "private.json"), '{"private":"not-exported"}');
    await fs.symlink(kind === "file" ? path.join(outside, "private.json") : outside, path.join(setup.input, kind === "file" ? "linked.json" : "linked"), kind === "file" ? "file" : "dir");
    await assert.rejects(setup.build(), /符号链接/);
    await assertMissing(setup.output);
  });
}

test("reject an output symlink and input/output directory overlap", async t => {
  const setup = await fixture(t);
  const existing = path.join(setup.root, "existing-output");
  await fs.mkdir(existing);
  await fs.writeFile(path.join(existing, "important.txt"), "Keep this.");
  await fs.symlink(existing, setup.output, "dir");
  await assert.rejects(setup.build({ overwrite: true }), /普通目录/);
  assert.equal(await fs.readFile(path.join(existing, "important.txt"), "utf8"), "Keep this.");
  await assert.rejects(setup.build({ output: setup.input }), /互相包含/);
  await assert.rejects(setup.build({ output: path.join(setup.input, "generated") }), /互相包含/);
  await assert.rejects(setup.build({ output: setup.root, overwrite: true }), /互相包含/);
  await assertMissing(path.join(setup.input, "generated"));
});

for (const type of ["main module", "worker"]) {
  test(`${type}: reject imported symlinks hidden in otherwise ignored folders`, async t => {
    const setup = await fixture(t);
    const outside = path.join(setup.root, "outside.json");
    await fs.writeFile(outside, '{"secret":"hidden-symlink-sentinel"}');
    await fs.mkdir(path.join(setup.input, "node_modules"));
    await fs.symlink(outside, path.join(setup.input, "node_modules", "linked.json"), "file");
    await setup.write(type === "worker" ? "jobworker.js" : "main.js", 'import data from "./node_modules/linked.json"; globalThis.reviewResult = data;');
    await assert.rejects(setup.build(), /符号链接|超出导出目录|导出目录外|未打包|不允许|输入目录/);
    await assertMissing(setup.output);
  });
}

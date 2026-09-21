import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {unzipSync, strFromU8} from 'fflate';

const script = await fs.readFile(new URL('../examples/construct/api-demo-main.js', import.meta.url), 'utf8');

test('the editable Construct project contains the current demo script, full PNG and a hidden real Sprite', async () => {
  const [projectBytes, image] = await Promise.all([
    fs.readFile(new URL('../examples/construct/MiniGameApiSuite.c3p', import.meta.url)),
    fs.readFile(new URL('../examples/construct/assets/render-test.png', import.meta.url))
  ]);
  const archive = unzipSync(projectBytes);
  const project = JSON.parse(strFromU8(archive['project.c3proj']));
  const sprite = JSON.parse(strFromU8(archive['objectTypes\\RenderTestSprite.json']));
  const layout = JSON.parse(strFromU8(archive['layouts\\Layout 1.json']));
  assert.equal(strFromU8(archive['scripts\\main.js']), script, 'Construct export must use the current script');
  assert.deepEqual(Buffer.from(archive['files\\render-test.png']), image, 'the generated image is packaged without alteration');
  assert.ok(project.rootFileFolders.general.items.some(file => file.name === 'render-test.png'));
  assert.ok(project.usedAddons.some(addon => addon.id === 'Sprite'));
  assert.equal(sprite['plugin-id'], 'Sprite');
  assert.ok(Object.keys(archive).some(name => name.startsWith('images\\rendertestsprite-')));
  const instance = layout.layers.flatMap(layer => layer.instances).find(value => value.type === 'RenderTestSprite');
  assert.equal(instance.properties['initially-visible'], false);
  assert.equal(instance.properties['enable-collisions'], false);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
const settle = () => new Promise(resolve => setImmediate(resolve));

function demo({fetchBlob = async () => ({size: 100}), replace = async () => {}, imageSize = [1254, 1254]} = {}) {
  const events = new Map(), sprites = [], assets = [];
  const bridge = {isReady: () => true, init: async () => {}, getPlatform: () => 'tiktok', getAPISync: () => ({windowWidth: 390, windowHeight: 844})};
  const runtime = {
    layout: {getLayer: () => ({index: 0, getViewport: () => ({left: 0, top: 0, width: 390, height: 844}), cssPxToLayer: (x, y) => [x, y]})},
    objects: {
      MiniGameBridge: {getFirstInstance: () => bridge},
      Text: {instances: () => [], createInstance: () => ({destroy() {}})},
      RenderTestSprite: {createInstance() {
        const sprite = {isVisible: false, destroyed: 0, stopAnimation() {},
          getImageSize: () => imageSize,
          replaceCurrentAnimationFrame: blob => replace(blob),
          destroy() { this.destroyed++; this.isVisible = false; }};
        sprites.push(sprite); return sprite;
      }}
    },
    assets: {fetchBlob(path) { assets.push(path); return fetchBlob(path); }},
    addEventListener(name, callback) { const list = events.get(name) || []; list.push(callback); events.set(name, list); },
    removeEventListener(name, callback) { events.set(name, (events.get(name) || []).filter(value => value !== callback)); }
  };
  const context = vm.createContext({console, setTimeout, clearTimeout, TTMinis: {game: {}}, runOnStartup: callback => callback(runtime)});
  vm.runInContext(script, context);
  const fire = (name, value) => { for (const callback of events.get(name) || []) callback(value); };
  fire('beforeprojectstart');
  function click(id) {
    const row = context.__C3ApiDemo.getSnapshot().rows.find(value => value.id === id);
    assert.ok(row?.visible, `row ${id} must be visible to click`);
    const event = {clientX: row.bounds.x + 20, clientY: row.bounds.y + 20, pointerId: 1, pointerType: 'touch', button: 0};
    fire('pointerdown', event); fire('pointerup', event);
  }
  return {runtime, context, sprites, assets, click, fire, snapshot: () => context.__C3ApiDemo.getSnapshot()};
}

test('Construct image demo uses project assets and Sprite, fits the image, then releases it on return', async () => {
  const f = demo({imageSize: [1200, 800]});
  await settle();
  assert.equal(f.sprites.length, 0, 'category list does not eagerly load an image');
  f.click('category-0'); await settle();
  f.click('render-image'); await settle();
  assert.deepEqual(f.assets, ['render-test.png']);
  const image = f.snapshot().renderImage;
  assert.equal(image.ready, true); assert.equal(image.visible, true);
  assert.equal(image.bounds.width / image.bounds.height, 1.5);
  assert.ok(image.bounds.x >= 16 && image.bounds.x + image.bounds.width <= 374);
  const row = f.snapshot().rows.find(value => value.id === 'render-image');
  assert.ok(image.bounds.y > row.bounds.y + row.bounds.height, 'image has its own space below the button');
  f.click('back-0'); await settle();
  assert.equal(f.snapshot().renderImage, null); assert.equal(f.sprites[0].destroyed, 1);
  f.click('category-0'); await settle();
  f.click('render-image'); await settle();
  assert.equal(f.sprites.length, 2, 're-entering permits a fresh image load');
  f.click('render-image'); await settle();
  assert.equal(f.snapshot().renderImage, null); assert.equal(f.sprites[1].destroyed, 1);
  f.context.__C3ApiDemo.dispose();
});

test('Construct image demo reports load failure without displaying a stale Sprite', async () => {
  const f = demo({replace: async () => { throw new Error('image decode failed'); }});
  await settle(); f.click('category-0'); await settle(); f.click('render-image'); await settle();
  const row = f.snapshot().rows.find(value => value.id === 'render-image');
  assert.equal(row.kind, 'error'); assert.match(row.status, /image decode failed/);
  assert.equal(f.snapshot().renderImage, null); assert.equal(f.sprites[0].destroyed, 1);
  f.context.__C3ApiDemo.dispose();
});

test('returning during asynchronous frame replacement hides the Sprite and discards its late result', async () => {
  const frame = deferred();
  const f = demo({replace: () => frame.promise});
  await settle(); f.click('category-0'); await settle(); f.click('render-image'); await settle();
  assert.equal(f.sprites.length, 1); assert.equal(f.sprites[0].isVisible, false);
  f.click('back-0'); await settle();
  assert.equal(f.snapshot().renderImage, null); assert.equal(f.sprites[0].destroyed, 0, 'wait for the engine to finish replacing its frame');
  frame.resolve(); await settle();
  assert.equal(f.sprites[0].destroyed, 1); assert.equal(f.sprites[0].isVisible, false);
  assert.equal(f.snapshot().category, '选择功能分类');
  f.context.__C3ApiDemo.dispose();
});

test('repeated image clicks while loading share one operation and disposing the page discards the result', async () => {
  const frame = deferred();
  const f = demo({replace: () => frame.promise});
  await settle(); f.click('category-0'); await settle();
  f.click('render-image'); f.click('render-image'); await settle();
  assert.equal(f.assets.length, 1); assert.equal(f.sprites.length, 1);
  f.click('render-image'); await settle();
  assert.equal(f.assets.length, 1); assert.equal(f.sprites.length, 1);
  f.context.__C3ApiDemo.dispose();
  assert.equal(f.context.__C3ApiDemo, undefined); assert.equal(f.sprites[0].isVisible, false);
  frame.resolve(); await settle();
  assert.equal(f.sprites[0].destroyed, 1); assert.equal(f.sprites[0].isVisible, false);
});

test('leaving before the package file arrives creates no late Sprite and a missing asset reports failure', async () => {
  const file = deferred();
  const f = demo({fetchBlob: () => file.promise});
  await settle(); f.click('category-0'); await settle(); f.click('render-image'); await settle();
  f.click('back-0'); await settle();
  file.resolve({size: 100}); await settle();
  assert.equal(f.sprites.length, 0); assert.equal(f.snapshot().renderImage, null);
  f.context.__C3ApiDemo.dispose();

  const missing = demo({fetchBlob: async () => { throw new Error('render-test.png not found'); }});
  await settle(); missing.click('category-0'); await settle(); missing.click('render-image'); await settle();
  const row = missing.snapshot().rows.find(value => value.id === 'render-image');
  assert.equal(row.kind, 'error'); assert.match(row.status, /render-test.png not found/);
  assert.equal(missing.sprites.length, 0); assert.equal(missing.snapshot().renderImage, null);
  missing.context.__C3ApiDemo.dispose();
});

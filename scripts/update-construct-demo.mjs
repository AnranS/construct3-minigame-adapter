import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {unzipSync, zipSync, strFromU8, strToU8} from 'fflate';

// Update source project assets/scripts; Construct itself must still perform the
// HTML5 export. For first-time Sprite setup, supply a real editor-saved project:
// node scripts/update-construct-demo.mjs --sprite-template /path/to/template.c3p
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'examples/construct');
const projectPath = path.join(directory, 'MiniGameApiSuite.c3p');
const templateArg = process.argv.indexOf('--sprite-template');
const files = unzipSync(await fs.readFile(projectPath));
const readJSON = (archive, name) => JSON.parse(strFromU8(archive[name]));
const writeJSON = (name, value) => { files[name] = strToU8(JSON.stringify(value, null, '\t') + '\n'); };
const project = readJSON(files, 'project.c3proj');
const layout = readJSON(files, 'layouts\\Layout 1.json');
const objectPath = 'objectTypes\\RenderTestSprite.json';

if (!files[objectPath]) {
  if (templateArg < 0 || !process.argv[templateArg + 1]) throw new Error('First run requires --sprite-template with an editor-saved RenderTestSprite.');
  const template = unzipSync(await fs.readFile(path.resolve(process.argv[templateArg + 1])));
  if (!template[objectPath]) throw new Error('Template has no RenderTestSprite object.');
  const sprite = readJSON(template, objectPath);
  if (sprite['plugin-id'] !== 'Sprite') throw new Error('RenderTestSprite must use the built-in Sprite plugin.');
  files[objectPath] = template[objectPath];
  for (const [name, bytes] of Object.entries(template)) {
    if (name.toLowerCase().startsWith('images\\rendertestsprite-')) files[name] = bytes;
  }
  const templateLayout = readJSON(template, 'layouts\\Layout 1.json');
  const instance = templateLayout.layers.flatMap(layer => layer.instances).find(item => item.type === 'RenderTestSprite');
  if (!instance) throw new Error('Template requires one RenderTestSprite instance to preserve editor defaults.');
  layout.layers[0].instances.push(instance);
}
if (!project.objectTypes.items.includes('RenderTestSprite')) project.objectTypes.items.push('RenderTestSprite');
if (!project.usedAddons.some(addon => addon.type === 'plugin' && addon.id === 'Sprite')) {
  project.usedAddons.push({type: 'plugin', id: 'Sprite', name: 'Sprite', author: 'Scirra', bundled: false});
}
for (const instance of layout.layers.flatMap(layer => layer.instances)) {
  if (instance.type !== 'RenderTestSprite') continue;
  instance.properties['initially-visible'] = false;
  instance.properties['enable-collisions'] = false;
}

const image = await fs.readFile(path.join(directory, 'assets/render-test.png'));
if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || image.length < 24) throw new Error('render-test.png must be a real PNG file.');
const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
if (!width || !height) throw new Error('render-test.png has invalid dimensions.');
const generalFiles = project.rootFileFolders.general.items;
if (!generalFiles.some(file => file.name === 'render-test.png')) {
  generalFiles.push({name: 'render-test.png', type: 'image/png', sid: 700000000000002, 'file-info': {purpose: 'none'}});
}
files['files\\render-test.png'] = image;
files['scripts\\main.js'] = await fs.readFile(path.join(directory, 'api-demo-main.js'));
writeJSON('project.c3proj', project);
writeJSON('layouts\\Layout 1.json', layout);
const temporary = `${projectPath}.tmp`;
await fs.writeFile(temporary, zipSync(files, {level: 6}));
await fs.rename(temporary, projectPath);
console.log(`Updated MiniGameApiSuite.c3p: RenderTestSprite + render-test.png (${width} × ${height}) + current main.js. Export again in Construct.`);

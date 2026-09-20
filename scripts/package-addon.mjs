import { readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zipSync, unzipSync, strToU8 } from "fflate";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function packageAddon({ sourceDir = path.join(root, "addon"), outputFile = path.join(root, "dist", "C3MiniGameBridge.c3addon") } = {}) {
  const manifest = JSON.parse(await readFile(path.join(sourceDir, "addon.json"), "utf8"));
  if (manifest["is-c3-addon"] !== true || manifest["sdk-version"] !== 2 || manifest.id !== "C3MiniGameBridge")
    throw new Error("Expected the C3MiniGameBridge SDK v2 addon manifest.");
  const names = manifest["file-list"];
  if (!Array.isArray(names) || names.length !== new Set(names).size)
    throw new Error("The addon file-list must be an array of unique paths.");
  for (const required of ["addon.json", "aces.json", "lang/en-US.json", "icon.svg", "c3runtime/main.js", ...manifest["editor-scripts"]])
    if (!names.includes(required)) throw new Error(`Missing required addon file: ${required}`);
  const files = {};
  for (const name of names) {
    if (typeof name !== "string" || !name || path.isAbsolute(name) || name.includes("\\") || name.split("/").some(part => !part || part === "." || part === ".."))
      throw new Error(`Unsafe addon file-list path: ${name}`);
    const filename = path.join(sourceDir, name);
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Addon entry must be a regular file: ${name}`);
    let bytes = new Uint8Array(await readFile(filename));
    if (name.endsWith(".json")) {
      const json = JSON.parse(new TextDecoder().decode(bytes));
      delete json.$schema; // Development-only schema files are not part of the addon.
      bytes = strToU8(JSON.stringify(json, null, 2) + "\n");
    }
    files[name] = [bytes, { mtime: new Date("2020-01-01T00:00:00Z") }];
  }
  const zip = zipSync(files, { level: 9 });
  const verified = unzipSync(zip);
  if (Object.keys(verified).length !== names.length || !verified["addon.json"])
    throw new Error("Addon ZIP verification failed.");
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, zip);
  return { outputFile, fileCount: names.length, bytes: zip.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await packageAddon();
  console.log(`Packaged ${result.fileCount} files (${result.bytes} bytes): ${result.outputFile}`);
}

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
type ArchiveReader = {
  files(pattern?: string): Promise<Map<string, File>>;
};

type BunWithArchive = typeof Bun & {
  Archive: new (input: Blob | ArrayBuffer) => ArchiveReader;
};

const repositoryDirectory = resolve(import.meta.dir, "..");
const destination = resolve(repositoryDirectory, "dist");
const requestedArchive = process.argv[2];
const rootManifest = await Bun.file(join(repositoryDirectory, "package.json")).json() as { name?: string; version?: string };
const expectedArchiveName = rootManifest.name !== undefined && rootManifest.version !== undefined
  ? `${rootManifest.name}-${rootManifest.version}.tgz`
  : undefined;
const archivePath = requestedArchive === undefined
  ? join(destination, expectedArchiveName ?? ((await readdir(destination)).find(name => name.endsWith(".tgz")) ?? ""))
  : resolve(requestedArchive);

if (!archivePath || !(await Bun.file(archivePath).exists())) {
  throw new Error(`Packed archive not found: ${archivePath || destination}`);
}

const archive = new (Bun as BunWithArchive).Archive(await Bun.file(archivePath).arrayBuffer());
const files = await archive.files();
const paths = new Set(files.keys());
const packageManifestFile = files.get("package/package.json");
if (packageManifestFile === undefined) throw new Error("Archive is missing package/package.json");
const manifest = JSON.parse(await packageManifestFile.text()) as { files?: readonly string[] };

const required = [
  "package/package.json",
  "package/src/index.ts",
  "package/src/opencode/index.tsx",
  "package/src/ui/review-controller.ts",
  "package/src/opencode/files-route.tsx",
  "package/src/opencode/settings.ts",
  "package/src/opencode/selection.ts",
  "package/src/contracts.ts",
  "package/src/filesystem.ts",
  "package/src/review-source.ts",
  "package/src/highlight-theme.ts",
  "package/src/pi-settings.ts",
];
for (const path of required) {
  if (!paths.has(path)) throw new Error(`Archive is missing ${path}`);
}
for (const path of manifest.files ?? []) {
  const archivePath = `package/${path}`;
  if (!paths.has(archivePath)) throw new Error(`Manifest file is missing from archive: ${archivePath}`);
}
for (const path of paths) {
  if (/\.test\.(?:ts|tsx)$/.test(path) || path === "package/test/smoke-fixture.ts" || path.startsWith("package/test/")) {
    throw new Error(`Archive contains a test-only file: ${path}`);
  }
}

console.log(`Archive assertion passed: ${archivePath}`);
console.log(`Verified ${paths.size} archive entries and ${manifest.files?.length ?? 0} runtime files.`);

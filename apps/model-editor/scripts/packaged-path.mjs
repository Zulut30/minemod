import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
export async function packagedPath(repo, appDir) {
  const metadata = JSON.parse(
    await readFile(join(repo, "output/model-editor/latest-build.json"), "utf8"),
  );
  const manifest = JSON.parse(
    await readFile(join(appDir, "package.json"), "utf8"),
  );
  const target = resolve(metadata.executable);
  if (
    metadata.version !== manifest.version ||
    !target.startsWith(resolve(repo, "output/model-editor/releases") + sep)
  )
    throw new Error(
      "Latest package does not match current version or output root",
    );
  return target;
}

import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_LIMITS } from "@mcdev/contracts";
import { BuiltinPackIntegrityError } from "./index.ts";
import {
  readCompatibilityPackSnapshotAtRoot,
  type SnapshotPathEvent,
} from "./src/load-builtin.ts";

async function withTemporaryDirectory(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "mcdev-compatibility-pack-test-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function expectIntegrityFailure(
  operation: () => Promise<unknown>,
  message: string | RegExp,
): Promise<void> {
  await assert.rejects(
    operation,
    (error: unknown) => error instanceof BuiltinPackIntegrityError &&
      (typeof message === "string" ? error.message === message : message.test(error.message)),
  );
}

await withTemporaryDirectory(async (root) => {
  const payload = new Uint8Array(65_536 + 17);
  payload.fill(0x61);
  await writeFile(join(root, "file.txt"), payload);
  const chunks: number[] = [];
  const snapshot = await readCompatibilityPackSnapshotAtRoot(root, 1, {
    afterFileChunk: (event) => {
      chunks.push(event.bytesRead);
      assert.ok(event.bytesRead <= 65_536);
      assert.ok(event.totalBytes <= event.limit + 1);
    },
  });
  assert.equal(snapshot.length, 1);
  assert.deepEqual(snapshot[0]?.bytes, payload);
  assert.ok(chunks.length >= 2, "bounded chunk reader must split files larger than 64 KiB");
  assert.equal(chunks[0], 65_536);
});

await withTemporaryDirectory(async (base) => {
  const root = join(base, "root");
  await mkdir(root);
  await writeFile(join(base, "outside.txt"), "outside\n");
  await symlink(join(base, "outside.txt"), join(root, "link.txt"));
  await expectIntegrityFailure(
    () => readCompatibilityPackSnapshotAtRoot(root, 1),
    /symbolic link/u,
  );
});

await withTemporaryDirectory(async (base) => {
  const realRoot = join(base, "real-root");
  const linkRoot = join(base, "link-root");
  await mkdir(realRoot);
  await writeFile(join(realRoot, "file.txt"), "root\n");
  await symlink(realRoot, linkRoot);
  await expectIntegrityFailure(
    () => readCompatibilityPackSnapshotAtRoot(linkRoot, 1),
    /root.*real directory/u,
  );
});

await withTemporaryDirectory(async (base) => {
  const realParent = join(base, "real-parent");
  const root = join(realParent, "pack");
  const alias = join(base, "alias");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "file.txt"), "ancestor\n");
  await symlink(realParent, alias);
  await expectIntegrityFailure(
    () => readCompatibilityPackSnapshotAtRoot(join(alias, "pack"), 1),
    /symbolic-link path component/u,
  );
});

await withTemporaryDirectory(async (root) => {
  await writeFile(join(root, "File.txt"), "upper\n");
  await writeFile(join(root, "file.txt"), "lower\n");
  await expectIntegrityFailure(
    () => readCompatibilityPackSnapshotAtRoot(root, 2),
    /case-colliding/u,
  );
});

await withTemporaryDirectory(async (root) => {
  const manifest = join(root, "manifest.json");
  await writeFile(manifest, "{}");
  await truncate(manifest, CONTRACT_LIMITS.buildPlanBytes + 1);
  await expectIntegrityFailure(
    () => readCompatibilityPackSnapshotAtRoot(root, 1),
    "Built-in compatibility pack file is too large: manifest.json",
  );
});

await withTemporaryDirectory(async (root) => {
  const manifest = join(root, "manifest.json");
  await writeFile(manifest, "{}\n");
  let grew = false;
  let maximumObservedTotal = 0;
  await expectIntegrityFailure(
    () => readCompatibilityPackSnapshotAtRoot(root, 1, {
      afterFileChunk: async (event) => {
        maximumObservedTotal = Math.max(maximumObservedTotal, event.totalBytes);
        if (!grew) {
          grew = true;
          await truncate(manifest, CONTRACT_LIMITS.buildPlanBytes + 1);
        }
      },
    }),
    "Built-in compatibility pack file is too large: manifest.json",
  );
  assert.equal(maximumObservedTotal, CONTRACT_LIMITS.buildPlanBytes + 1);
});

await withTemporaryDirectory(async (root) => {
  const path = join(root, "file.txt");
  await writeFile(path, "identity\n");
  let mutated = false;
  await expectIntegrityFailure(
    () => readCompatibilityPackSnapshotAtRoot(root, 1, {
      beforeFilePostStat: async (event) => {
        if (!mutated && event.relativePath === "file.txt") {
          mutated = true;
          await rename(path, join(root, "old-file.txt"));
          await writeFile(path, "identity\n");
        }
      },
    }),
    "Built-in compatibility pack file changed while being read: file.txt",
  );
});

await withTemporaryDirectory(async (root) => {
  const child = join(root, "child");
  await mkdir(child);
  await writeFile(join(child, "file.txt"), "directory identity\n");
  let mutated = false;
  await expectIntegrityFailure(
    () => readCompatibilityPackSnapshotAtRoot(root, 2, {
      beforeDirectoryPostStat: async (event) => {
        if (!mutated && event.relativePath === "child") {
          mutated = true;
          await rename(child, join(root, "old-child"));
          await mkdir(child);
        }
      },
    }),
    "Built-in compatibility pack directory changed while being read: child",
  );
});

const throwingClose: (close: () => Promise<void>, event: SnapshotPathEvent) => Promise<void> = async (close) => {
  await close();
  throw new Error("injected close failure");
};

await withTemporaryDirectory(async (root) => {
  await writeFile(join(root, "file.txt"), "close\n");
  await expectIntegrityFailure(
    () => readCompatibilityPackSnapshotAtRoot(root, 1, { closeFile: throwingClose }),
    "Built-in compatibility pack file could not be closed safely: file.txt",
  );
});

await withTemporaryDirectory(async (root) => {
  const manifest = join(root, "manifest.json");
  await writeFile(manifest, "{}");
  await truncate(manifest, CONTRACT_LIMITS.buildPlanBytes + 1);
  await expectIntegrityFailure(
    () => readCompatibilityPackSnapshotAtRoot(root, 1, { closeFile: throwingClose }),
    "Built-in compatibility pack file is too large: manifest.json",
  );
});

await withTemporaryDirectory(async (root) => {
  await writeFile(join(root, "file.txt"), "directory close\n");
  await expectIntegrityFailure(
    () => readCompatibilityPackSnapshotAtRoot(root, 1, { closeDirectory: throwingClose }),
    "Built-in compatibility pack directory could not be closed safely: .",
  );
});

await withTemporaryDirectory(async (root) => {
  await writeFile(join(root, "File.txt"), "upper\n");
  await writeFile(join(root, "file.txt"), "lower\n");
  await expectIntegrityFailure(
    () => readCompatibilityPackSnapshotAtRoot(root, 2, { closeDirectory: throwingClose }),
    /case-colliding/u,
  );
});

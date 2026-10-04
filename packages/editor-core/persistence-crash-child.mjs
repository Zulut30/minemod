// Только дочерний процесс теста: остановка в реальной filesystem операции.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import process from "node:process";

const [path, source, phase] = process.argv.slice(2);
if (!path || !source || !["partial-write", "partial-backup", "before-replace"].includes(phase))
  throw new Error("Invalid fixed persistence crash test phase");
const pause = async () => {
  process.send({ phase });
  await new Promise(() => {});
};
const originalOpen = fs.promises.open;
fs.promises.open = async (...args) => {
  const file = await originalOpen(...args);
  const destination = String(args[0]);
  if (destination.startsWith(path + ".") && args[1] === "wx" &&
      ((phase === "partial-write" && destination.endsWith(".pending") && !destination.endsWith(".backup.pending")) ||
       (phase === "partial-backup" && destination.endsWith(".backup.pending")))) {
    const write = file.writeFile.bind(file);
    file.writeFile = async (contents) => {
      await write(contents.slice(0, Math.floor(contents.length / 2)), "utf8");
      await pause();
    };
  }
  return file;
};
const originalRename = fs.promises.rename;
fs.promises.rename = async (from, to) => {
  if (phase === "before-replace" && to === path) await pause();
  return originalRename(from, to);
};
syncBuiltinESMExports();
const { writeProject } = await import("../../apps/model-editor/worker/persistence.ts");
await writeProject(path, JSON.parse(await fs.promises.readFile(source, "utf8")));
throw new Error("Crash test did not reach its expected filesystem phase");

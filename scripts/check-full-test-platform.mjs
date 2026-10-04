import process from "node:process";

// Полный suite проверяет настоящие POSIX permissions и Linux-only build runner.
// На другой ОС нужен явно ограниченный portable suite, а не пропуск с общим PASS.
if (process.platform !== "linux" || process.arch !== "x64") {
  process.stderr.write(
    "FULL_TEST_SUITE_REQUIRES_LINUX_X64: полный suite требует Linux x64; " +
    "на Windows используйте corepack pnpm test:portable. " +
    "Portable PASS не подтверждает сборку JAR или запуск Minecraft.\n",
  );
  process.exitCode = 1;
}

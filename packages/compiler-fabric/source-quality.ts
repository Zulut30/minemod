import { fabricCompilerError } from "./errors.ts";

function fail(path: string, reason: string): never {
  throw fabricCompilerError("INTERNAL_ERROR", `Generated Java quality gate: ${reason}.`, path);
}

/** JLS 17 §3.3: переводим только допустимые Unicode escapes, без рекурсивного перевода. */
function unicodeInput(path: string, source: string): string {
  const result: string[] = [];
  let slashRun = 0, escapedLast = false;
  for (let i = 0; i < source.length; i++) {
    let character = source[i]!, translated = false;
    if (character === "\\" && (escapedLast || slashRun % 2 === 0) && source[i + 1] === "u") {
      let end = i + 1;
      while (source[end] === "u") end++;
      const digits = source.slice(end, end + 4);
      if (!/^[0-9a-fA-F]{4}$/u.test(digits)) fail(path, "invalid Unicode escape");
      character = String.fromCharCode(Number.parseInt(digits, 16));
      i = end + 3; translated = true;
    }
    result.push(character);
    slashRun = character === "\\" ? slashRun + 1 : 0;
    escapedLast = translated;
  }
  return result.join("");
}

/** Проверка принадлежащих компилятору исходников; синтаксис/поведение проверяет javac/runtime CI. */
export function assertGeneratedJavaQuality(path: string, raw: string): void {
  if (raw.includes("\r")) fail(path, "source must use LF");
  const source = unicodeInput(path, raw), code: string[] = [];
  for (let i = 0; i < source.length;) {
    if (source.startsWith("//", i) || source.startsWith("/*", i)) {
      const block = source[i + 1] === "*";
      const lineEnd = block ? -1 : source.slice(i + 2).search(/[\r\n]/u);
      const found = block ? source.indexOf("*/", i + 2) : lineEnd < 0 ? -1 : i + 2 + lineEnd;
      if (block && found < 0) fail(path, "unterminated comment");
      const end = found < 0 ? source.length : found + (block ? 2 : 0);
      if (/\b(?:TODO|FIXME|STUB|PLACEHOLDER)\b/iu.test(source.slice(i, end)))
        fail(path, "unfinished comment marker");
      code.push(" "); i = end; continue;
    }
    if (source[i] === '"' || source[i] === "'") {
      const delimiter = source.startsWith('"""', i) ? '"""' : source[i]!;
      i += delimiter.length;
      let closed = false;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source.startsWith(delimiter, i)) { i += delimiter.length; closed = true; break; }
        i++;
      }
      if (!closed) fail(path, "unterminated literal");
      code.push(" "); continue;
    }
    code.push(source[i]!); i++;
  }
  const tokens = code.join("");
  if (/\bthrow\s+new\s+(?:java\s*\.\s*lang\s*\.\s*)?UnsupportedOperationException\b/u.test(tokens))
    fail(path, "unsupported-operation stub");
  if (/\bnet\s*\.\s*(?:neoforged|minecraftforge)\s*\./u.test(tokens))
    fail(path, "foreign loader reference");
  if (path.startsWith("src/main/java/") && /\bnet\s*\.\s*minecraft\s*\.\s*client\s*\./u.test(tokens))
    fail(path, "Minecraft client type in common source set");
}

import assert from "node:assert/strict";
import process from "node:process";
import { assertGeneratedJavaQuality } from "./source-quality.ts";
import { FabricCompilerError } from "./errors.ts";

const common = "src/main/java/dev/mcdev/generated/GeneratedContent.java";
const client = "src/client/java/dev/mcdev/generated/GeneratedClient.java";
const allowed = [
  "class Content { int value() { return 17; } }\n",
  'class Content { String hint = "TODO STUB PLACEHOLDER // net.minecraft.client.Minecraft"; }\n',
  String.raw`class Content { String hint = "throw new UnsupportedOperationException(); /* TODO */"; }`,
  String.raw`class Content { String hint = "quote \" // TODO"; char slash = '/'; }`,
  'class Content { String hint = """\nTODO // net.minecraft.client.Minecraft\n"""; }\n',
  'class Content { String hint = """\n\\""" /* TODO */\n"""; }\n',
  String.raw`class Content { String literal = "\\u0054ODO"; }`,
  String.raw`class Content { String literal = "\u005c\u005cu0054ODO"; }`,
  String.raw`class Content { String literal = "\\\u0054ODO"; }`,
  "class Content { public Content() {} }\n",
  "class Content { Object tool = new PickaxeItem(tier, 1, speed, properties) {}; }\n",
  "// This belongs to the main source set.\nclass Content {}\n",
  "/* Documentation with quoted \"characters\". */\nclass Content {}\n",
  String.raw`// Untranslated \\u0054ODO` + "\nclass Content {}\n",
];
for (const source of allowed) assertGeneratedJavaQuality(common, source);
assertGeneratedJavaQuality(client, "import net.minecraft.client.Minecraft;\nclass Content {}\n");
const rejected = [
  "// TODO: finish registration\nclass Content {}\n",
  "// FIXME\nclass Content {}\n",
  "/* stub implementation */ class Content {}\n",
  "/* PLACEHOLDER */ class Content {}\n",
  "class Content { void register() { throw new UnsupportedOperationException(); } }\n",
  "class Content { void register() { throw /* owned marker */ new java.lang.UnsupportedOperationException(); } }\n",
  "import net.neoforged.neoforge.registries.DeferredRegister;\nclass Content {}\n",
  "import net.minecraftforge.registries.DeferredRegister;\nclass Content {}\n",
  "import net.minecraft.client.Minecraft;\nclass Content {}\n",
  "class Content { void run() { net.minecraft.client.Minecraft.getInstance(); } }\n",
  "class Content {}\r\n",
  'class Content { String value = "unfinished; }',
  "class Content { char value = 'unfinished; }",
  'class Content { String value = """unfinished; }',
  "/* unfinished comment",
  String.raw`// \u0054ODO` + "\nclass Content {}\n",
  String.raw`\u002f\u002f TODO` + "\nclass Content {}\n",
  String.raw`class Content { void run() { throw new \u0055nsupportedOperationException(); } }`,
  String.raw`// \uuuu0054ODO` + "\nclass Content {}\n",
  String.raw`class Content { \u000a net.minecraft.client.Minecraft value; }`,
  String.raw`// Documentation \u000d class Content { net.minecraft.client.Minecraft value; }`,
  String.raw`// \uXX00 invalid Unicode escape` + "\nclass Content {}\n",
];
for (const source of rejected) assert.throws(() => assertGeneratedJavaQuality(common, source), (error) => {
  assert(error instanceof FabricCompilerError);
  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.errors[0]!.path, common);
  assert(error.message.startsWith("Generated Java quality gate:"));
  return true;
});
process.stdout.write(`Generated Java quality: ${allowed.length + 1} literal/comment/source-set cases, ${rejected.length} rejected markers/stubs/Unicode/client/loader cases PASS\n`);

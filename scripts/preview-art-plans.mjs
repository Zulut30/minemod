import { createHash } from "node:crypto";
import process from "node:process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createArtPlan } from "../packages/validation/index.ts";
import { ArtSpecJsonSchema, ArtSpecV1JsonSchema, ModelIntentJsonSchema } from "../packages/modspec/index.ts";

// Инструмент разработчика. Публичный CLI/MCP возвращает данные без записи файлов.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = resolve(root, "output/model-editor/art-plans-041");
const names = ["polar-cleaver", "polar-armor", "copper-masonry", "tide-altar", "tidecaller-crab", "leaf-sword"];
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const classes = { weapon: "Оружие", armor: "Броня", "building-block": "Строительный блок", "decorative-prop": "Декоративный блок", creature: "Существо" };
const axes = { width: "ширина", height: "высота", depth: "глубина" };
const cards = [], plans = [];
const hash = data => createHash("sha256").update(data).digest("hex");
mkdirSync(directory, { recursive: true });
for (const name of names) {
  const payload = readFileSync(resolve(root, `fixtures/art/${name}.artspec-v1.json`), "utf8");
  const result = createArtPlan(payload);
  if (!result.valid || result.plan === undefined) throw new Error(`${name}: ${JSON.stringify(result.diagnostics)}`);
  const plan = result.plan, intent = plan.modelIntent;
  const json = JSON.stringify(plan, null, 2) + "\n";
  writeFileSync(resolve(directory, `${name}.plan.json`), json);
  plans.push({ name, sourceSha256: plan.sourceSha256, planSha256: hash(json), modelClass: intent.modelClass, status: plan.status });
  const parts = intent.parts.map(part => `<tr><td>${escape(part.label)}<small>${escape(part.id)} · ${escape(part.role)}</small></td><td>${escape(part.parent ?? "корень")}<small>×${part.instances} · ${escape(part.importance)}</small></td><td>${escape(part.materialRecipe)}<small>${escape(part.purpose)}</small></td></tr>`).join("");
  const ratios = intent.proportions.map(ratio => `<li><b>${escape(ratio.partId)} · ${axes[ratio.dimension]}</b> / ${escape(ratio.relativeTo)} · ${axes[ratio.relativeDimension]}: <b>${ratio.minimum}–${ratio.maximum}</b><small>${escape(ratio.reason)}</small></li>`).join("");
  const palette = plan.style.palette.map(color => `<span class="swatch" style="--color:${color}"><i></i>${escape(color)}</span>`).join("");
  const recipes = plan.style.materialRecipes.map(recipe => `<li><b>${escape(recipe.id)}</b> · ${escape(recipe.material)}<small>${escape(recipe.shadow)} → ${escape(recipe.base)} → ${escape(recipe.highlight)}</small>${escape(recipe.pattern)}</li>`).join("");
  const layout = plan.textureLayout.kind === "native-armor-layers" ? "Два native-слоя 64×32" : `Атлас ${plan.style.textureResolution}×${plan.style.textureResolution}`;
  cards.push(`<article id="${name}"><div class="eyebrow">${classes[intent.modelClass]} · ${escape(intent.symmetry)}</div><h2>${escape(plan.id)}</h2><p class="silhouette">${escape(intent.silhouette)}</p>${name === "leaf-sword" ? '<p class="notice">Выбрано только направление A. Объём v3c и будущая текстура ещё не приняты.</p>' : ""}
    <div class="facts"><span>${intent.bounds.width}×${intent.bounds.height}×${intent.bounds.depth} units · 16 units/block</span><span>${escape(layout)}</span><span>≤${plan.budgets.maxCubes} кубов · ≤${plan.budgets.maxBones} bones · ≤${plan.budgets.maxKeyframes} keys</span></div>
    <h3>Части и крепления</h3><div class="table-wrap"><table><thead><tr><th>Часть</th><th>Крепление</th><th>Материал и назначение</th></tr></thead><tbody>${parts}</tbody></table></div>
    <h3>Пропорции задания</h3><ul>${ratios}</ul><h3>Главные детали</h3><ul>${intent.features.map(feature => `<li><b>${escape(feature.label)}</b> · ${feature.readableAt.join("/")} px<small>${escape(feature.meaning)} · ${feature.partIds.map(escape).join(", ")}</small></li>`).join("")}</ul>
    <h3>Стиль и материалы</h3><p>${escape(plan.style.family)} · pixel density ${plan.style.texelDensity.pixelsPerBlock}/block ±${plan.style.texelDensity.tolerancePercent}% · noise ≤${plan.style.detail.maxNoisePercent}%</p><div class="palette">${palette}</div><ul>${recipes}</ul>
    <h3>Обязательные проверки после генерации</h3><p class="captures">${plan.requiredCaptures.map(context => `<span>${escape(context)}</span>`).join("")}</p><h3>Причины отклонения</h3><ul>${intent.reject.map(reason => `<li>${escape(reason)}</li>`).join("")}</ul>
    <footer>Требуется ${escape(intent.runtimeRequirement)}. Наличие runtime не подтверждено.<br>source SHA-256: <code>${plan.sourceSha256}</code><br><a href="${name}.plan.json">Полный plan JSON</a></footer></article>`);
}
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'"><title>MineMod — задания до генерации</title>
<style>:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#11151c;color:#dbe2ed}*{box-sizing:border-box}body{margin:0}main{max-width:1200px;padding:40px 28px;margin:auto}h1{font-size:34px;line-height:1.15;margin:8px 0 18px}h2{font-size:23px;margin:6px 0 16px;overflow-wrap:anywhere}h3{font-size:14px;color:#91a4bf;margin:28px 0 10px}p,li{line-height:1.6}header{max-width:920px;margin-bottom:28px}.eyebrow{color:#8daee0;font-size:12px;letter-spacing:.08em}nav{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0}a{color:#a8cafa}nav a,.captures span,.facts span{background:#202b3b;padding:6px 10px;border-radius:6px;font-size:12px;text-decoration:none}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start}article{background:#191f2a;border:1px solid #303c50;border-radius:16px;padding:26px}.silhouette{font-size:16px;color:#f0f4fa}.notice{padding:12px;border-left:3px solid #dbb66e;color:#dbc99f;background:#29271f}.facts,.palette,.captures{display:flex;gap:8px;flex-wrap:wrap}.swatch{font-size:11px;color:#a8b4c8;display:inline-flex;align-items:center;gap:5px}.swatch i{width:18px;height:18px;background:var(--color);border:1px solid #65748a;border-radius:4px}.table-wrap{overflow:auto}table{border-collapse:collapse;font-size:12px;width:100%}th{text-align:left;color:#8fa5c2;font-weight:500}td,th{padding:10px 8px;border-bottom:1px solid #303a4a;vertical-align:top}small{display:block;color:#9aaac0;font-size:11px;line-height:1.6;margin:4px 0}ul{padding-left:19px}li{font-size:13px;margin:8px 0}footer{border-top:1px solid #334052;margin-top:24px;padding-top:16px;color:#8e9fb7;font-size:11px;line-height:1.7}code{overflow-wrap:anywhere}@media(max-width:850px){.grid{grid-template-columns:1fr}main{padding:24px 14px}article{padding:20px}}</style>
<main><header><div class="eyebrow">MINEMOD · ARTSPEC V1</div><h1>Задания до генерации</h1><p>Пять классов моделей и отдельное направление меча «Лист». Части, отношения размеров и материалы получены из одного проверенного ArtSpec.</p><p class="notice">Валиден контракт задания. Генерация, artistic review, игровой runtime и интеграция assets в JAR здесь не выполнялись.</p></header><nav>${names.map(name => `<a href="#${name}">${escape(name)}</a>`).join("")}</nav><div class="grid">${cards.join("\n")}</div></main></html>`;
writeFileSync(resolve(directory, "index.html"), html);
for (const [name, schema] of [["artspec-v0", ArtSpecJsonSchema], ["artspec-v1", ArtSpecV1JsonSchema], ["model-intent-v1", ModelIntentJsonSchema]]) {
  writeFileSync(resolve(directory, `${name}.schema.json`), JSON.stringify(schema, null, 2) + "\n");
}
writeFileSync(resolve(directory, "report.json"), JSON.stringify({ status: "PASS", specificationOnly: true, htmlSha256: hash(html), plans }, null, 2) + "\n");
process.stdout.write(`Validated ${plans.length} pre-generation plans: ${resolve(directory, "index.html")}\n`);

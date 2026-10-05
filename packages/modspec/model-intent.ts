import {z} from "zod";

// Декларативное задание; соответствие фактической геометрии проверяется отдельно.
const partId=z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);
// Явные BMP диапазоны одинаково ограничивают scalar values в Zod и JSON Schema.
const bmpScalarPattern="^[\\u0000-\\uD7FF\\uE000-\\uFFFF]*$";
const text=(maximum:number)=>z.string().min(1).max(maximum).regex(new RegExp(bmpScalarPattern)).regex(/\S/u);
const dimension=z.enum(["width","height","depth"]);
const ratio=z.number().finite().min(0.01).max(16);
export const MODEL_INTENT_SCHEMA_ID="https://mcdev.local/schemas/model-intent-v1.json";
export const MODEL_CLASSES=["weapon","armor","building-block","decorative-prop","creature"] as const;
const PartSchema=z.strictObject({
  id:partId, label:text(80),
  role:z.enum(["blade","head","handle","guard","pommel","helmet","chest","legs","boots","surface","base","focal","body","limb","face","accent","other"]),
  parent:partId.nullable(), instances:z.number().int().min(1).max(64),
  importance:z.enum(["primary","secondary","accent"]),
  materialRecipe:text(193), purpose:text(200),
});
export const ModelIntentSchema=z.strictObject({
  schemaVersion:z.literal(1),kind:z.literal("mcdev-model-intent"),modelClass:z.enum(MODEL_CLASSES),
  runtimeRequirement:z.enum(["native-held-item","native-wearable-layers","native-block-model","animated-companion"]),
  silhouette:text(240),symmetry:z.enum(["bilateral","radial","asymmetric"]),
  modelUnitsPerBlock:z.literal(16),
  bounds:z.strictObject({width:z.number().finite().positive().max(64),height:z.number().finite().positive().max(64),depth:z.number().finite().positive().max(64)}),
  parts:z.array(PartSchema).min(1).max(32),
  proportions:z.array(z.strictObject({
    partId,dimension,relativeTo:partId.or(z.literal("whole")),relativeDimension:dimension,
    minimum:ratio,maximum:ratio,reason:text(200),
  })).min(1).max(32),
  features:z.array(z.strictObject({
    label:text(80),partIds:z.array(partId).min(1).max(8),meaning:text(200),
    readableAt:z.array(z.union([z.literal(32),z.literal(64)])).min(1).max(2),
  })).min(1).max(8),
  reject:z.array(text(200)).min(1).max(8),
}).superRefine((value,context)=>{
  const fail=(path:(string|number)[],message:string)=>context.addIssue({code:"custom",path,message});
  const ids=new Set<string>();
  value.parts.forEach((part,index)=>{
    if(part.id==="whole"||ids.has(part.id))fail(["parts",index,"id"],"ID части должен быть уникальным; whole зарезервирован для всей модели.");
    ids.add(part.id);
  });
  value.parts.forEach((part,index)=>{
    if(part.parent!==null&&(!ids.has(part.parent)||part.parent===part.id))fail(["parts",index,"parent"],"Крепление должно ссылаться на другую существующую часть.");
    const chain=new Set<string>();let current:typeof part|undefined=part;
    while(current){
      if(chain.has(current.id)){fail(["parts",index,"parent"],"Крепления частей не должны образовывать цикл.");break;}
      chain.add(current.id);current=current.parent===null?undefined:value.parts.find(p=>p.id===current!.parent);
    }
  });
  if(!value.parts.some(part=>part.importance==="primary"))fail(["parts"],"Укажите главный объём модели.");
  if(["weapon","decorative-prop","creature"].includes(value.modelClass)&&value.parts.filter(part=>part.parent===null).length!==1)
    fail(["parts"],"Части этого класса должны иметь одно связное дерево креплений.");
  const proportionKeys=new Set<string>();
  value.proportions.forEach((proportion,index)=>{
    const key=JSON.stringify([proportion.partId,proportion.dimension,proportion.relativeTo,proportion.relativeDimension]);
    if(proportionKeys.has(key))fail(["proportions",index],"Одно отношение размеров нельзя объявлять дважды.");
    proportionKeys.add(key);
    if(!ids.has(proportion.partId))fail(["proportions",index,"partId"],"Измеряемая часть отсутствует.");
    if(proportion.relativeTo!=="whole"&&!ids.has(proportion.relativeTo))fail(["proportions",index,"relativeTo"],"Опорная часть отсутствует.");
    if(proportion.minimum>proportion.maximum)fail(["proportions",index,"minimum"],"Нижняя граница отношения больше верхней.");
    if(proportion.dimension===proportion.relativeDimension&&proportion.relativeTo==="whole"&&proportion.maximum>1)
      fail(["proportions",index,"maximum"],"Размер части не может превышать полный габарит модели по той же оси.");
    if(proportion.partId===proportion.relativeTo&&proportion.dimension===proportion.relativeDimension&&(proportion.minimum>1||proportion.maximum<1))
      fail(["proportions",index,"minimum"],"Отношение размера к самому себе равно 1.");
  });
  value.features.forEach((feature,index)=>{
    if(new Set(feature.partIds).size!==feature.partIds.length)fail(["features",index,"partIds"],"Части акцента не должны повторяться.");
    feature.partIds.forEach((id,partIndex)=>{if(!ids.has(id))fail(["features",index,"partIds",partIndex],"Часть акцента отсутствует.");});
    if(new Set(feature.readableAt).size!==feature.readableAt.length)fail(["features",index,"readableAt"],"Масштабы review не должны повторяться.");
  });
  const roles=new Set(value.parts.map(part=>part.role));
  const required={weapon:["handle"],armor:["helmet","chest","legs","boots"],"building-block":["surface"],"decorative-prop":["base","focal"],creature:["body"]} as const;
  for(const role of required[value.modelClass])if(!roles.has(role))fail(["parts"],`Класс ${value.modelClass} требует роль ${role}.`);
  if(value.modelClass==="weapon"&&!roles.has("blade")&&!roles.has("head"))fail(["parts"],"Оружию требуется клинок или рабочая головка.");
  const runtime={weapon:"native-held-item",armor:"native-wearable-layers","building-block":"native-block-model","decorative-prop":"native-block-model",creature:"animated-companion"} as const;
  if(value.runtimeRequirement!==runtime[value.modelClass])fail(["runtimeRequirement"],"Класс модели не соответствует требуемому runtime. Это не проверка наличия exporter.");
});
export type ModelIntent=z.infer<typeof ModelIntentSchema>;
// JSON Schema описывает форму; ссылки, циклы и отношения проверяет runtime schema.
export const ModelIntentJsonSchema=Object.freeze({...z.toJSONSchema(ModelIntentSchema,{io:"input",target:"draft-2020-12"}),$id:MODEL_INTENT_SCHEMA_ID});

import assert from "node:assert/strict";
import process from "node:process";
import {MODEL_CLASSES,ModelIntentSchema,ModelIntentJsonSchema,MODEL_INTENT_SCHEMA_ID} from "./model-intent.ts";
const leaf={schemaVersion:1,kind:"mcdev-model-intent",modelClass:"weapon",runtimeRequirement:"native-held-item",
  modelUnitsPerBlock:16,bounds:{width:8,height:24,depth:3},
  silhouette:"Симметричный меч Лист: широкий центральный клинок, собранная гарда и видимое крепление рукояти.",symmetry:"bilateral",
  parts:[{id:"blade",label:"Клинок",role:"blade",parent:null,instances:1,importance:"primary",materialRecipe:"minemod:steel",purpose:"Читаемая листовидная масса"},
    {id:"handle",label:"Рукоять",role:"handle",parent:"blade",instances:1,importance:"secondary",materialRecipe:"minemod:leather",purpose:"Хват и соединение с клинком"}],
  proportions:[{partId:"blade",dimension:"height",relativeTo:"whole",relativeDimension:"height",minimum:0.62,maximum:0.76,reason:"Пропорция конкретного брифа; не универсальная оценка красоты"}],
  features:[{label:"Широкий центральный клинок",partIds:["blade"],meaning:"Главный акцент силуэта",readableAt:[32,64]}],reject:["Плоская необработанная обратная сторона"]};
assert(ModelIntentSchema.safeParse(leaf).success);
assert.equal(ModelIntentJsonSchema.additionalProperties,false);
assert.equal(ModelIntentJsonSchema.$id,MODEL_INTENT_SCHEMA_ID);
const properties=ModelIntentJsonSchema.properties as Record<string,{maxItems?:number}>;
assert.equal(properties.parts!.maxItems,32);assert.equal(properties.proportions!.maxItems,32);assert.equal(properties.features!.maxItems,8);
const reject=(change:(draft:typeof leaf)=>void)=>{const draft=structuredClone(leaf);change(draft);assert(!ModelIntentSchema.safeParse(draft).success);};
reject(d=>{d.parts[1]!.id="blade";});
reject(d=>{d.parts[0]!.id="whole";});
reject(d=>{d.parts[1]!.parent="missing";});
reject(d=>{d.parts[0]!.parent="handle";});
reject(d=>{d.parts[1]!.parent="handle";});
reject(d=>{d.parts[1]!.parent=null;});
reject(d=>{d.proportions.push(structuredClone(d.proportions[0]!));});
reject(d=>{d.proportions[0]!.partId="missing";});
reject(d=>{d.proportions[0]!.relativeTo="missing";});
reject(d=>{d.proportions[0]!.minimum=0.9;});
reject(d=>{d.proportions[0]!.maximum=Infinity;});
reject(d=>{d.proportions[0]!.maximum=1.1;});
reject(d=>{d.proportions[0]!.relativeTo="blade";});
reject(d=>{d.features[0]!.partIds=["missing"];});
reject(d=>{d.features[0]!.partIds=["blade","blade"];});
reject(d=>{d.features[0]!.readableAt=[32,32];});
reject(d=>{d.modelClass="armor";});
reject(d=>{d.runtimeRequirement="native-block-model";});
reject(d=>{d.parts=d.parts.filter(p=>p.role!=="handle");});
reject(d=>{d.parts=d.parts.map(p=>({...p,importance:"secondary"}));});
assert(!ModelIntentSchema.safeParse({...leaf,schemaVersion:2}).success);
assert(!ModelIntentSchema.safeParse({...leaf,shell:"arbitrary"}).success);
for(const modelClass of MODEL_CLASSES){
  const roles={weapon:["blade","handle"],armor:["helmet","chest","legs","boots"],"building-block":["surface"],"decorative-prop":["base","focal"],creature:["body","limb","face"]}[modelClass]!;
  const runtime={weapon:"native-held-item",armor:"native-wearable-layers","building-block":"native-block-model","decorative-prop":"native-block-model",creature:"animated-companion"}[modelClass]!;
  const parts=roles.map((role,index)=>({...leaf.parts[0],id:role,role,label:role,parent:index===0?null:roles[0],importance:index===0?"primary":"secondary"}));
  const intent={...leaf,modelClass,runtimeRequirement:runtime,parts,
    proportions:[{...leaf.proportions[0],partId:roles[0]}],features:[{...leaf.features[0],partIds:[roles[0]]}]};
  assert(ModelIntentSchema.safeParse(intent).success,modelClass);
}
process.stdout.write("Model intent: named parts, ratio bounds, attachment cycles, reference roles, unknown schema, class/runtime separation and bounded JSON Schema PASS\n");

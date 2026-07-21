# Minecraft AI Mod Studio

## Research и план первого MVP

Дата исследования: 20 июля 2026 года.

Цель продукта: дать Codex, Claude Code и другим агентам единый набор безопасных инструментов, который превращает продуктовый промпт в качественный, протестированный и упакованный Minecraft-мод — вместе с кодом, интерфейсом, моделями, текстурами, анимациями, интеграциями и release-артефактами.

---

## 1. Короткий вывод

Идея реалистична, но только если строить продукт не как «LLM пишет весь мод с нуля», а как компилятор с агентным управлением:

1. Агент превращает запрос пользователя в строгий ModSpec.
2. Валидатор проверяет версию Minecraft, загрузчик, зависимости, игровые ограничения и бюджет ассетов.
3. Детерминированные генераторы выпускают проект, регистрации, data generation, ресурсы, интеграции и тесты.
4. Отдельный asset-пайплайн создаёт концепт, blockout, UV, пиксельную текстуру, rig и анимации.
5. Сборка, GameTest, dedicated-server smoke test и визуальный QA дают доказательства готовности.
6. Только после прохождения quality gates инструмент собирает JAR, sources JAR, документацию, license/provenance manifest и release bundle.

Главная продуктовая рекомендация:

- Первый production-профиль: NeoForge для Minecraft 26.1.2, Java 25, Gradle/ModDevGradle, GeckoLib, опциональные JEI и Jade.
- Последняя стабильная версия самой игры на дату исследования — Minecraft Java 26.2, выпущенная 16 июня 2026 года. Но экосистема загрузчиков и библиотек обновляется не синхронно: Forge 26.2 уже опубликован, Fabric 26.2 документирован, а NeoForge 26.2 ещё активно портируется. Поэтому версия должна быть не захардкожена в ядре, а поставляться как проверяемый compatibility pack. Источники: [Minecraft Java 26.2](https://www.minecraft.net/en-us/article/minecraft-java-edition-26-2), [Fabric 26.2](https://fabricmc.net/2026/06/15/262.html), [Forge 26.2 downloads](https://files.minecraftforge.net/net/minecraftforge/forge/index_26.2.html), [NeoForge project activity](https://projects.neoforged.net/neoforged/neoforge).
- Fabric становится вторым codegen-адаптером.
- Forge — третьим отдельным адаптером, а не псевдонимом NeoForge.
- Paper — отдельным классом продукта после модов: серверный плагин не может сам по себе добавить клиенту полноценную новую сущность, модель и рендер без resource pack или клиентского мода.

Первый вертикальный demo-мод должен быть не кораблём с полной физикой. Это слишком рискованный MVP. Лучший тест — призываемое анимированное существо-компаньон с предметом, ритуалом, экраном настройки, Jade-подсказкой, JEI-категорией, моделью, уникальной текстурой, несколькими анимациями, GameTests и готовым JAR. Корабль следует использовать как отдельный asset benchmark, а физические собираемые корабли — как поздний адаптер Valkyrien Skies.

---

## 2. Что означает «от промпта до production»

Production в этом проекте — не факт успешного запуска Gradle. Результат должен включать:

- исходный продуктовый brief;
- нормализованный ModSpec;
- воспроизводимый проект с lock-файлом версий;
- исходный код без незавершённых TODO и заглушек;
- data-generated JSON, локализации и теги;
- редактируемые исходники ассетов;
- runtime-модели, текстуры и анимации;
- тесты и отчёты о них;
- client и dedicated-server smoke checks;
- проверки с установленными и отсутствующими optional-модами;
- отчёт визуального QA со скриншотами/turntable;
- JAR, sources JAR, README, CHANGELOG, LICENSE и THIRD_PARTY_NOTICES;
- asset provenance: промпт, seed, провайдер/модель, хэши, лицензии источников;
- SBOM или как минимум dependency manifest;
- готовую, но не автоматически опубликованную release-папку.

Автопубликация в Modrinth/CurseForge не должна быть включена по умолчанию. Публикация — отдельная операция с явным подтверждением пользователя и отдельными credentials.

---

## 3. Метод исследования и его границы

Фраза «изучить все моды» буквально невыполнима: существуют десятки тысяч проектов, множество закрытых исходников и большое количество несовместимых веток Minecraft. Практически полезный подход:

- официальная документация Minecraft, Fabric, NeoForge, Forge, Paper и MCP;
- актуальные ветки репрезентативных production-проектов;
- открытые API и реальные точки интеграции;
- разбор архитектурных паттернов, а не копирование кода или ассетов;
- отдельная проверка лицензий: публичный GitHub-репозиторий не всегда означает разрешение коммерческого переиспользования.

Локально были проверены структура и ключевые интерфейсы следующих кодовых баз:

- MultiLoader Template;
- Occultism;
- JEI;
- Jade;
- GeckoLib;
- Accessories;
- Valkyrien Skies 2;
- Figura;
- Blockbench MCP Plugin.

Документация загрузчиков дополнительно сверялась через Context7. Версии быстро меняются, поэтому будущий продукт обязан разрешать и фиксировать их автоматически, а не полагаться на знания LLM.

---

## 4. Карта платформ и целевых версий

### 4.1. Minecraft 26.1 и 26.2

С Minecraft 26.1 Mojang отказалась от обфускации Java Edition. Это заметно снижает стоимость генерации и поддержки кода: официальные имена классов, методов и параметров становятся доступнее, а перенос между инструментами проще. Источник: [официальное объявление Mojang об отказе от обфускации](https://www.minecraft.net/en-us/article/removing-obfuscation-in-java-edition).

Minecraft 26.2 добавил экспериментальный Vulkan backend. Fabric отдельно предупреждает разработчиков, что raw OpenGL-вызовы нужно убирать в пользу Blaze3D, иначе моды сломаются после отказа от OpenGL. Для генератора это означает строгий запрет на необязательные прямые OpenGL-вызовы и version-aware rendering templates. Источник: [Fabric for Minecraft 26.2](https://fabricmc.net/2026/06/15/262.html).

### 4.2. Fabric

Сильные стороны:

- быстрый и сравнительно небольшой loader;
- зрелые Fabric API, Loom и Mixin;
- хорошая документация регистрации, data generation, GUI, networking и GameTest;
- сильная клиентская экосистема;
- быстрая поддержка свежих версий.

Для 26.2 Fabric рекомендует Loom 1.17, Gradle 9.5.1 и актуальный стабильный Fabric Loader. Эти числа нельзя навечно вшивать в продукт — compatibility pack должен разрешать их из доверенных metadata и затем фиксировать. Источники: [Fabric 26.2](https://fabricmc.net/2026/06/15/262.html), [Fabric developer documentation](https://docs.fabricmc.net/develop/), [fabric.mod.json](https://docs.fabricmc.net/develop/loader/fabric-mod-json).

Риски:

- некоторые возможности реализуются через Fabric API или Mixin и не имеют прямого аналога на NeoForge/Forge;
- client rendering меняется быстро;
- необдуманный общий слой легко превращается в набор platform conditionals.

### 4.3. NeoForge

Сильные стороны:

- богатый API событий, регистраций, capabilities/data attachments, networking и data generation;
- ModDevGradle с run-конфигурациями, unit tests, GameTest и CI;
- сильная экосистема больших content-модов;
- удобная база для production-first вертикального MVP.

Для Minecraft 26.1 NeoForge перешёл на Java 25 и Gradle 9.1+, а также использует официальные unobfuscated names. Источники: [NeoForge getting started](https://docs.neoforged.net/docs/gettingstarted/), [NeoForge 26.1 release notes](https://neoforged.net/news/26.1release/), [ModDevGradle](https://docs.neoforged.net/toolchain/docs/plugins/mdg/).

Риски:

- новые ветки некоторое время имеют суффикс beta и допускают breaking changes;
- NeoForge 26.2 на дату исследования ещё находится в активном процессе портирования;
- нельзя считать Forge и NeoForge одним target.

### 4.4. Forge

Forge остаётся самостоятельной платформой с большой исторической базой модов. На дату исследования опубликован Forge 65.0.4 для Minecraft 26.2. Источники: [Forge 26.2 downloads](https://files.minecraftforge.net/net/minecraftforge/forge/index_26.2.html), [Forge documentation](https://docs.minecraftforge.net/en/latest/gettingstarted/), [MinecraftForge repository](https://github.com/MinecraftForge/MinecraftForge).

Риски:

- отдельный Gradle/tooling stack;
- различия с NeoForge на уровне API и lifecycle увеличиваются;
- часть новых модов выбирает Fabric или NeoForge, поэтому матрицу зависимостей нужно проверять по реальным релизам.

Вывод: Forge должен получить собственный adapter pack и собственные fixtures. Генерация NeoForge-кода с заменой imports недостаточна.

### 4.5. Paper и серверные плагины

Paper нужен продукту, но не в первом MVP. Это другой контракт:

- серверный код;
- Bukkit/Paper API и lifecycle;
- resource pack через Adventure;
- display entities или vanilla entities вместо настоящего нового клиентского renderer;
- отдельные scheduler-правила для Folia.

Paper 26.x также использует Java 25. Экспериментальный paper-plugin.yml не следует делать базовым выбором; обычный plugin.yml надёжнее для первой версии. Источники: [Paper project setup](https://docs.papermc.io/paper/dev/project-setup/), [plugin lifecycle](https://docs.papermc.io/paper/dev/how-do-plugins-work/), [display entities](https://docs.papermc.io/paper/dev/display-entities/), [Adventure resource packs](https://docs.papermc.io/adventure/resource-pack/), [Folia support](https://docs.papermc.io/paper/dev/folia-support/).

### 4.6. Рекомендуемая матрица продукта

| Этап | Minecraft | Target | Статус |
|---|---:|---|---|
| MVP production pack | 26.1.2 | NeoForge | Полный quality gate |
| MVP preview pack | 26.2 | Fabric | Scaffold, простые элементы, build/test |
| После MVP | 26.2 | Fabric | Полная feature parity |
| После MVP | 26.2 | Forge | Отдельный adapter pack |
| После стабилизации | 26.2 | NeoForge | Перенос production pack |
| Позднее | 26.2 | Paper/Folia | Отдельный plugin product line |
| LTS при спросе | 1.21.1 | NeoForge/Fabric | Compatibility pack, не ядро |

Версионная стратегия:

- ядро не знает конкретных API загрузчика;
- каждый compatibility pack содержит version catalog, templates, schema migrations, known incompatibilities и test fixtures;
- pack имеет статус experimental, candidate или production;
- production означает, что эталонные проекты прошли полный CI и игровой smoke test;
- агент не имеет права молча менять версию Minecraft или loader.

---

## 5. Как устроены реальные моды: повторяемые паттерны

### 5.1. Multi-loader

Проверенный MultiLoader Template использует модули common, fabric и neoforge, а platform services изолирует через Java service loader. Общий код компилируется отдельно, loader-specific entrypoints, metadata, run tasks и data generation остаются в своих модулях. Репозиторий распространяется под CC0: [Jaredlll08/MultiLoader-Template](https://github.com/Jaredlll08/MultiLoader-Template).

Для нашего продукта есть два пути:

1. Генерировать один multi-loader monorepo.
2. Генерировать независимые порты из общего ModSpec.

Для MVP правильнее второй путь. Общий source set легко начинает протекать абстракциями одного loader в другой. ModSpec должен быть общим, а generated code — platform-native. Когда два адаптера стабилизируются, можно добавить multi-loader layout как export mode.

### 5.2. Регистрации и data generation

Надёжный content-мод разделяет:

- идентификаторы;
- регистрацию items, blocks, entities, menus, recipes и serializers;
- client-only registration;
- данные: recipes, loot tables, tags, models, blockstates, language;
- runtime-логику.

LLM часто смешивает всё в одном entrypoint, обращается к client-классам на сервере и вручную пишет несогласованные JSON. Генератор должен, напротив:

- иметь типизированный registry graph;
- генерировать идентификатор один раз;
- использовать data generation;
- проверять ссылки между кодом и ресурсами;
- запрещать client-only типы в common/server graph.

### 5.3. Сущности и призыв существ

Полноценная новая сущность включает не только EntityType:

- registration и размеры/hitbox;
- attributes;
- spawn/finalize lifecycle;
- synched entity data;
- сохранение/загрузка;
- AI goals и navigation;
- ownership/taming;
- network authority;
- renderer/model/texture;
- звуки, частицы и loot;
- spawn egg или другой способ получения;
- локализацию;
- тесты despawn, chunk unload, save/reload и multiplayer.

Occultism показывает сильный pattern для сложного призыва:

- ритуал представлен custom Recipe;
- Codec и StreamCodec сериализуют и синхронизируют данные;
- recipe хранит pentacle, ingredients, activation item, duration, sacrifice, entity type/tag, NBT, количество и дополнительные условия;
- runtime Ritual исполняет данные на сервере;
- отдельная JEI category визуализирует тот же recipe;
- data generator строит большой контентный набор через builder.

Это намного безопаснее, чем генерировать уникальный Java-класс на каждый ритуал. Источник: [Occultism](https://github.com/klikli-dev/occultism).

Рекомендуемый primitive нашего продукта: SummoningDefinition в ModSpec, который компилируется в:

- custom recipe JSON/codec data;
- проверяемый server-side runtime;
- altar/multiblock validator;
- particles/sound timeline;
- entity spawn policy;
- JEI visualization;
- GameTests для успешного и неуспешного ритуала.

Сервер обязан сам проверять ингредиенты, расстояние, cooldown, владельца, лимит сущностей и право выполнения. Клиент отправляет намерение, а не готовую сущность или произвольный NBT.

### 5.4. Анимации

GeckoLib — наиболее практичный стандарт для сложных blocky entity/item/block animations на Fabric, NeoForge и Forge. Он поддерживает animation controllers, triggerable animations, переходы, easing, sound keyframes, particle keyframes и custom instruction keyframes. Источники: [GeckoLib](https://github.com/bernie-g/geckolib), [GeckoLib wiki](https://wiki.geckolib.com/).

В ModSpec анимация должна описываться семантически:

- idle;
- walk;
- attack;
- summon;
- hurt;
- death;
- special ability.

Asset compiler переводит это в bone/keyframe data, а codegen связывает gameplay state с controller. Имена bones и animations проверяются схемой до запуска клиента.

### 5.5. Физические моды и корабли

Valkyrien Skies 2 — не просто renderer модели корабля. Он вводит ship world, transforms, физические тела, collision и интеграции с сущностями/рендером. Код разделён на common, Fabric и Forge; лицензия LGPL-3.0. Источник: [Valkyrien Skies 2](https://github.com/ValkyrienSkies/Valkyrien-Skies-2).

Eureka использует этот фундамент, чтобы собирать корабль из блоков; helm и другие блоки управляют силами и стабилизацией. Источник: [Eureka wiki](https://github.com/ValkyrienSkies/Eureka/wiki).

Критически важно различать три разных запроса пользователя:

| Запрос | Правильное представление |
|---|---|
| Декоративный корабль/предмет | Native JSON или GeckoLib model |
| Ездовой корабль как одна сущность | Entity + renderer + собственная простая кинематика |
| Корабль, собранный из блоков и физически движущийся | Structure/schematic + Valkyrien Skies/Eureka integration |

Генерация красивой 3D-модели не решает третью задачу. Для физического корабля asset pipeline должен создавать blueprint/structure, список функциональных блоков, центр массы и настройки forces, а не один тяжёлый mesh.

Полная интеграция Valkyrien Skies не входит в MVP. После MVP можно сделать отдельный VS adapter с ограниченным набором безопасных primitives: assemble structure, helm, seat, thruster/force component, buoyancy profile и physics tests.

### 5.6. Косметика и физика одежды

Accessories предоставляет data-driven слоты, vanity/cosmetic представление, renderer API и общую базу для Fabric/NeoForge. Проект имеет MIT-лицензию. Источники: [Accessories](https://github.com/wisp-forest/accessories), [Accessories developer docs](https://docs.wispforest.io/accessories/home).

Figura показывает сильную идею editable avatar package: Blockbench model, textures и sandboxed Lua behavior. Но текущий исходный код Figura распространяется по PolyForm Noncommercial, поэтому его нельзя просто встроить в коммерческий продукт. Источники: [Figura](https://github.com/FiguraMC/Figura), [Figura avatar documentation](https://docs.figuramc.org/start_here/Avatar).

Для нашего продукта косметика должна состоять из:

- accessory slot definition;
- anchor bone/model part;
- visual model и texture;
- visibility rules;
- optional vanity variant;
- simple secondary motion profile;
- fallback без Accessories;
- серверных правил equip/unequip и синхронизации.

Secondary motion в первом релизе лучше ограничить детерминированной spring-chain:

- 2–6 segments;
- stiffness, damping, gravity, wind response;
- maximum angle и collision off/body-plane approximation;
- fixed-step update;
- distance-based LOD;
- только client visual state, если он не влияет на gameplay.

Это покрывает хвосты, волосы, ленты и плащи без попытки сгенерировать универсальный cloth solver.

---

## 6. Интерфейсы модов

### 6.1. Базовая архитектура

Minecraft UI разделяется на:

- Screen — client UI;
- Menu/Container — server-authoritative inventory/state contract;
- packet/payload — ограниченное намерение пользователя;
- synchronized state/data slots;
- widgets, narration и focus navigation.

NeoForge документирует Screens и Menus отдельно; Fabric — custom screens, widgets и HUD. Источники: [NeoForge screens](https://docs.neoforged.net/docs/1.21.4/gui/screens/), [NeoForge menus](https://docs.neoforged.net/docs/1.21.3/gui/menus/), [Fabric custom screens](https://docs.fabricmc.net/develop/rendering/gui/custom-screens), [Fabric custom widgets](https://docs.fabricmc.net/develop/rendering/gui/custom-widgets).

Правила генератора UI:

- сервер остаётся источником истины;
- packet передаёт action id и минимальные аргументы;
- bounds, ownership и permissions повторно валидируются на сервере;
- texture panels используют 9-slice или масштабируемые части;
- интерфейс проверяется на нескольких GUI scales и разрешениях;
- обязательны keyboard focus, Escape/back, narration labels и читаемый contrast;
- никакого raw OpenGL;
- render API выбирается compatibility pack под конкретную версию.

### 6.2. Конфигурация

Для сложных игровых экранов следует генерировать native Screen/Menu. Для пользовательской настройки мода можно дать optional adapter к YACL, который поддерживает Fabric и NeoForge. Источник: [YetAnotherConfigLib documentation](https://docs.isxander.dev/yet-another-config-lib/installing-yacl).

YACL не должен быть обязательным runtime dependency, если мод способен работать с config file и командой. Интеграционный класс должен загружаться только при наличии зависимости.

### 6.3. Декларативные UI-библиотеки

owo-ui интересен как декларативный UI для Fabric, но не подходит как базовый cross-loader контракт. Источник: [owo-ui documentation](https://docs.wispforest.io/owo/ui/).

Вывод для MVP: собственная UI schema компилируется в platform-native Screen/Menu. Позднее один и тот же schema может иметь owo-ui renderer для Fabric.

---

## 7. Поддержка Jade, JEI, EMI и REI

### 7.1. JEI

JEI использует IModPlugin с аннотацией JeiPlugin. Через него мод регистрирует:

- custom ingredients/subtypes;
- recipe categories;
- recipes;
- recipe catalysts;
- recipe transfer handlers;
- GUI click/avoid areas;
- runtime callbacks.

На Fabric плагин дополнительно объявляется через entrypoint jei_mod_plugin. Реальный код JEI содержит common API, Fabric и NeoForge adapters и тесты поиска плагинов. Проект имеет MIT-лицензию. Источники: [JEI repository](https://github.com/mezz/JustEnoughItems), [JEI plugin guide](https://github.com/mezz/JustEnoughItems/wiki/Creating-Plugins-%5B1.13-and-Up%5D).

Генератор не должен создавать JEI category для каждой обычной shaped/shapeless/smelting recipe: vanilla-compatible recipes JEI обычно обнаруживает сам. Плагин нужен для:

- custom recipe type;
- нестандартного layout;
- catalysts;
- transfer logic;
- дополнительных click areas;
- нестандартных ingredients.

### 7.2. Jade

Jade использует WailaPlugin/IWailaPlugin. Общая регистрация добавляет server data providers, а client registration — component providers. StreamServerDataProvider позволяет безопасно синхронизировать именно те данные, которые нужны tooltip. На Fabric используется entrypoint jade. Источники: [Jade repository](https://github.com/Snownee/Jade), [Jade getting started](https://jademc.readthedocs.io/en/latest/plugins22/getting-started/), [Jade plugin configuration](https://jademc.readthedocs.io/en/latest/plugins22/plugin-config/).

Правильный generated pattern:

- server provider вычисляет только разрешённые данные;
- codec ограничивает размер;
- client component форматирует текст;
- provider получает стабильный ResourceLocation;
- пользователь автоматически может включать/выключать компонент;
- sensitive owner/private inventory data не отправляется без проверки.

### 7.3. EMI и REI

EMI имеет MIT-лицензию и multi-loader API: [EMI](https://github.com/emilyploszaj/emi). REI остаётся значимой Fabric-экосистемой.

Стратегия:

- MVP: JEI + Jade;
- после MVP: EMI;
- затем REI;
- внутренний RecipePresentationSpec не должен содержать классы JEI;
- каждый overlay adapter компилирует общие slots, roles, catalysts, progress, tooltips и transfer semantics в собственный API.

### 7.4. Безопасная optional-интеграция

Для каждого optional mod:

- compileOnly/API dependency;
- metadata dependency marked optional;
- platform-safe mod-loaded check;
- интеграционные классы изолированы;
- основной entrypoint не импортирует классы optional API;
- тестовый запуск без optional mod;
- тестовый запуск с ним;
- отдельный compatibility fixture на версию.

Это предотвращает типичную ошибку NoClassDefFoundError при отсутствии JEI/Jade.

---

## 8. Модели, текстуры и анимации: почему это отдельный продукт

### 8.1. Ограничения Minecraft-форматов

Обычные Java block/item model JSON хорошо подходят для кубоидов, но не являются универсальным сложным mesh-форматом. Forge рекомендует квадратные power-of-two textures; native block/item geometry в основном состоит из cuboid elements. Источник: [Forge models documentation](https://docs.minecraftforge.net/en/1.21.x/resources/client/models/).

Поэтому asset compiler должен выбирать runtime format:

| Asset kind | Editable source | Runtime output |
|---|---|---|
| 2D item | PNG/layer source | item texture + model JSON |
| Cuboid block/item | bbmodel + PNG | Java model JSON + textures |
| Animated entity/item/block | bbmodel + PNG | GeckoLib geo/animation JSON + textures |
| Static structure/ship | blueprint | NBT/schematic + palette manifest |
| Complex decorative mesh | blend/bbmodel | custom reviewed loader format |
| Paper cosmetic | source model | resource-pack model/display setup |

Blockbench .bbmodel нужно хранить как editable source, но не считать стабильным публичным interchange contract. Документация Blockbench прямо рекомендует custom format/plugin, когда внешний loader требует собственного формата. Источники: [Blockbench repository](https://github.com/JannisX11/blockbench), [.bbmodel format notes](https://www.blockbench.net/wiki/docs/bbmodel/), [Blockbench plugins](https://www.blockbench.net/wiki/docs/plugin/), [export formats](https://www.blockbench.net/wiki/guides/export-formats/).

### 8.2. Почему прямой text-to-texture не даёт production quality

Если попросить image model «нарисуй Minecraft texture atlas», часто возникают:

- несогласованные стороны;
- неправильный UV;
- лишняя детализация и antialiasing;
- шумные палитры;
- неверная ориентация света;
- швы;
- нечитабельность на реальном размере 16–64 px;
- красивый preview, который плохо выглядит в игре.

Правильный пайплайн разделяет художественное решение и техническую упаковку.

### 8.3. ArtSpec

Каждый проект получает ArtSpec:

- style family: vanilla+, painterly pixel, industrial, dark fantasy и т.д.;
- palette с целевым числом цветов;
- hue/value hierarchy;
- источник света и направление highlights;
- outline policy;
- texture resolutions по классам ассетов;
- texel density;
- saturation limits;
- noise/detail scale;
- metal/wood/cloth material recipes;
- silhouette language;
- список запрещённых визуальных клише;
- референсы, права и provenance;
- performance budgets: cubes, bones, triangles, keyframes, texture memory.

ArtSpec компилируется в machine-readable constraints и human-readable style sheet. Все новые ассеты проверяются относительно одной библиотеки, чтобы мод выглядел цельно.

### 8.4. Production asset loop

Рекомендуемый цикл:

1. Prompt decomposition: назначение, масштаб, gameplay readability, style.
2. Multi-view concept sheet: front/side/back/three-quarter, нейтральный фон.
3. Silhouette gate: проверка на 32–64 px и в типичной игровой дистанции.
4. Procedural blockout: кубоиды/voxels, правильные pivots и hierarchy.
5. Geometry refinement: фаски только там, где они реально читаются.
6. UV generation: без выхода за atlas, с padding и согласованной texel density.
7. Palette-constrained base texture.
8. Material pass: controlled highlights/shadows, wear и accents.
9. Rig: семантические bone names.
10. Animation pass: sparse keyframes и понятные poses.
11. Automatic validation.
12. Neutral turntable.
13. In-game screenshots при нескольких освещениях.
14. Visual critique agent.
15. Targeted repair, а не полная перегенерация.
16. Human approval gate по умолчанию.

Полностью автономный режим возможен как экспериментальный флаг, но обещание «quality» без review gate в первом релизе будет недостоверным.

### 8.5. Blockbench как основной Minecraft DCC

Blockbench уже умеет Java block/item models, modded entities, bones, animation timeline, texture painting, Java exports и glTF/OBJ. Он лучше Blender соответствует blocky art и Minecraft pivots.

Существует community Blockbench MCP Plugin, который демонстрирует, что агентное управление реально. В проверенной версии API было 106 tools: 39 stable и 67 experimental. Есть операции project, cubes, meshes, armature, animation, UV, paint, screenshots, validation и export. Источники: [Blockbench MCP Plugin](https://github.com/jasonjgardner/blockbench-mcp-plugin), [его API documentation](https://jasonjgardner.github.io/blockbench-mcp-plugin/).

Но проект имеет GPL-3.0, а большинство инструментов пока experimental. Поэтому есть три варианта:

1. Использовать его как отдельно устанавливаемый optional external tool, соблюдая GPL.
2. Договориться с автором о другой лицензии.
3. Сделать clean-room узкий Blockbench bridge на официальном plugin API.

Для коммерческого MVP рекомендуется третий путь после юридической проверки, либо первый как prototype. Нельзя копировать GPL-код в закрытое ядро.

Узкий stable tool surface MVP:

- create/open project;
- create group/bone;
- place/modify cube;
- create/apply texture;
- set box UV;
- create animation;
- add simple keyframes;
- capture viewport screenshot;
- inspect outline/model stats;
- validate;
- export editable source and selected runtime codec.

Mesh editing, arbitrary code evaluation и сложная paint automation остаются experimental.

### 8.6. Blender

Blender нужен для:

- cleanup generic AI meshes;
- retopology/decimation;
- baking;
- complex rigging;
- turntable rendering;
- glTF conversion.

Он поддерживает headless/background command-line и Python automation: [Blender command-line documentation](https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html).

Но агенту нельзя давать raw arbitrary Python execution без sandbox. Нужен allowlisted worker:

- import;
- apply transform;
- decimate within budget;
- voxel remesh;
- generate LOD;
- UV unwrap;
- bake maps;
- export;
- render fixed camera set.

Community Blender MCP полезен как прототип, но raw code execution и network/telemetry требуют отдельного threat model. Источник: [Blender MCP](https://github.com/ahujasid/blender-mcp).

### 8.7. Генеративные 3D-модели

Доступные open/available approaches:

- Hunyuan3D 2.1: image-to-shape, PBR texturing, полный pipeline; геометрия требует около 10 GB VRAM, texture pipeline около 21 GB, полный запуск около 29 GB. Имеет собственную лицензию, которую нужно проверять для каждого сценария. Источник: [Hunyuan3D 2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1).
- TRELLIS: image-to-3D и structured latents; большая часть кода и models MIT, но отдельные submodules имеют свои лицензии. Источник: [Microsoft TRELLIS](https://github.com/microsoft/TRELLIS).
- Stable Fast 3D: быстрый image-to-3D, но community license имеет коммерческие условия и порог дохода; это нельзя скрывать от пользователя. Источники: [Stable Fast 3D](https://github.com/Stability-AI/stable-fast-3d), [Stability license](https://stability.ai/license).
- TripoSR: open image-to-3D research implementation. Источник: [TripoSR](https://github.com/VAST-AI-Research/TripoSR).

Общий вывод: generic AI mesh — источник blockout, а не готовый Minecraft asset. После него обязательны:

- silhouette cleanup;
- voxel/cuboid conversion или жёсткий poly budget;
- UV rebuild;
- pixel texture repaint;
- pivot/rig generation;
- runtime export validation.

Для MVP generic 3D AI должен быть optional experimental provider. Основной надёжный путь — concept image + процедурная cuboid geometry + pixel-art texture.

### 8.8. Генерация пиксельных текстур

Предлагаемый pipeline:

1. Image provider создаёт concept, а не atlas.
2. Palette extractor строит ограниченную палитру.
3. Geometry/UV stage создаёт технически правильный atlas.
4. Projector переносит крупные material regions на faces.
5. Pixel painter добавляет свет, AO, edge accents и controlled noise.
6. Seam repair сравнивает соседние UV edges.
7. Dithering выполняется по material profile.
8. Texture validator проверяет размеры, alpha, palette count, bleed и UV bounds.
9. Render feedback сравнивает 6–8 видов с concept.
10. Critic выдаёт локальные маски исправления.

Для item icons можно иметь отдельный pipeline:

- silhouette at 16/32 px;
- limited palette;
- readable diagonal/edge;
- no semi-transparent antialiasing;
- in-inventory screenshot;
- check against vanilla background and enchanted glint.

### 8.9. Уникальность и provenance

Уникальность нельзя доказать только промптом «сделай уникально». Нужны:

- сохранение prompt, negative prompt, seed и model version;
- запрет на прямой запрос «в стиле конкретного живого художника» в commercial preset;
- perceptual-hash comparison с входными референсами и asset library;
- опциональный similarity search по разрешённому каталогу;
- отсутствие копирования textures/models из исследуемых модов;
- asset manifest с источниками и лицензиями;
- ручное подтверждение для внешних references.

### 8.10. Автоматические проверки ассетов

Geometry:

- cube/poly/bone budget;
- invalid normals/non-manifold для meshes;
- zero-size faces;
- transforms/pivots;
- collision/hitbox sanity;
- LOD presence при необходимости.

UV/texture:

- power-of-two policy;
- UV bounds и overlap policy;
- padding;
- alpha mode;
- palette count;
- transparent edge bleed;
- missing texture references;
- consistent texel density.

Animation:

- все bone references существуют;
- duration и loop mode;
- нет NaN/invalid transforms;
- root motion policy;
- attack hit frame согласован с server event;
- keyframe budget;
- idle pose не дрожит.

Visual:

- turntable;
- 32/64 px silhouette;
- inventory/icon preview;
- daylight/night/interior;
- screenshot diff against approved baseline;
- human review card.

---

## 9. Корабли как специальный asset benchmark

Корабль полезен как стресс-тест качества, потому что требует:

- сильного силуэта;
- повторяющихся, но не монотонных деталей;
- дерева, металла, ткани и стекла;
- симметрии и intentional asymmetry;
- согласованного масштаба;
- нескольких уровней представления.

Asset benchmark для MVP:

- небольшой fantasy airship как animated decorative entity;
- 60–120 cuboids;
- 8–16 bones;
- texture atlas 128×128 или 256×256 по ArtSpec;
- propeller idle, sail flutter и steering animation;
- damage variant texture;
- editable bbmodel;
- GeckoLib runtime export;
- turntable и in-game screenshots;
- без физики и без перевозки игрока.

После MVP — Structure Ship benchmark:

- генерация block palette;
- deck/interior constraints;
- connectivity;
- waterline;
- collision-free spawn;
- export NBT/schematic;
- optional Eureka/Valkyrien adapter.

Это сохраняет высокую планку art pipeline, но не смешивает её с hardest-case physics.

---

## 10. Архитектура Minecraft AI Mod Studio

### 10.1. Продуктовая форма

MVP должен состоять из:

- локального CLI mcdev;
- локального MCP server;
- version/compatibility pack registry;
- ModSpec compiler;
- code generators;
- asset workers;
- build/test runner;
- artifact store и report generator.

MCP делает продукт доступным и Codex, и Claude Code, и другим совместимым агентам. MCP разделяет resources, prompts и tools; tool inputs можно строго описывать JSON Schema. Источники: [MCP server concepts](https://modelcontextprotocol.io/specification/2025-06-18/server/index), [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [Claude Code MCP](https://docs.anthropic.com/en/docs/mcp).

Важно: MCP tools могут исполнять код и должны сами обеспечивать guardrails. Codex отдельно предупреждает, что внешние MCP tools не получают его sandbox автоматически. Источник: [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/).

### 10.2. Главный поток

~~~text
Промпт
  ↓
ProductBrief
  ↓ review
ModSpec + ArtSpec
  ↓ schema + semantic validation
BuildPlan DAG
  ├─ codegen
  ├─ data generation
  ├─ asset pipeline
  ├─ integration adapters
  └─ test generation
  ↓
compile / datagen / unit / GameTest
  ↓
client + dedicated server smoke
  ↓
visual QA + compatibility fixtures
  ↓
release gate
  ↓
JAR + sources + docs + provenance + reports
~~~

LLM участвует в planning, content authoring и critique. Детерминированные компоненты отвечают за schema, code skeleton, resource paths, builds, validation и packaging.

### 10.3. Canonical IR: ModSpec

Минимальные разделы:

~~~yaml
schemaVersion: 1
project:
  modId: tidecaller
  name: Tidecaller
  version: 0.1.0
  license: MIT
target:
  minecraft: 26.1.2
  loader: neoforge
  java: 25
dependencies:
  required: [geckolib]
  optional: [jei, jade]
gameplay:
  items: []
  blocks: []
  entities: []
  recipes: []
  summoning: []
  screens: []
assets:
  artSpec: art-spec.yaml
  models: []
  textures: []
  animations: []
integrations:
  jei: auto
  jade: auto
tests:
  gameTests: []
packaging:
  includeSources: true
  publish: false
~~~

В production schema должны присутствовать также:

- data components/attachments;
- networking intents и limits;
- ownership/permissions;
- configs;
- particles/sounds;
- localization keys;
- performance budgets;
- compatibility requirements;
- migration version;
- provenance policy.

### 10.4. Semantic validation

JSON Schema проверяет форму, но недостаточен. Semantic validator должен ловить:

- дубли ResourceLocation;
- ссылки на несуществующие items/entities/bones;
- server code, зависящий от client types;
- optional API в mandatory classpath;
- entity без attributes или renderer;
- menu без server validation;
- custom recipe без serializer/type;
- JEI plugin без unique id;
- Jade provider без data-size limits;
- несовместимые versions;
- texture/model paths с неверным namespace;
- animation event, не существующий в gameplay graph;
- asset budget overflow;
- отсутствующую лицензию/provenance.

### 10.5. Compatibility packs

Структура pack:

~~~text
packs/
  neoforge-26.1.2/
    pack.json
    versions.lock
    capabilities.json
    templates/
    generators/
    schemas/
    migrations/
    docs-index/
    fixtures/
    known-issues.md
    checksums.json
~~~

Pack подписывается/хэшируется. Новый pack не получает production status, пока:

- basic fixture;
- entity fixture;
- custom recipe/UI fixture;
- JEI/Jade fixture;
- dedicated-server fixture;
- asset fixture

не пройдут CI.

### 10.6. Knowledge layer

LLM не должен полагаться на случайные старые tutorials. MCP resources предоставляют:

- выбранную версию official docs;
- capability matrix;
- разрешённые dependency versions;
- templates API;
- patterns и anti-patterns;
- known migration notes;
- локальный symbol index generated dependencies.

Для свежих API generator может извлекать:

- Javadocs;
- source signatures;
- Gradle metadata;
- registry names;
- actual compile errors.

Знания всегда помечены источником и version scope.

### 10.7. BuildPlan DAG

После ModSpec строится DAG, например:

- project scaffold;
- registries;
- items/blocks;
- entity runtime;
- recipe runtime;
- datagen;
- UI/menu;
- GeckoLib wiring;
- JEI adapter;
- Jade adapter;
- assets;
- unit tests;
- GameTests;
- package.

Каждый node имеет:

- typed inputs/outputs;
- cache key;
- retry policy;
- validator;
- logs;
- artifact list;
- provenance;
- reversible workspace changes.

Это позволяет перегенерировать только texture или JEI category, не переписывая весь мод.

### 10.8. Предлагаемый стек MVP

Control plane:

- TypeScript на актуальном LTS Node;
- официальный MCP SDK;
- Zod/JSON Schema;
- SQLite для локального job/artifact index, без хранения секретов;
- content-addressed files для ассетов и отчётов.

Generated targets:

- Java 25;
- Gradle Wrapper;
- NeoForge ModDevGradle;
- data generation;
- JUnit + GameTest.

Asset workers:

- Blockbench bridge;
- image provider adapters;
- optional Blender worker;
- PNG/UV validators;
- fixed render harness.

Почему TypeScript для control plane: быстрый MCP/tooling development, хорошая schema ecosystem и простая кроссплатформенная упаковка. Ядро генерации не должно зависеть от конкретного LLM API.

### 10.9. Image provider abstraction

Провайдеры:

- agent-supplied image;
- OpenAI Images через BYOK;
- ComfyUI/local workflow;
- manual import;
- позже другие vendors.

Единый contract:

- prompt + negative constraints;
- reference images;
- size/aspect;
- seed where supported;
- model/version metadata;
- content policy error;
- result image + provenance.

Секреты хранятся в OS keychain или environment и никогда не попадают в ModSpec, logs, model prompts или release bundle.

### 10.10. MCP tool surface MVP

Project:

- mcdev_project_init;
- mcdev_project_inspect;
- mcdev_spec_validate;
- mcdev_plan_build;
- mcdev_apply_plan.

Content:

- mcdev_add_item;
- mcdev_add_block;
- mcdev_add_entity;
- mcdev_add_summoning_recipe;
- mcdev_add_screen;
- mcdev_add_config.

Assets:

- mcdev_art_spec;
- mcdev_concept_generate;
- mcdev_model_blockout;
- mcdev_texture_generate;
- mcdev_animation_generate;
- mcdev_asset_validate;
- mcdev_asset_preview;
- mcdev_asset_approve.

Integrations:

- mcdev_integrate_jei;
- mcdev_integrate_jade.

Verification:

- mcdev_datagen;
- mcdev_build;
- mcdev_unit_test;
- mcdev_game_test;
- mcdev_run_client_smoke;
- mcdev_run_server_smoke;
- mcdev_compat_test;
- mcdev_release_report.

Packaging:

- mcdev_package;
- mcdev_publish_prepare;

Опасные операции:

- никакого generic shell tool;
- никакого arbitrary Blender/Blockbench code eval;
- publish отделён от package;
- инструмент пишет только внутри подтверждённого workspace;
- destructive clean ограничен generated/cache directories;
- dependency/network domains allowlisted.

### 10.11. Repo layout самого продукта

~~~text
minecraft-ai-mod-studio/
  apps/
    cli/
    mcp-server/
  packages/
    modspec/
    planner/
    compatibility-packs/
    codegen-core/
    asset-core/
    validation/
    build-runner/
    reports/
  workers/
    blockbench-bridge/
    blender-worker/
    image-providers/
  packs/
    neoforge-26.1.2/
    fabric-26.2-preview/
  fixtures/
    basic-content/
    summoned-companion/
    animated-airship/
  docs/
  tests/
~~~

---

## 11. Точный scope первого MVP

### 11.1. Входит

Platform:

- NeoForge 26.1.2;
- Java 25;
- Gradle Wrapper + ModDevGradle;
- один production compatibility pack.

Gameplay primitives:

- items;
- blocks;
- simple block entities;
- living entity/companion;
- attributes, simple AI goals, ownership;
- custom summoning recipe/runtime;
- native Menu/Screen;
- config;
- data generation;
- networking intents с limits.

Assets:

- item icon;
- block texture/model;
- cuboid animated entity;
- ArtSpec;
- editable bbmodel;
- GeckoLib geo/animation export;
- unique pixel texture;
- screenshots/turntable;
- automatic validation.

Integrations:

- GeckoLib required when animation requested;
- JEI optional;
- Jade optional;
- compile/run tests with and without optional mods.

Delivery:

- MCP + CLI;
- plan/review/apply workflow;
- build/test/package;
- release report;
- provenance/dependency manifest.

### 11.2. Не входит

- полная feature parity Fabric/Forge;
- Paper/Folia;
- world generation;
- dimensions;
- complex fluids/energy networks;
- arbitrary Mixins;
- full cloth simulation;
- physical block-built ships;
- training собственного image/3D model;
- automatic marketplace publishing;
- automatic porting любого существующего мода;
- guarantee compatibility with every optimization/shader mod;
- generic arbitrary Java generation outside supported primitives.

Эти границы принципиальны. Без них MVP превратится в бесконечный modding platform project и не докажет основную ценность.

### 11.3. Вертикальный reference mod

Рабочее название: Tidecaller.

Промпт:

> Создай NeoForge-мод о маленьком медно-коралловом крабе-компаньоне. Его призывают на приливном алтаре из раковины, меди и призмарина. Он следует за владельцем, собирает выпавшие предметы в небольшом радиусе и имеет режим «ждать». Нужны красивый vanilla+ дизайн, анимации idle/walk/summon, экран настройки радиуса, Jade tooltip и JEI-страница ритуала.

Что должен сгенерировать MVP:

- shell/catalyst item;
- tidal altar block + block entity;
- summon recipe data;
- server-side ritual runtime;
- crab entity, attributes, goals, owner, persistence;
- pickup radius с лимитами и blacklist;
- interaction state follow/wait;
- synced data;
- menu/screen настройки радиуса;
- ArtSpec;
- model with semantic bones;
- 64×64 или 128×128 texture по style constraints;
- idle/walk/summon animations;
- particles;
- Jade owner/mode/radius component;
- JEI ritual category/catalyst;
- en_us и ru_ru;
- datagen;
- unit tests и GameTests;
- dedicated server smoke;
- client screenshots;
- release bundle.

### 11.4. Acceptance tests reference mod

Функциональные:

- корректный ритуал призывает ровно одного краба;
- неверный pattern/ingredient не расходует ресурсы;
- owner устанавливается на server;
- чужой игрок не меняет режим/радиус;
- save/reload сохраняет owner и mode;
- chunk unload/reload не дублирует сущность;
- item collection соблюдает radius, blacklist и max-per-tick;
- death/despawn policy соответствует spec.

Интеграционные:

- запускается без JEI/Jade;
- JEI отображает ingredients/catalyst/output semantics;
- Jade показывает только разрешённые данные;
- dedicated server не загружает client classes;
- network payload rejects oversize/invalid values.

Визуальные:

- нет missing texture;
- silhouette читается на gameplay distance;
- UV без заметных seams;
- walk не скользит чрезмерно;
- summon event совпадает с particle timing;
- UI помещается при GUI scale 2–4 и нескольких resolution;
- текст не обрезается на en_us/ru_ru.

### 11.5. Второй asset-only benchmark

Animated Airship:

- concept sheet;
- cuboid blockout;
- 60–120 cubes;
- 8–16 bones;
- уникальная texture;
- три animation clips;
- editable source;
- GeckoLib export;
- automatic stats;
- turntable;
- in-game renderer fixture.

Он проверяет, способен ли инструмент создавать качественные сложные модели, не связывая результат с physics scope.

---

## 12. Тестовая стратегия

### 12.1. Уровни

1. Schema tests.
2. Semantic ModSpec tests.
3. Generator golden tests.
4. Compile tests.
5. Unit tests.
6. Data generation tests.
7. GameTests.
8. Dedicated-server boot.
9. Client boot/world join.
10. Optional-mod compatibility matrix.
11. Visual regression.
12. Packaging/reproducibility.

Fabric поддерживает JUnit через Fabric Loader и GameTests с реальным client/server окружением: [Fabric automated testing](https://docs.fabricmc.net/develop/automatic-testing). NeoForge поддерживает GameTest и gameTestServer через tooling: [NeoForge GameTests](https://docs.neoforged.net/docs/1.21.1/misc/gametest/), [ModDevGradle](https://docs.neoforged.net/toolchain/docs/plugins/mdg/).

### 12.2. Generated-code gates

- formatter/linter;
- no unresolved TODO/FIXME in generated scope;
- build with warnings policy;
- no deprecated API unless compatibility pack explicitly allows;
- resource-reference graph complete;
- datagen diff stable;
- generated output deterministic from locked inputs;
- clean build from empty cache.

### 12.3. GameTest library

Нужна reusable library scenarios:

- item/block registration;
- block placement/break/loot;
- recipe match/fail;
- entity spawn;
- AI target/follow;
- owner permission;
- save/reload;
- chunk unload;
- menu distance validation;
- network invalid payload;
- summoning consume/rollback;
- optional integration presence.

Генератор выбирает scenarios по ModSpec и подставляет конкретные ids/expected values.

### 12.4. Dedicated server purity

Отдельный gate:

- boot server without graphical environment;
- load generated mod;
- create test world;
- run GameTests;
- scan logs for classloading errors;
- stop cleanly;
- verify no client package was loaded.

Это ловит одну из самых частых ошибок AI-generated mods.

### 12.5. Performance

Минимальные budgets:

- no sustained tick degradation in reference scenario;
- bounded entity work per tick;
- no unbounded scan of large radius;
- no collection allocation from untrusted packet without limit;
- model/texture budgets;
- unload leaves no registered world references;
- profiler sample for 50–100 reference entities.

Для диагностики можно интегрировать spark как внешний profiler; проект и API имеют разные license considerations. Источник: [spark](https://github.com/lucko/spark).

### 12.6. Compatibility matrix

MVP matrix:

| Fixture | Base | +GeckoLib | +JEI | +Jade | +JEI+Jade |
|---|---:|---:|---:|---:|---:|
| Client boot | ✓ | ✓ | ✓ | ✓ | ✓ |
| Dedicated server | ✓ | ✓ | ✓ | ✓ | ✓ |
| World join | ✓ | ✓ | ✓ | ✓ | ✓ |
| Reference ritual | ✓ | ✓ | ✓ | ✓ | ✓ |
| UI | ✓ | ✓ | ✓ | ✓ | ✓ |

Позднее:

- Sodium/Embeddium;
- Iris/Oculus;
- EMI/REI;
- Accessories;
- Create;
- Valkyrien Skies.

### 12.7. Release gate

Package разрешён, если:

- все required tests green;
- no critical/high findings;
- visual assets approved;
- dependencies locked;
- provenance complete;
- license policy passes;
- dedicated server passes;
- optional mods pass both absent and present;
- reproducible clean build succeeds;
- report содержит точные версии и hashes.

---

## 13. Дорожная карта

Оценка рассчитана на 3 full-time инженеров и part-time technical artist/QA. Для одного сильного разработчика реалистичный срок увеличится примерно до 4–6 месяцев.

### Фаза 0. Discovery hardening — 1 неделя

Результат:

- утвердить ModSpec v0;
- заморозить NeoForge 26.1.2 compatibility baseline;
- выбрать точные versions;
- собрать пустой fixture;
- юридически классифицировать dependencies/tools и продуктовую лицензию ([ADR-0001](decisions/0001-product-and-output-licensing.md));
- определить art quality rubric ([Art Quality Rubric v0](quality/art-quality-rubric-v0.md)).

Exit:

- clean scaffold собирается;
- GameTest task работает;
- client и server запускаются в CI;
- versions.lock воспроизводим.

### Фаза 1. Compiler foundation — 2 недели

Результат:

- CLI;
- MCP server;
- workspace/security boundaries;
- ModSpec schema и semantic validation;
- BuildPlan DAG;
- compatibility pack loader;
- generator for project/items/blocks/datagen;
- structured logs и artifact index.

Exit:

- Codex/Claude через MCP создаёт и собирает basic-content fixture;
- повторный build не меняет generated files;
- invalid spec выдаёт понятные diagnostics.

### Фаза 2. Entity + summoning vertical slice — 2 недели

Результат:

- entity primitive;
- attributes/goals/owner/persistence;
- summoning recipe/runtime;
- networking intents;
- GameTest library;
- server purity gate.

Exit:

- headless tests подтверждают призыв, ownership, save/reload и permission failures.

### Фаза 3. Asset pipeline — 2–3 недели

Результат:

- ArtSpec;
- concept provider abstraction;
- Blockbench narrow bridge;
- cuboid blockout;
- texture pipeline;
- GeckoLib export;
- animation presets;
- validation и turntable.

Exit:

- crab model и airship benchmark проходят technical checks;
- editable source и runtime assets воспроизводимы;
- visual approval workflow работает.

### Фаза 4. UI + JEI/Jade — 2 недели

Результат:

- UI schema;
- native Screen/Menu generator;
- config support;
- JEI adapter;
- Jade adapter;
- optional-mod fixtures;
- localization checks.

Exit:

- reference UI работает на нескольких scales;
- JEI/Jade не являются hard dependency;
- запуск с/без них проходит.

### Фаза 5. Packaging + quality gate — 2 недели

Результат:

- package/release bundle;
- provenance;
- SBOM/dependency manifest;
- visual report;
- compatibility report;
- cache/reproducibility;
- failure recovery.

Exit:

- один prompt проходит путь до approved JAR;
- чистая машина/CI повторяет результат;
- release report объясняет каждую проверку.

### Фаза 6. Dogfood beta — 1–2 недели

Тестовые пользователи:

- опытный NeoForge modder;
- начинающий разработчик;
- technical artist;
- пользователь Codex;
- пользователь Claude Code.

Сценарии:

- новый companion;
- новый machine block;
- custom ritual;
- animated prop;
- изменение уже сгенерированного проекта.

Exit:

- минимум 5 completed projects;
- не более одного ручного вмешательства в generated infrastructure на проект;
- критические failure modes закрыты;
- зафиксирована очередь Fabric adapter.

Итого: 12–14 недель для убедительного MVP.

---

## 14. После MVP

### 14.1. Fabric full adapter

- Fabric 26.2 production pack;
- Fabric Loader/Loom/Fabric API version resolver;
- Fabric entrypoints;
- networking;
- attachments/data;
- screens;
- JEI/Jade/EMI;
- Fabric GameTest/client tests;
- renderer compatibility with Vulkan direction.

### 14.2. Forge adapter

- ForgeGradle/MDK pack;
- Forge lifecycle/events;
- registrations;
- networking;
- data generation;
- separate JEI/Jade fixtures;
- no assumptions that NeoForge imports or metadata are compatible.

### 14.3. Multi-loader export

Только после двух зрелых adapters:

- common gameplay core where APIs truly overlap;
- loader modules;
- platform services;
- shared assets;
- independent build/test matrix.

Architectury можно предложить как optional strategy, но не делать обязательной runtime-зависимостью. Источник: [Architectury API docs](https://docs.architectury.dev/api/).

### 14.4. Advanced gameplay packs

- machines/energy/fluids;
- worldgen;
- structures;
- spell systems;
- multipart bosses;
- Accessories cosmetics;
- Create contraptions;
- Valkyrien ships;
- shader/render effects;
- Paper/Folia plugins.

Каждый pack требует свой IR fragment, generators и test library.

### 14.5. Publishing

Modrinth имеет официальный API и Gradle Minotaur tooling. Источники: [Minotaur](https://docs.modrinth.com/contributing/minotaur/), [create version API](https://docs.modrinth.com/api/operations/createversion/).

Publishing flow:

1. validate metadata;
2. generate release notes;
3. show exact files, loaders, game versions и dependencies;
4. user confirmation;
5. upload;
6. verify resulting project/version;
7. store receipt.

CurseForge adapter добавляется отдельно после подтверждения актуального официального API/credentials flow.

---

## 15. Метрики MVP

North star:

- доля supported prompts, завершившихся approved release bundle без ручной правки infrastructure.

Engineering:

- build success rate;
- clean reproducibility;
- GameTest pass rate;
- dedicated-server pass rate;
- optional integration pass rate;
- mean repair loops;
- generated diff determinism;
- time from approved spec to JAR.

Art:

- technical asset validation pass;
- human approval on first/second iteration;
- silhouette/readability score;
- seam/missing texture rate;
- style consistency score;
- percentage targeted repairs versus full regeneration.

Agent UX:

- tool-call success;
- diagnostics resolved without human source-code search;
- plan approval rate;
- number of unsafe tool requests rejected correctly;
- resumability after failure.

Целевые значения beta:

- 90% build success для поддерживаемых primitives;
- 100% dedicated-server purity;
- 100% absence/presence tests для declared optional integrations;
- 80% art approval максимум за два repair loops;
- 100% complete provenance для generated assets;
- 0 automatic publishes without explicit confirmation.

---

## 16. Безопасность

### 16.1. Threat model

Риски:

- prompt injection из README/docs/assets;
- dependency confusion;
- malicious Gradle plugin;
- arbitrary code через Blender/Blockbench;
- path traversal;
- secrets in logs;
- unbounded generated packets;
- server trust of client data;
- destructive clean;
- accidental publication;
- model provider data retention.

### 16.2. Меры

- workspace root canonicalization;
- no writes outside workspace/artifact cache;
- allowlisted Gradle tasks;
- allowlisted domains/repositories;
- pinned dependencies/checksums;
- no generic shell MCP tool;
- no arbitrary Python/JavaScript eval;
- size/time/memory limits на workers;
- redact secrets;
- credentials in keychain;
- clear tool annotations;
- confirmation for network publish;
- content and packet limits;
- server-authoritative gameplay;
- audit log;
- generated code treated as untrusted until gates pass.

NeoForge отдельно рекомендует минимальные serverbound packets и ограничение размеров коллекций, чтобы избежать allocation attacks. Источник: [Mitigating Network Vulnerabilities](https://neoforged.net/news/mitigating-vulnerabilities-network/).

### 16.3. MCP-specific

MCP security principles требуют user consent, понятного описания tools и контроля data access. Источник: [MCP specification security principles](https://modelcontextprotocol.io/specification/2025-03-26/index).

Поэтому:

- read-only и mutating tools разделены;
- tool output structured;
- apply требует plan id;
- preview/approve разделены;
- package и publish разделены;
- dangerous capabilities нельзя спрятать под нейтральным названием.

---

## 17. Лицензии и юридические ограничения

### 17.1. Minecraft

Нужно соблюдать Minecraft EULA и Usage Guidelines:

- не распространять модифицированный Minecraft;
- не выдавать продукт за официальный;
- корректно использовать название/бренд;
- не нарушать правила коммерческого использования;
- распространять собственный mod/resource pack, а не чужие game assets.

Источники: [Minecraft EULA](https://www.minecraft.net/en-us/eula), [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines).

### 17.2. Исследованные проекты

| Проект | Наблюдаемая лицензия | Практический вывод |
|---|---|---|
| MultiLoader Template | CC0 | Можно использовать как reference/template с проверкой |
| Occultism code | MIT | Можно изучать/переиспользовать с notice; assets проверить отдельно |
| JEI | MIT | API и code доступны по MIT |
| GeckoLib | MIT | Допустимая runtime dependency с notice |
| Accessories | MIT | Подходит для optional adapter |
| Valkyrien Skies 2 | LGPL-3.0 | Использовать как dependency с соблюдением LGPL |
| Blockbench | GPL-3.0 | External tool/plugin boundary; не смешивать код с закрытым ядром |
| Blockbench MCP Plugin | GPL-3.0 | External prototype, dual-license или clean-room bridge |
| Figura current code | PolyForm Noncommercial | Не копировать в коммерческий продукт |
| Jade current repo | CC BY-NC-SA 4.0 | Использовать публичный API, не копировать implementation в commercial core |
| Hunyuan3D/Stable 3D | специальные условия | Проверять model/output license до включения |

Ключевой принцип: «source available» не означает «можно коммерчески копировать». API integration и изучение architecture отделяются от копирования implementation.

### 17.3. Generated asset provenance

Каждый asset manifest:

- asset id;
- author mode: AI/manual/mixed;
- provider/model/version;
- prompt/seed;
- references + license;
- generation timestamp;
- editable source hash;
- runtime output hash;
- human approvals;
- repair history;
- distribution status.

---

## 18. Главные риски и способы снижения

### Риск 1. API drift

Проблема: Minecraft и loaders быстро меняются.

Ответ:

- compatibility packs;
- exact lock;
- production status;
- official docs/source index;
- fixtures и scheduled refresh;
- не обещать «latest» без CI.

### Риск 2. Красивый concept, плохой игровой asset

Ответ:

- concept не равен atlas;
- procedural geometry/UV;
- palette constraints;
- turntable + in-game screenshots;
- local repair;
- approval gate.

### Риск 3. LLM создаёт незащищённую сеть

Ответ:

- declarative intents;
- generated codecs с limits;
- server validation;
- no arbitrary packet bodies;
- negative GameTests.

### Риск 4. Multi-loader scope explosion

Ответ:

- один production target;
- common IR, separate adapters;
- capability matrix;
- no false parity;
- multi-loader export позднее.

### Риск 5. Слишком сложная физика

Ответ:

- разделить visual entity, vehicle entity и block-built ship;
- full physics вынести в VS adapter;
- airship сделать asset benchmark.

### Риск 6. License contamination

Ответ:

- license scanner;
- dependency/source boundary;
- clean-room adapters;
- provenance;
- THIRD_PARTY_NOTICES;
- legal review before commercial release.

### Риск 7. Generated project невозможно поддерживать вручную

Ответ:

- readable idiomatic code;
- stable generated/user-owned boundaries;
- marker-free file ownership manifest;
- regeneration by AST/template units, not blind overwrite;
- source JAR/docs;
- migration tooling.

Рекомендуемая модель ownership:

- generated files полностью принадлежат generator;
- extension points — user-owned;
- изменения generated file обнаруживаются и требуют выбора: adopt override, discard or fork;
- никаких скрытых перезаписей.

### Риск 8. Агент получает слишком сильные инструменты

Ответ:

- narrow typed tools;
- no shell/eval;
- sandbox workers;
- plan/apply split;
- audit;
- explicit publish confirmation.

---

## 19. Что не следует делать

- Не начинать с поддержки Forge + Fabric + NeoForge + Paper одновременно.
- Не делать LLM-generated Java единственным source of truth.
- Не создавать один «универсальный loader abstraction» на основе imports replacement.
- Не просить image model сразу нарисовать готовый UV atlas.
- Не считать generic text-to-3D mesh готовой Minecraft-моделью.
- Не использовать raw OpenGL.
- Не давать Blender/Blockbench arbitrary code execution через MCP.
- Не копировать код/ассеты из source-available noncommercial проектов.
- Не делать JEI/Jade hard dependencies без необходимости.
- Не запускать только client — dedicated server обязателен.
- Не считать green Gradle build доказательством production readiness.
- Не публиковать автоматически.
- Не обещать «любой мод из любого промпта» в MVP.

---

## 20. Решения, которые нужно принять перед реализацией

Статус на 2026-07-21: вопросы 1, 7 и 10 закрыты в [ADR-0001](decisions/0001-product-and-output-licensing.md) и [Art Quality Rubric v0](quality/art-quality-rubric-v0.md). Остальные пункты сохраняют статус открытых, пока для них не появится отдельное решение.

1. **Решено:** оригинальные implementation, документация и schemas — Apache-2.0; generated output не передаётся проекту автоматически и сохраняет все применимые third-party/provider/Minecraft restrictions.
2. Допустим ли GPL external Blockbench bridge.
3. Какие image providers входят официально.
4. Будет ли local-only режим обязательным.
5. Где хранится artifact cache.
6. Нужен ли hosted registry compatibility packs в MVP.
7. **Решено:** rubric утверждает назначенный product owner человек с release authority; AI/validator не может выдать final approval.
8. Какие minimum hardware requirements для локальной генерации.
9. Будет ли NeoForge 26.1.2 единственным production target или Fabric 26.2 получит preview.
10. **Решено:** проект не требует передачи прав на generated output; фактические права и распространение ограничены применимым правом, inputs, provider/model terms, сторонними компонентами и правилами Minecraft.

Моя рекомендация:

- ядро и ModSpec schema — open source под Apache-2.0;
- official compatibility packs — подписанные;
- Blockbench bridge — отдельный процесс/репозиторий;
- local-first;
- BYOK providers;
- проект не требует передачи ему прав на generated output и не заявляет дополнительный copyright interest только из-за факта генерации; output остаётся в пользовательском workspace и управляется пользователем в пределах реально существующих прав;
- hosted team features позже.

---

## 21. Конкретный backlog первых 30 задач

Foundation:

1. Создать monorepo.
2. Описать ModSpec v0.
3. Описать ArtSpec v0.
4. Реализовать schema validation.
5. Реализовать semantic diagnostic format.
6. Создать NeoForge 26.1.2 compatibility pack.
7. Зафиксировать version lock/checksums.
8. Создать basic fixture.
9. Поднять CI clean build.
10. Поднять dedicated-server smoke.

Agent interface:

11. Реализовать MCP project tools.
12. Реализовать plan/apply contract.
13. Реализовать MCP resources для pack capabilities.
14. Реализовать audit log.
15. Ограничить workspace и network.

Gameplay:

16. Генератор registrations.
17. Генератор items/blocks/datagen.
18. Генератор entity primitive.
19. Генератор ownership/simple goals.
20. Summoning recipe/runtime.
21. Network intent schema.
22. GameTest scenario library.

Assets:

23. ArtSpec validator.
24. Image provider contract.
25. Blockbench bridge stable subset.
26. Cuboid blockout generator.
27. Texture/UV validator.
28. GeckoLib exporter/validator.
29. Turntable/screenshot report.

Delivery:

30. Reference Tidecaller mod end-to-end.

После этого добавляются native UI, JEI, Jade и packaging как следующие связанные задачи внутри 12–14-недельного плана; в рабочем tracker их следует декомпозировать детальнее.

---

## 22. Definition of Done MVP

MVP готов, когда новый пользователь может:

1. Подключить локальный MCP server к Codex или Claude Code.
2. Дать prompt Tidecaller-класса.
3. Получить ProductBrief и ModSpec для подтверждения.
4. Подтвердить ArtSpec и concept.
5. Запустить генерацию.
6. Увидеть понятный прогресс и локальные repair loops.
7. Получить прошедший build/test mod.
8. Открыть visual QA report.
9. Запустить generated client и dedicated server.
10. Получить release bundle.

И при этом:

- никакой tool не пишет вне workspace;
- secrets не попадают в output;
- optional integrations действительно optional;
- исходники читаемы;
- модель и texture редактируемы;
- provenance полный;
- JAR воспроизводим;
- публикация не происходит без отдельного подтверждения.

---

## 23. Финальная рекомендация

Начинать следует с вертикального compiler-first MVP для NeoForge 26.1.2:

- общий ModSpec/ArtSpec;
- один высококачественный entity+summoning+UI reference;
- GeckoLib;
- JEI/Jade;
- узкий Blockbench bridge;
- сильный test/release gate;
- MCP для Codex/Claude Code.

Главное конкурентное преимущество будет не в количестве сгенерированных строк Java. Оно будет в сочетании четырёх вещей:

1. Version-aware Minecraft knowledge.
2. Детерминированный compiler и compatibility packs.
3. Действительно Minecraft-native asset pipeline.
4. Проверяемый путь до production bundle.

После доказательства этого вертикального пути можно добавлять Fabric, Forge, Paper, Accessories, Create и Valkyrien Skies как независимые capability packs. Так продукт постепенно станет «ультимативным инструментом», не разрушив качество попыткой охватить всю экосистему в первом релизе.

---

## 24. Основные источники

Платформы:

- [Minecraft Java 26.2](https://www.minecraft.net/en-us/article/minecraft-java-edition-26-2)
- [Removing obfuscation in Java Edition](https://www.minecraft.net/en-us/article/removing-obfuscation-in-java-edition)
- [Fabric developer docs](https://docs.fabricmc.net/develop/)
- [Fabric 26.2 porting notes](https://fabricmc.net/2026/06/15/262.html)
- [NeoForge docs](https://docs.neoforged.net/docs/gettingstarted/)
- [NeoForge 26.1 notes](https://neoforged.net/news/26.1release/)
- [ModDevGradle](https://docs.neoforged.net/toolchain/docs/plugins/mdg/)
- [Forge docs](https://docs.minecraftforge.net/en/latest/gettingstarted/)
- [Forge 26.2 downloads](https://files.minecraftforge.net/net/minecraftforge/forge/index_26.2.html)
- [Paper developer docs](https://docs.papermc.io/paper/dev/project-setup/)

Моды и API:

- [MultiLoader Template](https://github.com/Jaredlll08/MultiLoader-Template)
- [Occultism](https://github.com/klikli-dev/occultism)
- [GeckoLib](https://github.com/bernie-g/geckolib)
- [JEI](https://github.com/mezz/JustEnoughItems)
- [Jade](https://github.com/Snownee/Jade)
- [EMI](https://github.com/emilyploszaj/emi)
- [Accessories](https://github.com/wisp-forest/accessories)
- [Valkyrien Skies 2](https://github.com/ValkyrienSkies/Valkyrien-Skies-2)
- [Eureka wiki](https://github.com/ValkyrienSkies/Eureka/wiki)
- [Create](https://github.com/Creators-of-Create/Create)
- [Figura](https://github.com/FiguraMC/Figura)

Assets:

- [Blockbench](https://github.com/JannisX11/blockbench)
- [Blockbench MCP Plugin](https://github.com/jasonjgardner/blockbench-mcp-plugin)
- [Blender command line](https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html)
- [Hunyuan3D 2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1)
- [Microsoft TRELLIS](https://github.com/microsoft/TRELLIS)
- [Stable Fast 3D](https://github.com/Stability-AI/stable-fast-3d)
- [TripoSR](https://github.com/VAST-AI-Research/TripoSR)
- [BLOCK: character-to-Minecraft-skin research](https://arxiv.org/abs/2603.03964)
- [Minecraft-ify research](https://arxiv.org/abs/2402.05448)

Agent protocol и безопасность:

- [MCP specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [Claude Code MCP](https://docs.anthropic.com/en/docs/mcp)
- [Codex agent loop and MCP boundary](https://openai.com/index/unrolling-the-codex-agent-loop/)

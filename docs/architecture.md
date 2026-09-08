# Architecture

## Data flow (однонаправленный)

```
[AudioWorklet] --(RawFeatures + t)--> AudioAnalyzer --> MusicState
                                    (audioTime)
PlayerState -----> DirectorState --> Director --> DirectorIntent[]
  ^                                    |
  |                                    +--> Gameplay / Camera / World / VFX
  +-------(Gameplay пишет)                 (consumers применяют easing)
  +--> StateRecorder / Replay
```

## Правила зависимостей

1. `src/core/` — чистый TS, zero импортов из `render/`, `audio/`, Three.js, DOM (закреплено ESLint `import/no-restricted-paths` + `no-restricted-imports`).
2. `AudioAnalyzer` → только в `MusicState`; не знает о Gameplay/Camera.
3. `Director` — единственный источник `DirectorIntent[]`.
4. `LevelGenerator` — принимает только numeric intents/multipliers, никогда не читает audio.
   `isPassable` учитывает `zExtent`; car-чанк дополнительно сертифицируется по времени фактической встречи с учётом `laneFlow`, текущей входной полосы, длительности перестроения и запаса решения. После склейки чанков `GameSim` просит генератор проверить дальний видимый горизонт; близкие объекты и активные ramp-gates не переписываются.
   Переход конь → машина открывает разреженное окно (`beginHorseToCarTransition`, 2 чанка без tall/redWall/nitro-испытаний); проезды через опубликованные slide-группы подсвечиваются presentation-only safeGuide-монетами, сами препятствия immutable. Посадка ракеты заранее выбирает окно (`core/gameplay/rocketLanding.ts`, поправка в пределах `rocket.landingAdjustMaxSeconds`) и резервирует разреженный коридор (`reserveRocketLanding`); удаление видимых препятствий ради посадки запрещено, короткий grace — по образцу `carPortalSafeSeconds`.
   Temporal-проверка использует общий с симуляцией `carTrafficScrollSpeed`, включая быстрый боковой трафик; стартовый диапазон скоростей проверяется с шагом `fairness.speedSampleStep`. Горизонт отсчитывается от игрока и учитывает близкие объекты. Недоступные ранние ramp-gates отбрасываются до сертификации, а `fillOpeningContent` заполняет безопасными предметами только новый стартовый горизонт, без выхода за его границы.
   Cross-chunk repair выполняется до публикации на staging-копии горизонта и может менять только IDs нового чанка. Опубликованные obstacles/ramps immutable для fairness-repair. Destroy micro (`kind=micro`) держит lead-gap `fairness.microLeadMinGapZScale` до blocking red/tall/low и выравнивается на comfort-route с dodge/escape; новый чанк не должен превращать опубликованный micro-кластер в тупик.
   Каждый levelgen preset состоит из пяти фиксированных слоёв: `shared-balance` → `car-balance` → `horse-balance` → `car-phases` → `horse-phases`. Один UI id всегда выбирает обе mode-ветки.
   Horse comfort route — action-aware lane-graph по точным Z-событиям: dodge и необязательные action-группы ведут в свободную полосу, mandatory jump/slide сохраняют текущую полосу и получают coin guide перед группой. Car temporal fairness и destroy micro-guides остаются отдельным контрактом.
   Редкие тематические коридоры публикуются как collision-free `SceneryZoneEntity`; `visualTheme` меняет только presentation-вариант уже сертифицированного obstacle и не участвует в passability.
5. `Gameplay` — пишет `PlayerState`, не читает `MusicState`.
6. Consumers сами применяют easing к интентам.
7. `render/` — единственный слой, знающий Three.js. Obstacle visual resolver детерминирован по entity/group ID и полосе; базовые размеры берутся из общего `obstacleFootprint`, а micro может иметь отдельный ограниченный полосой readability-профиль. Любой visual scale остаётся presentation-only и не меняет hitbox. Gameplay-класс сохраняется цветовым tint-слоем поверх естественных материалов.
   Ambient scenery (`CityScenery`, `OrbitalScenery`) также presentation-only: это переиспользуемые collision-free rigs, которые не публикуют entity и не участвуют в passability. Car/horse scenery меняется двухфазно без opacity-crossfade: исходный набор полностью уходит под землю, затем новый поднимается; над землёй они не сосуществуют. Массивный city layer получает более длинную smootherstep-фазу, а horse layer ждёт его полного скрытия. Город следует сохранённому car/horse blend и остаётся под ракетой, если взлёт начался из машины; орбитальный слой накладывается отдельно по `rocketEnvironmentBlend`, поэтому дорога, obstacles и окружение предыдущего режима не удаляются и не пересоздаются.

### Музыкальное планирование событий

- `ActiveDirector` формирует section-интенты скорости, музыкальной дельты плотности,
  частоты монет и VFX; базовая сложность остаётся в `LevelGenerator`.
- `GameSim` фиксирует смену фазы и передаёт её в чистый планировщик
  `core/gameplay/musicPatterns.ts`. Планировщик выбирает сертифицированный паттерн и переводит
  желаемое время прибытия в lead-distance по текущей скорости.
- Beat остаётся быстрым presentation-сигналом, phrase создаёт ближайший игровой паттерн,
  section задаёт драматургию. Все паттерны проходят через обычные collision/passability
  контракты, а ограничения рамп могут безопасно отменить целую связку ramp+wall.

## Tick model

- `fixedUpdate` (60 Hz): Player, collision, LevelGen, Director FSM — `src/app/GameLoop.ts`
- `variableUpdate`: Camera/VFX lerp, render interpolation
- `audioWorklet`: FFT/RMS → postMessage
- Новый музыкальный ран: `AudioSession.prepareRestart` перематывает источник и сбрасывает анализатор до `GameSim.restart/fixedUpdate(0)` и countdown. `LevelGenerator.reset` очищает timing/traffic-контекст предыдущего рана.
- `render` (rAF): Three.js draw

## Tutorial

- `core/tutorial/TutorialController.ts` читает subset `GameSnapshot` (включая актуальный `PlayerSim.nitroReady` и runStats; snapshot не использует кэш готовности генератора), выдаёт `TutorialIntent`; DOM, Three.js и storage в core отсутствуют.
- `app/TutorialStorage.ts` хранит только novice/veteran. Runtime-этапы сбрасываются при новом ране; reset посреди рана использует baseline счётчиков.
- `bootstrap` передаёт scale в fixedUpdate и scene/VFX dt, а реальный dt — в tutorial blend/timeout и FPS. Пауза сохраняет текущую цель. Rocket/replay/gameOver и ramp-flight (airborne/landing после трамплина) отключают эффекты tutorial; ramp-flight также подавляет HUD nitro hint. Обычный horseJump продолжает обучение.
- `render/TutorialArrows.ts` рисует один интент; `HUD` подавляет дублирующую nitro-подсказку. `AudioSession` применяет playbackRate и отдельный EQ с detune после analyser tap; поток AudioAnalyzer → Director не меняется.

## DI

Не фреймворк: `src/app/GameContext.ts` — простой контейнер, ручная инъекция. Сборка — `src/app/bootstrap.ts`.

## Product shell

- До выбора трека bootstrap держит `runPhase: 'menu'`: сцена живая, игрок скрыт (`GameScene.setPlayerHidden`), HUD спрятан, оверлей `MainMenu` (не `src/ui/screens/`). В меню симуляция в ghost-режиме (`GameSim.setGhost`): мир едет, коллизии/урон/подборы игрока выключены.
- Бандл: папка `video/` (не `public/video`). Vite-плагин отдаёт `/video/*` и `/video/catalog.json` (до 5 файлов). Свой файл — через существующий file picker.
- Master volume: `AudioGraph.outputGain` после компрессора (музыка + SFX). Не `video.muted`. Значение в localStorage, ползунок в меню и на паузе.
- Камера / тень / режим и счётчики слева сверху — только при `?dev=1`.

## Procedural SFX

- GameSim публикует факты контактов/подборов и наблюдает переходы движения в ограниченную SfxEventQueue. Очередь независима от getSnapshot; bootstrap забирает её один раз за кадр и передаёт AudioSession вместе с копией состояния движения и фазой рана.
- Чистый core/sfx/SfxDirector группирует события, ограничивает голоса, выбирает приоритеты и цели фоновых слоёв. AudioSession владеет им и audio/sfx/SfxEngine; исполнитель использует существующий AudioContext и подключается только к AudioGraph.sfxBus. Музыкальный анализ и DirectorIntent не участвуют.
- Пауза, restart, replay, скрытая вкладка и завершение имеют отдельные правила остановки. Конфиг sfx.default.json проходит ConfigStore/Zod/fallback/HMR. Контракт и проверка: docs/sfx-design.md; итоговый план: docs/music-plan-ultimate.txt.
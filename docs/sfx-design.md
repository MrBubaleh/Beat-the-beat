# SFX Design — контракт procedural audio

> Полный план: `docs/music-plan-ultimate.txt`. История итераций: `changelog.md`.

## Назначение

Procedural SFX — короткие игровые звуки и beds, синтезируемые в рантайме. Музыка остаётся главной; SFX не дублирует музыкальные акценты.

## Поток

```
SfxEventQueue → SfxDirector → SfxCommand[] → SfxEngine → sfxBus → master
```

`SfxDirector` — единственный источник команд. `SfxEngine` применяет их к Web Audio; consumers не читают геймплей напрямую.

## Rocket turbo sample

По просьбе пользователя ракета использует `sound/TURBO BOOST sound effect.mp3`. SfxDirector передаёт RocketSample фазу и позицию от начала подбора: anticipation запускает файл **сразу на полной громкости**; fall запускает программный fade-out (`fadeOutMs`, длительность ≈ падение + 0.3 с после посадки). Повторные кадры не перезапускают файл. Пауза/restart/скрытие вкладки останавливают источник (короткий cut ~20 мс); приземление (`off`) продолжает fade, если он уже идёт. Возврат из паузы продолжает с позиции в полёте. Файл проигрывается один раз, не зациклен.

Источник подключён к `rocketSampleBus` → master (минуя SFX highpass/compressor). Vite включает MP3 отдельным asset в production.

Настройка `configs/sfx.default.json` → `rocketSample`: gain 0.9, fadeInMs 0, fadeOutMs 1900.

## Пустое нитро

Нажатие «вверх» на машине без готового нитро не даёт ускорения: GameSim ставит короткий
`nitroDryPulse` (только presentation: чих двигателя + импульс машины + тряска пустой шкалы)
с кулдауном повторных срабатываний. Звук — патч `nitroDry` через обычную очередь SFX.

## Патчи и buses

См. `configs/sfx.default.json`, `src/core/sfx/defaults.ts`, Zod в `src/core/sfx/config.ts`.

## A/B и лаборатория

`/sfx-lab.html` — прослушивание патчей, сценарий car→horse→rocket, сравнение before/after.

## Запреты

- Не использовать `video.muted` для геймплейного аудио.
- RocketSample не идёт через общий SFX compressor chain (отдельный bus).

# Expert dynamic max speed (Skill Momentum)

## Цель

Для опытных игроков (tutorial пройден) постепенно поднимать потолок скорости до **+30%** от базового max режима, если долго едут чисто и быстро. При уроне HP — снижение к норме за ~15 с. Без HUD; лёгкая доп. тряска камеры.

## Не затрагивает

- Новичков (`tutorial` status ≠ veteran).
- LevelGen, Director, fairness.
- Урон от adrenaline-режима (отдельная система).

## Скаляр

`skillMomentum ∈ [0, 1]` → множитель cap:

```
effectiveCap = baseMax(mode) × (1 + skillMomentum × maxBonus)
```

`baseMax`: `speeds.max` (car/horse), `rocket.maxSpeed` (rocket).

Нитро / horse / rocket boost применяются **до** clamp к `effectiveCap` (как сейчас).

## Вход (gate)

Все условия одновременно:

1. `veteran` (tutorial завершён, localStorage).
2. `timeSinceLastHit ≥ 15` с.
3. EMA скорости ≥ порога (см. ниже).

Если порог не выполнен — momentum **не растёт**, но и **не падает** (кроме активного decay после урона).

## Порог скорости (80%, честно по нитро)

Порог считается от **достижимого** cap в текущем состоянии, не от фиксированных 28:

```
achievable = min(hardCap, rawSpeed × mult(state))
threshold = achievable × 0.8
```

`mult` учитывает director multiplier, нитро (`boostMax` × charge), horse momentum/overdrive, rocket phase boost. Так при активном нитро порог выше, когда нитро реально даёт запас до hardCap; без нитро — ниже, если rawSpeed ещё не вырос.

## Ошибка

Только **урон HP** (`registerHit` в classic/destroy). Запускает linear decay momentum к 0 за `rampDownSeconds` (15 с).

## Темп

| Параметр | Значение |
|----------|----------|
| `gateNoDamageSeconds` | 15 |
| `speedThresholdRatio` | 0.8 |
| `maxBonus` | 0.30 |
| `rampUpSeconds` | 20 |
| `rampDownSeconds` | 15 |
| `speedEmaSeconds` | 4 |

## Визуал

`postfx.shakeSkillMomentumBoost` — добавка к speedShake пропорционально `skillMomentum`. Без UI.

## Конфиг

`game.skillMomentum` + `game.postfx.shakeSkillMomentumBoost`.

## Файлы

- `src/core/gameplay/skillMomentum.ts` — чистая логика
- `PlayerSim.ts` — cap + update
- `GameSim.ts` — `setSkillMomentumEligible(veteran)`
- `bootstrap.ts` — синхронизация veteran
- `GameScene.ts` — camera shake

# Car Feel Update — план реализации

> Статус: реализовано (2026-08-28), playtest не принят.

## Решения пользователя (зафиксировано)

| # | Суть |
|---|------|
| 1 | Сфера коня на конце поезда **не спавнится**, если между игроком и сферой на крыше поезда есть красное препятствие, обход которого = съезд с поезда с уроном. Не считать «пропуск бонуса». |
| 2 | `anticipationSeconds` без изменений. Монеты по дуге. Плавный pickup → замедление → ускорение на плато. |
| 3 | Легковушка: реалистичные пропорции (не слишком узкая). Грузовик: чуть вытянутый, не фура. Compaction — на усмотрение агента. |
| 4 | Game over: **2 с** блокировки ввода, оверлей без отсчёта. |
| 5 | Нитро: чаще перестроение и охота на зелёное; **иногда** оставлять мощные ряды для smash. |
| 6 | Гибридный lane-commitment: органично, масштабируемо, не костыльно. |

---

## Волна 1 — изолированные фиксы

### 1.1 Конь на поезде (`GameSim`)
- Перед `maybeSpawnHorseBonusAtTrainEnd`: `canOfferHorseAtTrainEnd(train)`.
- Проверка: сфера на `targetZ`; между `playerTrainOffset` и `targetOffset` есть roof `tall`/`overhead` с `trainId`, обход только со съезда (коллизия с боковым tall на земле или невозможность остаться на крыше).
- Если нельзя взять без урона → **не спавнить**, **не** увеличивать `horseOffers` / не помечать overdue skip.
- Тесты: synthetic train + roof obstacle.

### 1.2 Game over delay (`bootstrap` + `HUD`)
- `gameOverAt`, `restartAllowedAt = gameOverAt + 2`.
- keydown при `gameOver` до таймаута — ignore.
- Оверлей сразу, без countdown.

---

## Волна 2 — feel

### 2.1 Ракета (`PlayerSim`, `GameSim` coins, `GameScene`)
- Anticipation: одновременно замедление + подъём по дуге к `peakHeight` (ease-in-out).
- Launch/plateau: без второго «телепорта».
- Air coins / rocket pattern: траектория следует `y(t)` anticipation+launch.
- Камера/nose sync.

### 2.2 Формы препятствий (все car)
- Конфиг profiles: `low` ~1.65×2.4 m, `tall` ~2.2×2.8 m, height scale.
- `Collision.ts`, `GameScene` per-kind boxes.
- `LevelGenerator` compaction после чанка:
  - micro cluster N → 1 micro, depth ∝ N
  - 2 adjacent low same lane → 1 low (depth ~1.6×minGapZ)
  - 3+ low chain → 1 low (cap depth)
  - adjacent tall merge (cap)
- `isPassable` regression tests.

---

## Волна 3 — levelgen баланс

### 3.1 Нитро traffic (Destroy + classic car где применимо)
- Cap greens per lane в nitro horizon window.
- Повысить tall на полосе игрока/соседних с passability guard.
- Сохранить `smashRowChance` / occasional dense green row для нитро-фантазии.

### 3.2 Lane commitment (гибрид)
- `LaneCommitmentTracker`: реальная полоса игрока + мягкий вес `constraintLane`.
- Порог 3–5 с (короче при нитro), конфигурируемо.
- Планировщик: если `timeOnLane > X` → tall в horizon на «застойной» полосе или сужение коридора (soft) / tall на полосе (hard), с `isPassableAsCar` fallback.
- Документ § в `update1-design.md` при стабилизации контракта.

---

## Проверки

- `npm run typecheck && npm run lint && npm run test`
- Playtest: поезд+конь, game over, ракета, формы, нитро 30 с, застой на полосе 5 с

## Порядок коммитов (логический)

1. Волна 1 → status/changelog  
2. Волна 2 → status/changelog  
3. Волна 3 → status/changelog + design §

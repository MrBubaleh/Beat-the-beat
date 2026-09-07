# Next Update — план ближайшего крупного обновления

> Статус: **реализовано (волны 1–6)**, S5 и A6 — после playtest.  
> Закрывать пункты — менять `[x]` и дату в § «Прогресс».

## Цель

Усилить **связь музыки с игрой** (juice, Director, levelgen) и **читаемую награду** в Adrenaline — без новых крупных механик.

---

## Решения из опроса (2026-08-23)

| Тема | Решение |
|------|---------|
| Flash полосок | **Тонкий** (~120 ms) |
| A2 hit-pause | **Только первый smash** в серии комбо |
| B1 turbo | **Виньетка** ~0.4 с, без текста |
| H4 beat launch | **Emissive** контура машины на бите |
| A6 calm/peak | **Отложено** — не трогать до playtest |

---

## Одобрено

| ID | Название | Статус |
|----|----------|--------|
| **S2** | Juice монет → ADREN | [x] |
| **+** | Фидбек полосок HP / нитро | [x] |
| **A1** | Near-miss VFX | [x] |
| **A2** | Smash hit-pause (1-й в серии) | [x] |
| **A4** | Horizon beat-kick | [x] |
| **A5** | Polish SMASH / combo | [x] |
| **A6** | Director: контраст calm/peak | ⏸ после playtest |
| **B1** | Turbo: визуальный вход | [x] |
| **B2** | Монеты → safeGuide | [x] |
| **B4** | Horse preset `horse-traffic` | [x] |
| **C3** | Coin pickup particles | [x] |
| **C4** | Vignette от Director | [x] |
| **C5** | Horizon + brightness | [x] |
| **H2** | Муз. сцена = коридор | [x] |
| **H4** | Beat launch VFX | [x] |
| **H5** | Ракета = спасение HP | [x] |
| **S5** | Beat-feel тюнинг | ⏸ только после playtest |

### Не входит

S1, A3, B5, H1.

---

## Волны (порядок выполнения)

```
[x] 1 HUD → [x] 2 Render → [x] 3 Near-miss → [x] 4 Director/LG → [x] 5 Stories → [x] 6 Horse preset → [ ] 7 S5
```

| Волна | Пункты | Playtest |
|-------|--------|----------|
| 1 | S2, +, A5 | — |
| 2 | C3, C4, C5, A4 | **нужен** (горизонт, перегруз VFX) |
| 3 | A1 | — |
| 4 | B2, B1, H2 (A6 пропущен) | **нужен** (turbo, коридор) |
| 5 | H4, H5, A2 | **нужен** (по одному ощущению) |
| 6 | B4 | при тесте коня |
| 7 | S5 | только если волны 1–6 не перегружают |

---

## Ключевые файлы

- `src/ui/HUD.ts` — волна 1
- `src/render/GameScene.ts`, `horizonVideoMaterial.ts` — волны 2, 4, 5
- `src/core/gameplay/GameSim.ts` — A1, H2, turbo tail
- `configs/levelgen.default.json`, `horse-traffic/` — B2, B4
- `src/core/gameplay/adrenalineHealth.ts` — H5 rescue multiplier

---

## Прогресс

| Волна | Статус | Дата |
|-------|--------|------|
| 1–6 | готово | 2026-08-23 |
| Playtest | ожидает пользователя | |
| 7 S5 | ждёт playtest | |
| A6 | ждёт playtest | |

---

## Проверки

`typecheck` ✓, `lint` ✓, unit **309/309** ✓ (2026-08-23).

Playtest: Adrenaline + `high-risk`, horizon-video, `mega-traffic` / `horse-traffic`, ~60 с.

# Camera presentation — машина и конь (dev)

> Статус: **реализовано, ждёт playtest** (2026-09-03).  
> Только визуал камеры; геймплей, хитбоксы, скорость — не трогать.

---

## 1. Цель

Кинематографичность без влияния на управление:

1. **Желейная камера** при поворотах; сильнее при быстрой серии в одну сторону.
2. **Реакция на удачный уворот** — чуть ниже и назад, со смещением от угрозы.

---

## 2. Серия поворотов (turn momentum)

### Поведение

- Отслеживать направление смены полосы (`lane` delta sign) и время между поворотами.
- Второй поворот **в ту же сторону** в окне **0.35 с** → накапливается `turnMomentum` (0…1).
- Поворот в другую сторону или пауза > 0.35 с → спад / сброс накопления.
- После последнего поворота в серии — экспоненциальный спад **~0.8 с** до 0.

### Влияние на камеру (машина, 100%)

| Канал | Эффект |
|-------|--------|
| **X (желе)** | Сильнее пружина/инерция `camX` (уже есть `CAM_X_JELLY_*`) |
| **Roll (крен)** | Доп. множитель к `bankTarget` |
| **Z** | Лёгкий откат назад (pullback), пропорционально `turnMomentum` |

### Конь

- Те же правила, множитель силы **~0.45** от машины (chase).
- **FPS-конь:** **~0.25**; откат по Z **почти выкл.** (≤10% от car), чтобы не ломать первое лицо.

### Конфликты

- Смешивать с нитро / green-pulse / ракетой: **clamp** итогового смещения камеры (потолок в конфиге).
- Game over / пауза → сброс `turnMomentum` и dodge-оффсетов.

### Tunables (`camera` или `cameraPresentation` в `game.default.json`)

| Параметр | Дефолт | Смысл |
|----------|--------|--------|
| `turnComboWindowSeconds` | `0.35` | Окно серии в одну сторону |
| `turnMomentumDecaySeconds` | `0.8` | Спад после серии |
| `turnJellyScaleMax` | `1.55` | Макс. усиление желе X |
| `turnBankScaleMax` | `1.35` | Макс. усиление крена |
| `turnPullbackZMax` | `0.42` | Макс. откат Z (машина) |
| `horsePresentationScale` | `0.45` | Множитель коня (chase) |
| `horseFpsPresentationScale` | `0.25` | Множитель коня (FPS) |
| `horseFpsPullbackScale` | `0.1` | Доля Z-отката в FPS |
| `presentationClampX` | `0.5` | Потолок presentation X (dodge) |
| `presentationClampY` | `0.28` | Потолок presentation Y (dip) |
| `presentationClampZ` | `0.9` | Потолок presentation Z (turn+dodge) |

---

## 3. Удачный уворот (dodge presentation)

### Триггеры (один импульс на событие)

Камера уворота **не** срабатывает от простого проезда рядом.

Нужно все сразу:

1. Игрок был на **полосе этого препятствия**, пока оно ещё впереди, затем **ушёл на другую полосу**.
2. Препятствие ушло назад (тот же Z-порог, что у near miss), без урона по нему.
3. Скорость игрока ≥ `dodgeMinSpeed` (дефолт **16** м/с — уже не стартовый темп).
4. Не micro, не поезд.

Один импульс на объект.

### Payload (из симуляции в snapshot)

```ts
{ x: number; y: number; z: number; threatSide: -1 | 1 } // threatSide = знак (obstacle.lane - player.lane)
```

### Реакция камеры (~0.16 с вход + ~0.10 с полка + ~0.42 с возврат)

- **Y** вниз на `dodgeDipY` (car default ~0.18 м).
- **Z** назад на `dodgePullbackZ` (car default ~0.35 м).
- **X** смещение **от угрозы** (в сторону текущей полосы).

Конь: те же формулы × `horsePresentationScale` / `horseFpsPresentationScale`.

### Tunables

| Параметр | Дефолт (car) |
|----------|----------------|
| `dodgeDipY` | `0.18` |
| `dodgePullbackZ` | `0.35` |
| `dodgeLateralX` | `0.22` |
| `dodgeMinSpeed` | `16` |
| `dodgeInSeconds` | `0.16` |
| `dodgeHoldSeconds` | `0.1` |
| `dodgeOutSeconds` | `0.42` |

---

## 4. Архитектура

```
GameSim: lane-escape + high speed → dodgeFx[] в GameSnapshot
GameScene: turnMomentum (lane history) + dodge offset stack → chase/FPS camera
```

- Логика серии поворотов — **render** (`GameScene`) или тонкий `cameraPresentation.ts` без Three.js.
- Триггеры уворота — **core** (`GameSim`), только факты; без импорта render.
- Не менять `fixedUpdate` dt.

### Файлы (ориентир)

- `src/render/GameScene.ts` — jelly, bank, Z, dodge offsets
- `src/core/gameplay/GameSim.ts` — lane-escape dodge events
- `configs/game.default.json` + schema + fallbacks
- Unit: turn momentum decay; dodge только после ухода с полосы угрозы, не от проезда рядом

---

## 5. Критерии приёмки

- [x] Два быстрых поворота в одну сторону заметно «желейнее» + крен + лёгкий Z (car).
- [x] Серия затухает ~0.8 с без залипания.
- [x] Уворот: dip + pullback + смещение от угрозы; только после смены полосы с препятствия, на высокой скорости; не дублируется на одном объекте.
- [x] Конь слабее машины; FPS-конь без агрессивного Z.
- [x] Нитро / green smash / ракета не ломаются (clamp).
- [x] typecheck + lint + test green.

---

## 6. Вне scope

- Слоу-мо на увороте
- Изменение near-miss наград (нитро / адреналин)
- Конь: отдельная анимация тела под dodge-cam

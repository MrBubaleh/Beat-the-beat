# Tutorial — дизайн и ТЗ (UPDATE 1, dev)

> Статус: **реализовано, ожидает playtest** (2026-09-02).  
> Scope: обучение новичка в режимах car / horse. Ракета — вне scope.

---

## 1. Цель

Пошагово научить трём базовым действиям:

1. Активировать **нитро** (машина).
2. **Прыгать** (конь).
3. **Подкатываться** (конь).

Визуал — 3D-стрелки в мире (референс: `trainRoofDodgeMarker` в `GameScene.ts`).  
При приближении к цели — **полное слоу-мо** (геймплей, спавн, VFX, аудио).

---

## 2. Статус игрока

| Значение | Поведение |
|----------|-----------|
| `novice` | Показывать обучение |
| `veteran` | Обучение выключено |

### Хранение (dev)

- `localStorage`, ключ: `mdr-tutorial-status`
- Значения: `'novice'` | `'veteran'`
- **Бинарный прогресс** — только статус; этапы **не** пишутся в storage
- Первый заход (нет ключа) → `novice`
- Все 3 этапа пройдены в ране → записать `veteran`
- Кнопка сброса → `novice` + сброс runtime-флагов этапов

### UI (debug)

- Маленькая кнопка **«новичок»** в левом углу (рядом с `AudioControls` / debug-зоной)
- `pointer-events: auto`, без отображения текущего статуса
- По клику: `localStorage` → `novice`, сброс этапов текущего рана

---

## 3. Порядок и режимы

- **Mode-gated:**
  - Этап nitro — только `player.mode === 'car'`
  - Этапы jump / slide — только `player.mode === 'horse'`
  - jump и slide **независимы** (любой порядок)
- **Все режимы** с car/horse геймплеем (Classic, Destroy, Adrenaline, …)
- **`rocket`:** обучение и слоу-мо **выключены**
- После выхода из rocket: если статус `novice` и этапы не завершены — продолжить с актуального этапа для текущего режима

### Runtime-флаги (память рана)

```ts
nitroStageDone: boolean
jumpStageDone: boolean
slideStageDone: boolean
```

Сброс: новый ран, кнопка «новичок», переход в `veteran`.

---

## 4. Этапы

### 4.1 Нитро (car)

**Пройден:** игрок **активировал нитро** хотя бы раз (`player.isAbilityActive` false→true при готовом нитро, или счётчик `runStats.nitroActivations`). Автоматическое включение при столкновении с medium и включение при переходе horse→car тоже засчитываются сразу, ровно один раз.

**Цель стрелки:** ближайший впереди **`kind === 'low'`** (medium), не `micro`, не `broken`, визуально «зелёный» (нитро ready).  
Мелкие (`micro`) **не** считаются целью обучения.

**Условия показа стрелки:**

- статус `novice`, `!nitroStageDone`
- `mode === 'car'`, не `gameOver`
- **нитро ready** (`nitroReady` в симе — вынести в `GameSnapshot` или эквивалент)
- нитро ещё не активировали в этом ране (до прохождения этапа)
- есть подходящая medium-цель впереди в допустимом окне дистанции

**Стрелка:**

- 3D, горизонтальная, чуть выше дороги, указывает на цель
- Цвет: **зелёный** градиент + пульс
- Привязана к позиции цели (двигается с препятствием)
- Пропустил цель → следующая подходящая

### 4.2 Прыжок (horse)

**Пройден:** **любой** успешный прыжок через препятствие (`horseJumpClears` +1 или существующий флаг clear в симе).

**Цель:** ближайшее впереди препятствие с `horseAction === 'jump'` на **текущей полосе** игрока, с запасом времени (не «в лицо»).

**Стрелка:** над препятствием, вверх, **бирюза**, пульс + перелив.  
Смена полосы → ретаргет на jump на новой полосе.  
Уклонился → следующая цель.

### 4.3 Подкат (horse)

**Пройден:** **любой** успешный slide (`horseSlideClears` +1).

**Цель:** `horseAction === 'slide'` на текущей полосе, те же правила дистанции.

**Стрелка:** над препятствием, **вниз**, бирюза, пульс + перелив.

---

## 5. Дистанции и тайминги (дефолты в конфиге)

Секция `tutorial` в `configs/game.default.json` (+ Zod + fallbacks).

| Параметр | Дефолт | Смысл |
|----------|--------|--------|
| `nitroArrowMinDistance` | `25` | Мин. Z до medium-цели для стрелки (м) |
| `nitroArrowMaxDistance` | `40` | Макс. Z; дальше — не показывать |
| `horseArrowMinTimeToObstacle` | `2.0` | Подкат: мин. время до контакта (с), при текущей скорости |
| `horseArrowMaxTimeToObstacle` | `5.0` | Подкат: макс. время; слишком далеко — ждём |
| `horseJumpArrowMinTimeToObstacle` | `1.3` | Прыжок: мин. время до контакта для выбора ближней цели |
| `horseJumpArrowMaxTimeToObstacle` | `3.0` | Прыжок: макс. время; более далёкие цели пока не отмечаем |
| `slowMoStartTimeToContact` | `1.1` | Вход в слоу-мо (с до контакта) |
| `slowMoPassTimeoutSeconds` | `0.5` | Проехал мимо без действия — выход из слоу-мо, ретаргет |
| `slowMoScale` | `0.35` | Множитель `dt` (0.35 = ~35% скорости) |
| `slowMoBlendSeconds` | `0.25` | Плавный вход/выход слоу-мо |
| `audioMinPlaybackRate` | `0.55` | Нижний предел rate |
| `audioPlaybackRatePower` | `1.0` | Связь rate ↔ timeScale (1:1) |
| `audioDetuneCents` | `-120` | Лёгкая коррекция тембра при замедлении |

Playtest-коррекция 2026-09-02: ожидание после пропуска сокращено с 2.5 до 0.5 с; плавный выход остаётся 0.25 с.

**Важно:** слоу-мо **не** при появлении цели вдали — только при `timeToContact <= slowMoStartTimeToContact`.

---

## 6. Слоу-мо

### Что замедляется

**Всё:** `GameSim.fixedUpdate`, variable update, render-side анимации, spawn/levelgen tick, Director consumers, аудио.

### Реализация (контракт)

- Глобальный `tutorialTimeScale` (1 или → `slowMoScale`) в `bootstrap` / `GameLoop`
- `fixedUpdate(dt * tutorialTimeScale)`
- `variableUpdate` / scenery — тот же scale
- `AudioSession.setTutorialPlaybackScale(scale)` — `playbackRate` + detune/EQ

### Выход из слоу-мо (сброс scale → 1)

- Этап пройден (успех)
- **Врезание** / провал препятствия
- **Таймаут** проезда мимо (`slowMoPassTimeoutSeconds`)
- **Game over**
- Смена режима, где этап неактуален (car→horse при незавершённом nitro — без слоу-мо до возврата в car)
- `mode === 'rocket'`
- Полёт и приземление после трамплина: `airSource === 'ramp'`, `airState === 'airborne' | 'landing'`; scale сразу 1, стрелки и старая HUD nitro-подсказка скрыты. Этапы сохраняются, после посадки обучение продолжается. Обычный horseJump не отключает tutorial.

---

## 7. Визуал стрелок

- **Референс:** `trainRoofDodgeMarker` (stem + cones), отдельный модуль `src/render/TutorialArrows.ts`
- **Nitro:** горизонтальная вдоль дороги от камеры в medium-цель, без бокового смещения, ~0.35 м над покрытием; зелёный emissive + gradient pulse
- **Jump:** вертикальная вверх, бирюза (`#2ec4b6` ориентир)
- **Slide:** вертикальная вниз (конус перевёрнут), бирюза
- Пульс: sin по времени, `renderOrder` ≥ 12; `depthTest/depthWrite` включены, стрелка перекрывается объектами сцены.
- Спокойное движение ±0.22 м вдоль действия, период ~1.57 с: nitro вперёд-назад по дороге, jump вверх-вниз, slide вниз-вверх. Нулевой dt замораживает анимацию.
- Одна активная стрелка за раз (приоритет: активный этап текущего режима; в horse — jump vs slide по ближайшей цели незавершённого этапа)

### Конфликт с HUD

- Существующая подсказка «Нажми пробел для нитро» (`HUD.nitroHintEl`) — **не показывать**, если статус `novice` и активна tutorial-стрелка nitro.

---

## 8. Архитектура

```
TutorialStorage (localStorage)
       ↓
TutorialController (app/ или core/ — без Three.js)
  reads: GameSnapshot, tutorial status, runtime stage flags
  writes: TutorialIntent { stage, targetObstacleId?, arrowKind, slowMoBlend, timeScale }
       ↓
bootstrap: apply timeScale to loop + AudioSession
GameScene: render TutorialArrows from intent
```

### Правила слоёв

- `core/` — чистая логика выбора цели, фаз, слоу-мо blend (без DOM/Three)
- `app/bootstrap.ts` — wiring, кнопка сброса
- `render/` — только меши стрелок
- **Не** ломать поток AudioAnalyzer → Director; слоу-мо — **вне** Director (time scale)

### Новые типы (черновик)

```ts
type TutorialStage = 'nitro' | 'jump' | 'slide' | null;

interface TutorialIntent {
  active: boolean;
  stage: TutorialStage;
  targetObstacleId: number | null;
  arrowPose: { x: number; y: number; z: number; yaw: number; pitch: number } | null;
  slowMoBlend: number; // 0..1 smoothed
  timeScale: number;
  arrowColor: 'green' | 'turquoise';
}
```

---

## 9. Критерии приёмки

Автопроверки: typecheck/lint/build ✓, unit 476/476 ✓; Chromium smoke проверил scale 0.35, rate 0.55, EQ detune −120, storage/reset, pause/resume и rocket-return. Галочки ниже отражают проверку реализации; feel и звук ждут пользовательского playtest.

- [x] Первый заход → novice, появляются стрелки по правилам
- [x] Nitro: стрелка только на `low` при nitro ready; micro игнорируются
- [x] Любая активация нитро закрывает этап nitro
- [x] Jump/slide: любой успешный jump/slide закрывает соответствующий этап
- [x] Все 3 этапа в одном ране → `veteran` в localStorage
- [x] Кнопка «новичок» сбрасывает статус и этапы
- [x] В rocket нет стрелок и слоу-мо
- [x] Слоу-мо включается только в зоне приближения, не сразу при появлении цели
- [ ] Аудио не «ломается» при слоу-мо (слуховая приёмка в playtest; browser rate/EQ проверены)
- [x] Unit-тесты: `TutorialController` выбор цели, фазы, выход из slow-mo
- [x] typecheck + lint + test green

---

## 10. Вне scope (позже)

- Обучение в rocket
- Текстовые туториал-попапы
- Levelgen «гарантированных» учебных препятствий
- Продакшен UI (кнопка остаётся debug)

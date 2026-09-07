# Destroy Update — план режима по умолчанию

> **Статус:** в разработке (волна 1+).  
> **Пауза:** [`adren-update.md`](adren-update.md) волна 4+ до MVP Destroy.  
> **Решения опроса:** 2026-08-26.

## Цель

Режим **Destroy** — дефолт вместо Classic. Цикл: уклоняйся от средних/высоких, ломай мелкие → копи нитро → дави средние. Высокие всегда опасны. Feel: Doom / FlatOut 2 / Burnout — просто и агрессивно.

## Решения (зафиксировано)

| Тема | Решение |
|------|---------|
| Средние (low) | **Жёлтые** до full nitro; **зелёные** при полной шкале; удар в жёлтый = soft (без смены HP, замедление, сброс комбо) |
| Высокие (tall) | Classic hit (−1 damageState), сброс комбо, умеренное замедление, **мигание персонажа** |
| Мелкие (micro) | Всегда зелёные; **автолом** при касании → нитро + комбо; без урона |
| Medium smash | При full nitro — разбивать **без активации** нитро |
| Монеты машины | Нет; micro-кластеры как «разновидность» трека, **не завал** |
| Увороты | Немного нитро, **без комбо** |
| HP HUD | Скрыт в Destroy |
| Classic / Adrenaline | Остаются в селекте |
| Damage audio | Глобально (все режимы): лёгкий lowpass/wet «как в шутере», без перебора |

## Три типа препятствий (машина)

| Тип | Kind | Визуал | Поведение |
|-----|------|--------|-----------|
| Высокий | `tall` | Красный грузовик | Урон classic, combo reset |
| Средний | `low` | Жёлтая легковая → зелёная @ full nitro | Soft / smash |
| Мелкий | `micro` | Зелёный бак/мопед (~½ low) | Автолом, нитро |

## Levelgen (Destroy, машина)

- Car coins **отключены**; вместо coin-chunks — **micro clusters** (2–4 в ряд, ~28% рядов, не каждый chunk).
- Плотность medium ↑ (`mediumDensityScale`), tall без перебора.
- Micro **не блокируют** проходимость (`isPassable` игнорирует micro).
- Конь / ракета: монеты и механики **без изменений**.

## Волны

| # | Содержание |
|---|------------|
| 0 | Этот документ, пауза adren-update |
| 1 | `gameplayRules: destroy`, config, `micro` kind |
| 2 | Combat: micro autobreak, soft/smash/tall, combo/nitro |
| 3 | Levelgen: clusters, no car coins |
| 4 | Render: micro/medium tint, hit blink, без cracks в Destroy |
| 5 | Global damage audio + HUD |
| 6 | Баланс playtest |

## Тест-сценарии

1. Micro ×5 подряд → nitro↑, combo↑, HP без изменений.
2. Удар в жёлтый medium без full nitro → damageState прежний, combo=0, flash.
3. Full nitro → medium зелёный, smash без Space → combo+1.
4. Tall ×3 → game over (classic ladder).
5. Уворот соседней полосы → чуть nitro, combo не растёт.

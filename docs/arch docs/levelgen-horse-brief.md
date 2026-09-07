# Levelgen Horse — brief (Mega Traffic mapping)

## Фазы коня (аналог car)

| Car (Mega Traffic) | Horse phase | Поведение |
|--------------------|-------------|-----------|
| stream | **corridor** | dodge-коридоры, stickiness полосы |
| weave | **weave** | jump↔slide, follow-up, длиннее группы |
| breather | **breather** | rest chunk, боковые монеты |
| nitroTease | **overdriveTease** | плотные action-группы, mandatory, jump-coins → momentum |

## Пресеты

Структура папки пресета:

- `car-phases.json` — машина
- `balance.json` — shared + car balance
- `horse-phases.json` — конь (фазы + точечные horse-tunables)

Select `gen` мержит все слои. Пресеты без `horse-phases.json` → `horse.phasesEnabled: false`.

## Инварианты (gate)

- `isPassable` horse на каждый preset id
- intro chunks: jump, затем slide
- max 2 одинаковых action подряд
- `slideToJumpMinGapZ` соблюдается

## Первый пресет

`mega-traffic/horse-phases.json` — стартовая точка для playtest коня.

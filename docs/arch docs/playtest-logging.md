# Playtest logging

Компактные session-логи + опрос после каждого забега.

## Как пользоваться

1. Загрузите видео (`Выбрать видео`). Имя файла: `Artist - Song Title.mp4`.
2. Играйте. Запись идёт **автоматически** с начала забега.
3. После **смерти** или **конца трека** появится опрос (2–4 вопроса). Заполните все пункты и нажмите **Отправить отзыв**.
4. Лог сохранится в **IndexedDB** браузера. Без опроса лог **не сохраняется**.
5. Кнопка **`⬇ logs (N)`** — экспорт всех накопленных логов в `playtest-export-YYYYMMDD.json`.

Вопросы опроса: `configs/playtest-survey.json` (звёзды с подписями слева/справа, выбор из списка).

## Формат (version 2)

Один session (~5–20 KB):

- `track` — метаданные трека
- `session` — seed, timestamps, `endReason`, progress
- `context` — ruleset, levelgen preset, build, FPS avg/min/p10, userAgent
- `survey` — ответы опроса
- `summary` — агрегаты забега
- `events` — до 500 событий (`hit`, `mode`, `bonus`, …)

## Анализ

```bash
node scripts/analyze-playtest.mjs path/to/playtest-export-20260831.json
node scripts/analyze-playtest.mjs path/to/folder/with/logs/
```

Скрипт пишет `*-report.md` или `playtest-report.md`. В чат с ИИ — **только report**, не сырые json.

## Replay vs playtest log

| | Replay (R) | Playtest log |
|--|------------|--------------|
| Цель | воспроизвести забег | статистика + субъективный фидбек |
| Размер | большой | компактный |
| Когда | отладка бага | каждый забег с опросом |

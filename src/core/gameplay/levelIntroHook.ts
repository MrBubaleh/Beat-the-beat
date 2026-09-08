import type { CoinEntity, ObstacleEntity } from '@core/levelgen/types';

/**
 * Интро-крючок 0–20 с (пункт 5 беты): компактное, динамичное, несложное начало.
 *
 * Чистый конструктор: дорожка подборов (3–5 с) → очевидный выбор полосы
 * (6–10 с) → одно читаемое препятствие (10–15 с) → короткая двухходовка
 * с наградой (15–20 с). Три варианта по seed, чтобы начало не повторялось
 * буквально. Действия вводятся по одному, с запасом времени.
 *
 * Всё в трек-секундах от GO; вызыватель переводит в дальность через
 * goDistance + time * speed. Метки времени уверенные (детерминировано).
 */

export interface IntroHookRequest {
  startLane: number;
  lanes: number;
  speed: number;
  goDistance: number;
  seed: number;
  /** В destroy вместо монет — мелкие объекты под смэш. */
  destroy: boolean;
  coinHeight: number;
  /** Поток полос: дальность считается под скорость встречи каждой полосы. */
  laneFlow: readonly number[];
}

export interface IntroHookContent {
  coins: CoinEntity[];
  obstacles: ObstacleEntity[];
  /** Единственная обязательная смена полосы: откуда/куда и в какое трек-время. */
  choice: { fromLane: number; toLane: number; fromTime: number; toTime: number };
}

export function introHookVariant(seed: number): 0 | 1 | 2 {
  return ((seed >>> 0) % 3) as 0 | 1 | 2;
}

function neighborLane(startLane: number, lanes: number, variant: 0 | 1 | 2): number {
  if (startLane <= 0) return 1;
  if (startLane >= lanes - 1) return lanes - 2;
  // Вариант 2 идёт в другую сторону — начало не повторяется буквально.
  return variant === 2 ? startLane - 1 : startLane + 1;
}

export function buildIntroHook(request: IntroHookRequest): IntroHookContent {
  const { startLane, lanes, speed, goDistance, seed, destroy, coinHeight, laneFlow } = request;
  const variant = introHookVariant(seed);
  const secondLane = neighborLane(startLane, lanes, variant);
  // Полоса препятствия: не та, где игрок после выбора (честный уворот).
  const hazardLane = variant === 1 ? startLane : secondLane;
  const freeLane = hazardLane === startLane ? secondLane : startLane;
  const coins: CoinEntity[] = [];
  const obstacles: ObstacleEntity[] = [];
  let coinId = -50000 - variant * 100;
  let obstacleId = -60000 - variant * 100;
  // Дальность под скорость встречи каждой полосы: иначе потоки полос
  // разнесут приезды и склеят ряды в чужих полосах (мёртвый маршрут).
  // Go-смещение тоже пополосное (goTime общее): иначе абсолютный сдвиг
  // съедает порядок между быстрой и медленной полосами.
  const goTime = goDistance / Math.max(speed, 1);
  const laneSpeed = (lane: number): number =>
    Math.max(1, speed + (laneFlow[lane] ?? 0));
  const zOf = (time: number, lane: number): number =>
    laneSpeed(lane) * (goTime + time);
  const stamp = (time: number) => ({
    time,
    cueId: 900000 + Math.round(time * 100),
    confidence: 1,
    role: 'collect' as const,
  });

  const pushPickup = (lane: number, time: number, y: number): void => {
    if (destroy) {
      obstacles.push({
        id: obstacleId--,
        kind: 'micro',
        lane,
        z: zOf(time, lane),
        routeGuide: true,
        musicTarget: stamp(time),
      });
      return;
    }
    coins.push({
      id: coinId--,
      lane,
      z: zOf(time, lane),
      y,
      collected: false,
      routeKind: 'safeGuide',
      musicTarget: stamp(time),
    });
  };

  // 3–5 с трека (0.5–2.5 с после GO с запасом): дорожка в стартовой полосе.
  for (let time = 0.5; time <= 2.5 + 1e-9; time += 0.4) {
    pushPickup(startLane, time, coinHeight);
  }
  // 6–10 с: дорожка уводит в соседнюю полосу — один очевидный выбор.
  // Зазор 2.4 с трека: окна хватает даже на сертификационных скоростях.
  for (let time = 4.9; time <= 6.9 + 1e-9; time += 0.4) {
    pushPickup(secondLane, time, coinHeight);
  }
  // 10–15 с: одно читаемое препятствие + гайды в свободной полосе.
  const hazardTime = 8.3;
  obstacles.push({
    id: obstacleId--,
    kind: 'low',
    lane: hazardLane,
    z: zOf(hazardTime, hazardLane),
    musicTarget: { ...stamp(hazardTime), role: 'dodge' },
  });
  for (let step = -1; step <= 1; step++) {
    pushPickup(freeLane, hazardTime + step * 0.4, coinHeight);
  }
  // 15–20 с: двухходовка — уворот и возврат в полосу препятствия за наградой.
  // (Два уворота подряд при разных потоках полос приезжали бы почти
  // одновременно — честно только так.)
  const dodgeTime = 11.0;
  obstacles.push({
    id: obstacleId--,
    kind: 'low',
    lane: freeLane,
    z: zOf(dodgeTime, freeLane),
    musicTarget: { ...stamp(dodgeTime), role: 'dodge' },
  });
  for (let time = 12.0; time <= 13.6 + 1e-9; time += 0.4) {
    pushPickup(hazardLane, time, coinHeight);
  }
  return { coins, obstacles, choice: { fromLane: startLane, toLane: secondLane, fromTime: 2.5, toTime: 4.9 } };
}

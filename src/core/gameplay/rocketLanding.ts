import type { GameConfig, LevelgenConfig } from '@core/config/schemas';
import type { ObstacleEntity, RampEntity } from '@core/levelgen/types';
import { findComfortableCarRoute } from '@core/levelgen/passability';
import type { MusicCue } from './musicPlanning';

/**
 * Безопасная посадка ракеты: fairness-слой.
 *
 * Чистый планировщик: по предсказанной точке посадки ищет ближайшее
 * сертифицированное окно в пределах ±landingAdjustMaxSeconds. Ничего не
 * удаляет и не переставляет — только возвращает поправку длительности полёта
 * и полосу посадки. Резерв коридора и grace после приземления — в GameSim /
 * LevelGenerator.
 */

export interface RocketLandingRequest {
  /** Предсказанная дальность полёта без поправки (метры от игрока). */
  baseDistance: number;
  /** Скорость машины после возвращения (м/с). */
  returnSpeed: number;
  /** Ускорение полёта: extra секунда круиза даёт speedBoost метров за метр. */
  cruiseBoost: number;
  /** Текущая полоса игрока. */
  lane: number;
  /** Горизонт препятствий относительно игрока (z >= -behind). */
  obstacles: readonly ObstacleEntity[];
  ramps: readonly RampEntity[];
  config: LevelgenConfig;
  game: GameConfig;
  /** Биты для предпочтения крутых посадок (даунбит/секция). */
  cues?: readonly MusicCue[];
  /** Трек-время подбора ракеты. */
  now?: number;
  /** Темп трека (тиков в секунду трека). */
  rate?: number;
  /** Игровые секунды от подбора до посадки без поправки. */
  baseFlightSeconds?: number;
}

export interface RocketLandingPlan {
  /** Поправка длительности круиза, уже ограниченная конфигом. */
  adjustSeconds: number;
  /** Полоса, в которой сертифицировано окно. */
  landingLane: number;
  /** true, если окна не нашлось: нужен fallback (продление + коридор). */
  fallback: boolean;
}

function isLandingHazard(obstacle: ObstacleEntity): boolean {
  if (obstacle.broken || obstacle.cleared || obstacle.collisionIgnored) return false;
  if (obstacle.trainId !== undefined) return false;
  return obstacle.kind !== 'micro';
}

function immediateBoxClear(
  request: RocketLandingRequest,
  landingDist: number,
  lane: number,
): boolean {
  const margin = Math.max(
    request.game.player.depth,
    request.returnSpeed * 0.25,
  );
  for (const obstacle of request.obstacles) {
    if (!isLandingHazard(obstacle)) continue;
    if (Math.abs(obstacle.lane - lane) > 1) continue;
    if (Math.abs(obstacle.z - landingDist) <= margin) return false;
  }
  return true;
}

function postWindowPassable(
  request: RocketLandingRequest,
  landingDist: number,
  lane: number,
): boolean {
  const { config } = request;
  const shifted = request.obstacles
    .filter(
      (obstacle) =>
        obstacle.z + Math.max(0, obstacle.zExtent ?? 0) / 2 >= landingDist,
    )
    .map((obstacle) => ({ ...obstacle, z: obstacle.z - landingDist }));
  const shiftedRamps = request.ramps
    .filter((ramp) => ramp.z >= landingDist)
    .map((ramp) => ({ ...ramp, z: ramp.z - landingDist }));
  const result = findComfortableCarRoute(shifted, config, shiftedRamps, {
    playerDistance: 0,
    playerSpeed: Math.max(request.returnSpeed, 1),
    startLanes: [lane],
  });
  return result.passable;
}

/** Безопасна ли посадка в точке (публично для даунбит-подбора в GameSim). */
export function isRocketLandingSafe(
  request: RocketLandingRequest,
  landingDist: number,
  lane: number,
): boolean {
  return (
    immediateBoxClear(request, landingDist, lane) &&
    postWindowPassable(request, landingDist, lane)
  );
}

/**
 * Тот же поиск окна, но среди кандидатов предпочитаем посадку на крутой
 * момент (даунбит, граница секции, сильная фраза) — в пределах безопасности.
 */
function coolLandingAdjust(
  request: RocketLandingRequest,
  maxAdjust: number,
  lanesToTry: number[],
): RocketLandingPlan | null {
  const cues = request.cues;
  if (!cues || cues.length === 0 || request.now === undefined) return null;
  const rate = Math.max(0.25, request.rate ?? 1);
  const speed = Math.max(request.returnSpeed, 1);
  const baseFlight =
    request.baseFlightSeconds ?? request.baseDistance / speed;
  const scored: { adjust: number; cool: number }[] = [];
  for (const cue of cues) {
    const cool = cue.downbeat ? 0 : cue.sectionStart ? 1 : cue.phrase ? 2 : 3;
    if (cool > 2) continue;
    const adjust = (cue.time - request.now) / rate - baseFlight;
    if (Math.abs(adjust) > maxAdjust + 1e-9) continue;
    scored.push({ adjust, cool });
  }
  scored.sort((a, b) => a.cool - b.cool || Math.abs(a.adjust) - Math.abs(b.adjust));
  for (const { adjust } of scored) {
    for (const lane of lanesToTry) {
      const landing = request.baseDistance + adjust * speed * request.cruiseBoost;
      if (landing <= 0) continue;
      if (!isRocketLandingSafe(request, landing, lane)) continue;
      return { adjustSeconds: adjust, landingLane: lane, fallback: false };
    }
  }
  return null;
}

export function planRocketLanding(
  request: RocketLandingRequest,
): RocketLandingPlan {
  const maxAdjust = Math.max(
    0,
    request.game.rocket.landingAdjustMaxSeconds,
  );
  const step = 0.25;
  const candidates: number[] = [0];
  for (let delta = step; delta <= maxAdjust + 1e-9; delta += step) {
    candidates.push(delta, -delta);
  }
  const lanesToTry = [request.lane];
  for (
    let offset = 1;
    offset < request.config.lanes;
    offset++
  ) {
    if (request.lane - offset >= 0) lanesToTry.push(request.lane - offset);
    if (request.lane + offset < request.config.lanes) {
      lanesToTry.push(request.lane + offset);
    }
  }
  // Сначала крутая посадка (даунбит/секция/фраза), потом ближайшее окно.
  const cool = coolLandingAdjust(request, maxAdjust, lanesToTry);
  if (cool) return cool;
  for (const adjust of candidates) {
    const landingDist =
      request.baseDistance + adjust * request.returnSpeed * request.cruiseBoost;
    if (landingDist <= 0) continue;
    for (const lane of lanesToTry) {
      if (!isRocketLandingSafe(request, landingDist, lane)) continue;
      return { adjustSeconds: adjust, landingLane: lane, fallback: false };
    }
  }
  // Предсказуемый fallback: ограниченное продление + заранее готовый коридор.
  return { adjustSeconds: maxAdjust, landingLane: request.lane, fallback: true };
}

import type { GameConfig, LevelgenConfig } from '@core/config/schemas';
import type { ObstacleEntity, RampEntity } from '@core/levelgen/types';
import { findComfortableCarRoute } from '@core/levelgen/passability';

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
  for (const adjust of candidates) {
    const landingDist =
      request.baseDistance + adjust * request.returnSpeed * request.cruiseBoost;
    if (landingDist <= 0) continue;
    for (const lane of lanesToTry) {
      if (!immediateBoxClear(request, landingDist, lane)) continue;
      if (!postWindowPassable(request, landingDist, lane)) continue;
      return { adjustSeconds: adjust, landingLane: lane, fallback: false };
    }
  }
  // Предсказуемый fallback: ограниченное продление + заранее готовый коридор.
  return { adjustSeconds: maxAdjust, landingLane: request.lane, fallback: true };
}

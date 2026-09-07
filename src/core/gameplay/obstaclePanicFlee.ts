import type { ObstacleEntity } from '@core/levelgen/types';

export interface ObstaclePanicFleeConfig {
  durationSeconds: number;
  minStartZ: number;
  maxStartZ: number;
  counterflowAlongSpeed: number;
  parallelAlongSpeed: number;
  lateralSpeed: number;
  lateralRampSeconds: number;
  alongRampSeconds: number;
  yawMaxRadians: number;
  yawRampSeconds: number;
}

export function canPanicFleeObstacle(obstacle: ObstacleEntity): boolean {
  if (obstacle.kind !== 'low') return false;
  if (obstacle.trainId !== undefined) return false;
  if (obstacle.unbreakable || obstacle.redWall) return false;
  if (obstacle.broken || obstacle.knockbackActive) return false;
  if (obstacle.panicFleeActive) return false;
  return true;
}

export function qualifiesForPanicFleeZ(
  z: number,
  cfg: ObstaclePanicFleeConfig,
): boolean {
  return z >= cfg.minStartZ && z <= cfg.maxStartZ;
}

export function panicFleeLateralSign(
  lane: number,
  lanePositions: readonly number[],
): number {
  if (lanePositions.length === 0) return 1;
  const laneX = lanePositions[lane] ?? 0;
  const leftDist = laneX - lanePositions[0];
  const rightDist = lanePositions[lanePositions.length - 1] - laneX;
  return leftDist <= rightDist ? -1 : 1;
}

export function startObstaclePanicFlee(
  obstacle: ObstacleEntity,
  laneFlow: readonly number[],
  lanePositions: readonly number[],
  cfg: ObstaclePanicFleeConfig,
): boolean {
  if (!canPanicFleeObstacle(obstacle)) return false;
  if (!qualifiesForPanicFleeZ(obstacle.z, cfg)) return false;

  const flow = laneFlow[obstacle.lane] ?? 0;
  const lateralSign = panicFleeLateralSign(obstacle.lane, lanePositions);
  obstacle.panicFleeActive = true;
  obstacle.panicFleeElapsed = 0;
  obstacle.panicFleeLateralSign = lateralSign;
  obstacle.panicFleeAlongSign = flow < 0 ? -1 : 1;
  obstacle.panicFleeYaw = 0;
  obstacle.panicFleeRemove = false;
  obstacle.collisionIgnored = true;
  obstacle.nitroMandatory = false;
  obstacle.nitroChallenge = false;
  obstacle.xOffset = obstacle.xOffset ?? 0;
  return true;
}

function ramp01(elapsed: number, rampSeconds: number): number {
  if (rampSeconds <= 0) return 1;
  return Math.min(1, Math.max(0, elapsed / rampSeconds));
}

export function updateObstaclePanicFlees(
  obstacles: ObstacleEntity[],
  dt: number,
  laneFlow: readonly number[],
  cfg: ObstaclePanicFleeConfig,
): void {
  for (const obstacle of obstacles) {
    if (!obstacle.panicFleeActive) continue;
    obstacle.panicFleeElapsed = (obstacle.panicFleeElapsed ?? 0) + dt;
    const elapsed = obstacle.panicFleeElapsed;
    const lateralSign = obstacle.panicFleeLateralSign ?? 1;
    const alongSign = obstacle.panicFleeAlongSign ?? 1;
    const flow = laneFlow[obstacle.lane] ?? 0;
    const alongMax =
      flow < 0 ? cfg.counterflowAlongSpeed : cfg.parallelAlongSpeed;
    const alongT = ramp01(elapsed, cfg.alongRampSeconds);
    const lateralT = ramp01(elapsed, cfg.lateralRampSeconds);
    const yawT = ramp01(elapsed, cfg.yawRampSeconds);
    const velZ = alongSign * alongMax * alongT;
    const velX = lateralSign * cfg.lateralSpeed * lateralT;
    obstacle.z += velZ * dt;
    obstacle.xOffset = (obstacle.xOffset ?? 0) + velX * dt;
    obstacle.panicFleeYaw = lateralSign * cfg.yawMaxRadians * yawT;
    if (elapsed >= cfg.durationSeconds) {
      obstacle.panicFleeActive = false;
      obstacle.panicFleeRemove = true;
    }
  }
}

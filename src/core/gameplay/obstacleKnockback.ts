import type { ObstacleEntity } from '@core/levelgen/types';

export type MediumKnockbackStyle = 'yellow' | 'green';

export interface MediumKnockbackConfig {
  lateralSpeed: number;
  arcUpSpeed: number;
  gravity: number;
  backwardSpeed: number;
  greenLateralSpeed: number;
  greenArcUpSpeed: number;
  greenGravity: number;
  greenForwardSpeed: number;
  yellowSpin: number;
  greenSpin: number;
  greenExplodeStrength: number;
  maxDurationSeconds: number;
  hitRadius: number;
}

export function startMediumKnockback(
  obstacle: ObstacleEntity,
  lane: number,
  laneCount: number,
  cfg: MediumKnockbackConfig,
  style: MediumKnockbackStyle,
): void {
  if (obstacle.kind !== 'low' || obstacle.unbreakable || obstacle.knockbackActive) return;
  const mid = (laneCount - 1) / 2;
  const outerSign = lane <= mid ? -1 : 1;
  obstacle.knockbackActive = true;
  obstacle.knockbackStyle = style;
  obstacle.knockbackLateralSign = outerSign;
  obstacle.knockbackElapsed = 0;
  if (style === 'green') {
    obstacle.knockbackVelX = 0;
    obstacle.knockbackVelY = cfg.greenArcUpSpeed;
    obstacle.knockbackVelZ = cfg.greenForwardSpeed;
    obstacle.knockbackSpin = outerSign * cfg.greenSpin;
    obstacle.knockbackBurstFx = true;
    obstacle.smashed = true;
    obstacle.penaltyBreak = true;
    obstacle.smashStrength = cfg.greenExplodeStrength;
  } else {
    obstacle.knockbackVelX = outerSign * cfg.lateralSpeed;
    obstacle.knockbackVelY = cfg.arcUpSpeed;
    obstacle.knockbackVelZ = cfg.backwardSpeed;
    obstacle.knockbackSpin = outerSign * cfg.yellowSpin;
  }
  obstacle.xOffset = 0;
  obstacle.yOffset = 0;
  obstacle.broken = true;
  obstacle.smashed = false;
  obstacle.penaltyBreak = false;
}

export function updateMediumKnockbacks(
  obstacles: ObstacleEntity[],
  dt: number,
  cfg: MediumKnockbackConfig,
  lanePositions: number[],
): void {
  for (const obstacle of obstacles) {
    if (!obstacle.knockbackActive) continue;
    const style = obstacle.knockbackStyle ?? 'yellow';
    const gravity = style === 'green' ? cfg.greenGravity : cfg.gravity;
    const lateralSign = obstacle.knockbackLateralSign ?? Math.sign(obstacle.knockbackVelX ?? 1);
    obstacle.knockbackElapsed = (obstacle.knockbackElapsed ?? 0) + dt;
    if (style === 'green') {
      const lateralBlend = Math.min(1, Math.max(0, ((obstacle.knockbackElapsed ?? 0) - 0.03) / 0.12));
      obstacle.knockbackVelX = lateralSign * cfg.greenLateralSpeed * lateralBlend;
    }
    obstacle.xOffset = (obstacle.xOffset ?? 0) + (obstacle.knockbackVelX ?? 0) * dt;
    obstacle.yOffset = (obstacle.yOffset ?? 0) + (obstacle.knockbackVelY ?? 0) * dt;
    obstacle.knockbackVelY = (obstacle.knockbackVelY ?? 0) - gravity * dt;
    obstacle.z += (obstacle.knockbackVelZ ?? 0) * dt;
    obstacle.knockbackSpin =
      (obstacle.knockbackSpin ?? 0) +
      dt * 7.5 * lateralSign;

    const ox = lanePositions[obstacle.lane] + (obstacle.xOffset ?? 0);
    const oy = (obstacle.y ?? 0) + (obstacle.yOffset ?? 0);
    const oz = obstacle.z;

    for (const other of obstacles) {
      if (other.id === obstacle.id || other.trainId !== undefined) continue;
      if (other.broken && !other.knockbackActive) continue;
      if (
        other.kind !== 'low' &&
        other.kind !== 'micro' &&
        other.kind !== 'tall' &&
        other.kind !== 'overhead'
      ) {
        continue;
      }
      if (other.z < oz - 0.2) continue;
      const tx = lanePositions[other.lane] + (other.xOffset ?? 0);
      const ty = (other.y ?? 0) + (other.yOffset ?? 0);
      const tz = other.z;
      if (Math.abs(ox - tx) > cfg.hitRadius) continue;
      if (Math.abs(oz - tz) > cfg.hitRadius) continue;
      if (Math.abs(oy - ty) > 2.4) continue;

      if (other.kind === 'tall' || other.kind === 'overhead') {
        finishKnockback(obstacle, true);
        break;
      }
      if ((other.kind === 'low' || other.kind === 'micro') && !other.broken) {
        other.broken = true;
        other.smashed = true;
        other.crushBroken = true;
        other.penaltyBreak = false;
      }
    }

    if (obstacle.knockbackActive) {
      const landed = (obstacle.yOffset ?? 0) <= 0 && (obstacle.knockbackVelY ?? 0) <= 0;
      if (
        obstacle.knockbackElapsed >= cfg.maxDurationSeconds ||
        (landed && obstacle.knockbackElapsed > 0.18)
      ) {
        finishKnockback(obstacle, false);
      }
    }
  }
}

function finishKnockback(obstacle: ObstacleEntity, explode: boolean): void {
  obstacle.knockbackActive = false;
  obstacle.knockbackVelX = 0;
  obstacle.knockbackVelY = 0;
  obstacle.knockbackVelZ = 0;
  obstacle.yOffset = Math.max(0, obstacle.yOffset ?? 0);
  obstacle.smashed = true;
  if (explode) obstacle.penaltyBreak = true;
}

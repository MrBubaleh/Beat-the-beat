import type { LevelgenConfig, NitroSalvationConfig } from '@core/config/schemas';
import type { ObstacleEntity, RampEntity } from '@core/levelgen/types';
import { isPassableAsCar } from '@core/levelgen/passability';
import type { DamageState } from './health';
import type { PlayerMode } from '@core/modes/types';

export interface SalvationContext {
  playerMode: PlayerMode;
  damageState: DamageState;
  nitroCharge: number;
  nitroMaxFill: number;
  songProgress: number;
  obstacles: ObstacleEntity[];
  ramps: RampEntity[];
  levelgen: LevelgenConfig;
}

export function isSalvationHealthRisk(damageState: DamageState): boolean {
  return damageState === 'critical';
}

export function assessAheadSection(
  obstacles: ObstacleEntity[],
  ramps: RampEntity[],
  levelgen: LevelgenConfig,
  cfg: NitroSalvationConfig,
): { passable: boolean; difficult: boolean } {
  const lookaheadZ = cfg.lookaheadRows * levelgen.minGapZ;
  const ahead = obstacles.filter(
    (obstacle) =>
      !obstacle.broken &&
      !obstacle.cleared &&
      !obstacle.collisionIgnored &&
      obstacle.z > 0 &&
      obstacle.z <= lookaheadZ,
  );
  const pass = isPassableAsCar(ahead, levelgen, ramps);
  if (!pass.passable) {
    return { passable: false, difficult: false };
  }

  const minGapZ = levelgen.minGapZ;
  const rowBlockedLanes = new Map<number, number>();
  let tallCount = 0;
  let hasMergedTall = false;

  for (const obstacle of ahead) {
    if (obstacle.kind === 'micro' || obstacle.kind === 'overhead') continue;
    if (obstacle.trainId !== undefined || obstacle.challengeId !== undefined) continue;
    const row = Math.round(obstacle.z / minGapZ);
    if (obstacle.kind === 'tall' || obstacle.redWall) {
      tallCount += 1;
      if (obstacle.zExtent !== undefined && obstacle.zExtent > 0) {
        hasMergedTall = true;
      }
    }
    if (obstacle.kind === 'low' || obstacle.kind === 'tall' || obstacle.redWall) {
      rowBlockedLanes.set(row, (rowBlockedLanes.get(row) ?? 0) + 1);
    }
  }

  let multiLaneRows = 0;
  for (const blocked of rowBlockedLanes.values()) {
    if (blocked >= 2) multiLaneRows += 1;
  }

  const difficult =
    multiLaneRows >= cfg.minMultiLaneRows ||
    tallCount >= cfg.minTallAhead ||
    hasMergedTall;

  return { passable: true, difficult };
}

export function salvationChance(
  songProgress: number,
  cfg: NitroSalvationConfig,
): number {
  const lateSpan = Math.max(0.001, 1 - cfg.lateProgressStart);
  const lateT = Math.max(0, (songProgress - cfg.lateProgressStart) / lateSpan);
  return Math.min(1, cfg.baseChance + cfg.lateProgressBonus * lateT);
}

export function qualifiesForSalvation(
  ctx: SalvationContext,
  cfg: NitroSalvationConfig,
): boolean {
  if (ctx.playerMode !== 'car') return false;
  const minCharge = ctx.nitroMaxFill * (cfg.minChargePercent / 100);
  if (ctx.nitroCharge < minCharge || ctx.nitroCharge >= ctx.nitroMaxFill) {
    return false;
  }
  if (!isSalvationHealthRisk(ctx.damageState)) return false;
  const ahead = assessAheadSection(
    ctx.obstacles,
    ctx.ramps,
    ctx.levelgen,
    cfg,
  );
  return ahead.passable && ahead.difficult;
}

export function applySalvationTopUp(
  chargeAfterGain: number,
  maxFill: number,
  roll: number,
  songProgress: number,
  cfg: NitroSalvationConfig,
  qualified: boolean,
): { charge: number; applied: boolean } {
  if (!qualified || chargeAfterGain >= maxFill) {
    return { charge: chargeAfterGain, applied: false };
  }
  const chance = salvationChance(songProgress, cfg);
  if (roll >= chance) {
    return { charge: chargeAfterGain, applied: false };
  }
  return { charge: maxFill, applied: true };
}

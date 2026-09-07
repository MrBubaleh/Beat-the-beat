import type { LevelgenConfig } from '@core/config/schemas';
import type { ObstacleEntity } from '@core/levelgen/types';

export type CarHazardKind = 'low' | 'tall';

export function minCarHazardCenterGap(
  previous: CarHazardKind,
  next: CarHazardKind,
  minGapZ: number,
  spacing: LevelgenConfig['carHazardSpacing'],
): number {
  if (previous === 'low' && next === 'low') {
    return minGapZ * spacing.lowLowMinGapScale;
  }
  if (previous === 'tall' && next === 'tall') {
    return minGapZ * spacing.tallTallMinGapScale;
  }
  return minGapZ * spacing.mixedMinGapScale;
}

export function nearestUpstreamCarHazard(
  obstacles: readonly ObstacleEntity[],
  lane: number,
  z: number,
): ObstacleEntity | null {
  let nearest: ObstacleEntity | null = null;
  for (const obstacle of obstacles) {
    if (obstacle.lane !== lane) continue;
    if (obstacle.kind !== 'low' && obstacle.kind !== 'tall') continue;
    if (obstacle.z >= z) continue;
    if (!nearest || obstacle.z > nearest.z) nearest = obstacle;
  }
  return nearest;
}

export function carHazardSpacingAllows(
  obstacles: readonly ObstacleEntity[],
  lane: number,
  z: number,
  kind: CarHazardKind,
  minGapZ: number,
  spacing: LevelgenConfig['carHazardSpacing'],
): boolean {
  const previous = nearestUpstreamCarHazard(obstacles, lane, z);
  if (!previous) return true;
  const previousKind = previous.kind as CarHazardKind;
  const minCenterGap = minCarHazardCenterGap(previousKind, kind, minGapZ, spacing);
  return z - previous.z >= minCenterGap - 1e-4;
}

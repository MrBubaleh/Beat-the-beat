import type { ObstacleEntity } from '@core/levelgen/types';

export function playerTrainOffset(trainZ: number): number {
  return -trainZ;
}

export function isTrainRoofBlockingHorsePath(
  obstacles: readonly ObstacleEntity[],
  trainId: number,
  playerOffset: number,
  horseOffset: number,
): boolean {
  const min = Math.min(playerOffset, horseOffset);
  const max = Math.max(playerOffset, horseOffset);
  if (max - min < 0.08) return false;
  for (const obstacle of obstacles) {
    if (obstacle.trainId !== trainId || obstacle.broken) continue;
    if (obstacle.kind !== 'tall' && obstacle.kind !== 'overhead') continue;
    const offset = obstacle.trainOffsetZ ?? 0;
    if (offset > min + 0.05 && offset < max - 0.05) return true;
  }
  return false;
}

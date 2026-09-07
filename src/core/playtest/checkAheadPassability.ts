import type { LevelgenConfig } from '@core/config/schemas';
import type { PlayerMode } from '@core/modes/types';
import type { ObstacleEntity, RampEntity } from '@core/levelgen/types';
import { isPassable, isPassableAsCar } from '@core/levelgen/passability';
import type { PassabilityRef } from './types';

export function checkAheadPassability(
  obstacles: ObstacleEntity[],
  ramps: RampEntity[],
  levelgen: LevelgenConfig,
  mode: PlayerMode,
): PassabilityRef {
  const horizon = levelgen.segmentsAhead * levelgen.chunkLength;
  const ahead = obstacles.filter(
    (obstacle) =>
      !obstacle.broken &&
      !obstacle.cleared &&
      !obstacle.collisionIgnored &&
      obstacle.z > 0 &&
      obstacle.z <= horizon,
  );
  const result =
    mode === 'car' || mode === 'rocket'
      ? isPassableAsCar(ahead, levelgen, ramps)
      : isPassable(ahead, levelgen, ramps, { asCar: false });
  return {
    passable: result.passable,
    reason: result.reason,
    mode,
  };
}

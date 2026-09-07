import type { LevelgenConfig } from '@core/config/schemas';
import type { ObstacleEntity } from './types';

export function carTrafficScrollSpeed(
  playerSpeed: number,
  lane: number,
  config: LevelgenConfig,
  obstacle?: Pick<ObstacleEntity, 'flowGroupId' | 'shoulderPasser' | 'redWall' | 'nitroChallenge'>,
): number {
  if (obstacle?.redWall || obstacle?.nitroChallenge) return Math.max(playerSpeed, 0.5);
  const laneFlow = config.laneFlow[lane] ?? 0;
  const flow = obstacle?.shoulderPasser
    ? (lane === 0 ? -14 : lane === config.lanes - 1 ? 14 : laneFlow) * config.shoulderPasserSpeedMultiplier
    : laneFlow * (obstacle?.flowGroupId === undefined ? 1 : config.multiLaneFlowFactor);
  return Math.max(playerSpeed + flow, 0.5);
}

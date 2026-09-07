import type { LevelgenConfig } from '@core/config/schemas';
import type { DamageState } from '@core/gameplay/health';
import type { PlayerMode } from '@core/modes/types';
import type { ObstacleEntity, RampEntity } from '@core/levelgen/types';
import { checkAheadPassability } from './checkAheadPassability';
import type { ObstacleRef, PlaytestEvent } from './types';

export function obstacleRef(
  obstacle: ObstacleEntity | undefined,
  source: ObstacleRef['source'],
): ObstacleRef | undefined {
  if (!obstacle) return undefined;
  return {
    kind: obstacle.kind,
    lane: obstacle.lane,
    z: Math.round(obstacle.z * 10) / 10,
    ...(obstacle.horseAction ? { horseAction: obstacle.horseAction } : {}),
    ...(obstacle.redWall ? { redWall: true } : {}),
    ...(obstacle.trainId !== undefined ? { trainId: obstacle.trainId } : {}),
    source,
  };
}

export function buildHitEvent(input: {
  t: number;
  p: number;
  mode: PlayerMode;
  lane: number;
  dmg: DamageState;
  obstacles: ObstacleEntity[];
  ramps: RampEntity[];
  levelgen: LevelgenConfig;
  obstacle?: ObstacleEntity;
  source: ObstacleRef['source'];
}): PlaytestEvent {
  return {
    e: 'hit',
    t: round2(input.t),
    p: round3(input.p),
    mode: input.mode,
    lane: input.lane,
    dmg: input.dmg,
    obs: obstacleRef(input.obstacle, input.source),
    passable: checkAheadPassability(
      input.obstacles,
      input.ramps,
      input.levelgen,
      input.mode,
    ),
  };
}

export function buildModeEvent(input: {
  t: number;
  p: number;
  from: PlayerMode;
  to: PlayerMode;
  reason?: string;
}): PlaytestEvent {
  return {
    e: 'mode',
    t: round2(input.t),
    p: round3(input.p),
    from: input.from,
    to: input.to,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

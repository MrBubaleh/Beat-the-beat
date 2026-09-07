import type { ObstacleEntity } from '@core/levelgen/types';

export type ObstacleVisualTheme = 'frontierTown';

export type ObstacleVisualVariant =
  | 'road-cones'
  | 'road-barrels'
  | 'road-tires'
  | 'road-barricade'
  | 'nitro-canister'
  | 'bicycle'
  | 'motor-scooter'
  | 'kick-scooter'
  | 'quad-bike'
  | 'cargo-trike'
  | 'sedan'
  | 'hatchback'
  | 'pickup'
  | 'coupe'
  | 'wagon'
  | 'box-truck'
  | 'city-bus'
  | 'coach'
  | 'dump-truck'
  | 'semi'
  | 'split-fence'
  | 'crate-stack'
  | 'hay-bales'
  | 'water-trough'
  | 'fallen-log'
  | 'ranch-gate'
  | 'saloon-awning'
  | 'mine-frame'
  | 'rock-arch'
  | 'station-frame'
  | 'stagecoach'
  | 'cargo-wagon'
  | 'bison'
  | 'mine-cart'
  | 'frontier-barricade'
  | 'boulder';

export interface ObstacleVisualChoice {
  variant: ObstacleVisualVariant;
  family: 'micro' | 'medium' | 'heavy' | 'horseJump' | 'horseSlide' | 'horseDodge';
}

const CAR_MEDIUM: readonly ObstacleVisualVariant[] = ['sedan', 'hatchback', 'pickup', 'coupe', 'wagon'];
const CAR_HEAVY: readonly ObstacleVisualVariant[] = ['box-truck', 'city-bus', 'coach', 'dump-truck', 'semi'];
const HORSE_JUMP: readonly ObstacleVisualVariant[] = ['crate-stack'];
const HORSE_SLIDE_OPEN: readonly ObstacleVisualVariant[] = ['ranch-gate', 'mine-frame', 'rock-arch'];
const HORSE_SLIDE_TOWN: readonly ObstacleVisualVariant[] = ['saloon-awning', 'ranch-gate', 'station-frame'];
const HORSE_DODGE_OPEN: readonly ObstacleVisualVariant[] = ['bison', 'cargo-wagon', 'boulder', 'stagecoach'];
const HORSE_DODGE_TOWN: readonly ObstacleVisualVariant[] = ['stagecoach', 'cargo-wagon', 'mine-cart', 'frontier-barricade'];

export function resolveObstacleVisual(
  obstacle: ObstacleEntity,
  horseVisual: boolean,
  _laneCount: number,
): ObstacleVisualChoice | null {
  if (obstacle.modePortal || obstacle.transitionGhost) return null;
  const key = obstacle.actionGroupId ?? obstacle.flowGroupId ?? obstacle.id;
  if (!horseVisual) {
    if (obstacle.kind === 'overhead') return null;
    if (obstacle.kind === 'micro') {
      return { variant: 'nitro-canister', family: 'micro' };
    }
    if (obstacle.kind === 'low') return { variant: choose(CAR_MEDIUM, key, obstacle.lane), family: 'medium' };
    return { variant: choose(CAR_HEAVY, key, obstacle.lane), family: 'heavy' };
  }

  const town = obstacle.visualTheme === 'frontierTown';
  if (obstacle.kind === 'overhead' || obstacle.horseAction === 'slide') {
    return { variant: choose(town ? HORSE_SLIDE_TOWN : HORSE_SLIDE_OPEN, key, obstacle.lane), family: 'horseSlide' };
  }
  if (obstacle.kind === 'low' || obstacle.horseAction === 'jump') {
    return { variant: choose(HORSE_JUMP, key, obstacle.lane), family: 'horseJump' };
  }
  return { variant: choose(town ? HORSE_DODGE_TOWN : HORSE_DODGE_OPEN, key, obstacle.lane), family: 'horseDodge' };
}

export function shouldReverseRoadObstacle(
  lane: number,
  laneFlow: readonly number[],
  horseVisual: boolean,
): boolean {
  if (horseVisual || laneFlow.length === 0) return false;
  let oncomingLane = -1;
  let strongestOncomingFlow = 0;
  for (let index = 0; index < laneFlow.length; index++) {
    const flow = laneFlow[index] ?? 0;
    if (flow > strongestOncomingFlow) {
      strongestOncomingFlow = flow;
      oncomingLane = index;
    }
  }
  if (oncomingLane < 0) return false;
  const roadMid = (laneFlow.length - 1) * 0.5;
  const oncomingSide = Math.sign(oncomingLane - roadMid);
  return oncomingSide !== 0 && Math.sign(lane - roadMid) === oncomingSide;
}

function choose(variants: readonly ObstacleVisualVariant[], key: number, lane: number): ObstacleVisualVariant {
  const hash = Math.imul(key ^ 0x45d9f3b, 0x27d4eb2d) ^ Math.imul(lane + 1, 0x165667b1);
  return variants[Math.abs(hash) % variants.length];
}

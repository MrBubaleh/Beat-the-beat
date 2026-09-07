import type { ObstacleEntity } from '@core/levelgen/types';
import type { GameConfig } from '@core/config/schemas';

export interface ObstacleFootprint {
  width: number;
  depth: number;
  height: number;
}

export interface ObstacleCollisionZRange {
  minZ: number;
  maxZ: number;
}

export function obstacleCollisionZRange(
  obstacle: ObstacleEntity,
  obstacleCfg: GameConfig['obstacle'],
  hit: GameConfig['hit'],
): ObstacleCollisionZRange {
  const depth = obstacleFootprint(obstacle, obstacleCfg).depth;
  const useRearTrim =
    !obstacle.redWall &&
    !obstacle.nitroMandatory &&
    (obstacle.kind === 'tall' ||
      obstacle.kind === 'overhead' ||
      obstacle.zExtent !== undefined);
  const rearTrim = useRearTrim ? depth * hit.zRearTrimRatio : 0;
  return {
    minZ: obstacle.z - depth / 2,
    maxZ: obstacle.z + depth / 2 - rearTrim,
  };
}

export function obstacleZIntersectsPlayer(
  obstacle: ObstacleEntity,
  obstacleCfg: GameConfig['obstacle'],
  playerDepth: number,
  hit: GameConfig['hit'],
): boolean {
  const depth = obstacleFootprint(obstacle, obstacleCfg).depth;
  const useRearTrim =
    !obstacle.redWall &&
    !obstacle.nitroMandatory &&
    (obstacle.kind === 'tall' ||
      obstacle.kind === 'overhead' ||
      obstacle.zExtent !== undefined);
  if (!useRearTrim) {
    const zTolerance = (depth + playerDepth) / 2 - hit.zGrace;
    return Math.abs(obstacle.z) <= zTolerance;
  }
  const { minZ: obstacleMinZ, maxZ: obstacleMaxZ } = obstacleCollisionZRange(
    obstacle,
    obstacleCfg,
    hit,
  );
  const playerMinZ = -playerDepth / 2 - hit.zGrace;
  const playerMaxZ = playerDepth / 2 + hit.zGrace;
  return obstacleMaxZ >= playerMinZ && obstacleMinZ <= playerMaxZ;
}

export function obstacleGroundBodyScale(
  obstacle: ObstacleEntity,
  cfg: GameConfig['obstacle'],
): { x: number; y: number; z: number } {
  const footprint = obstacleFootprint(obstacle, cfg);
  return {
    x: footprint.width / cfg.lowWidth,
    y: footprint.height,
    z: footprint.depth / cfg.lowDepth,
  };
}

export function obstacleFootprint(
  obstacle: ObstacleEntity,
  cfg: GameConfig['obstacle'],
): ObstacleFootprint {
  if (obstacle.kind === 'micro') {
    return {
      width: cfg.lowWidth * cfg.microWidthScale,
      depth: (obstacle.zExtent ?? cfg.lowDepth) * cfg.microDepthScale,
      height: cfg.microHeight,
    };
  }
  if (obstacle.kind === 'tall' || obstacle.kind === 'overhead') {
    if (obstacle.kind === 'overhead') {
      return {
        width: cfg.width,
        depth: obstacle.zExtent ?? cfg.depth,
        height: cfg.tallHeight,
      };
    }
    return {
      width: cfg.tallWidth,
      depth: obstacle.zExtent ?? cfg.tallDepth,
      height: cfg.tallHeight,
    };
  }
  return {
    width: cfg.lowWidth,
    depth: obstacle.zExtent ?? cfg.lowDepth,
    height: cfg.lowHeight,
  };
}

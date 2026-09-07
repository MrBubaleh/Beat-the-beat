import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import type { GameConfig } from '@core/config/schemas';
import type { ObstacleEntity } from '@core/levelgen/types';
import {
  obstacleCollisionZRange,
  obstacleFootprint,
  obstacleGroundBodyScale,
} from '@core/gameplay/obstacleFootprint';

const gameCfg = gameRaw as GameConfig;
const cfg = gameCfg.obstacle;

function visualSize(obstacle: ObstacleEntity) {
  const scale = obstacleGroundBodyScale(obstacle, cfg);
  return {
    width: cfg.lowWidth * scale.x,
    depth: cfg.lowDepth * scale.z,
    height: scale.y,
  };
}

describe('obstacle visual scale matches collision footprint', () => {
  it('keeps tall (red) length equal to the hitbox, not the low-car mesh', () => {
    const tall: ObstacleEntity = { id: 1, kind: 'tall', lane: 1, z: 0 };
    const hit = obstacleFootprint(tall, cfg);
    const visual = visualSize(tall);
    expect(hit.depth).toBe(cfg.tallDepth);
    expect(visual.depth).toBeCloseTo(hit.depth);
    expect(visual.width).toBeCloseTo(hit.width);
    expect(visual.height).toBeCloseTo(hit.height);
    expect(visual.depth).toBeGreaterThan(cfg.lowDepth * 1.5);
  });

  it('keeps compacted tall zExtent on both visual and collision', () => {
    const tall: ObstacleEntity = { id: 2, kind: 'tall', lane: 1, z: 2, zExtent: 5.712 };
    const hit = obstacleFootprint(tall, cfg);
    expect(visualSize(tall).depth).toBeCloseTo(hit.depth);
  });

  it('does not change low and micro matching', () => {
    const low: ObstacleEntity = { id: 3, kind: 'low', lane: 0, z: 0 };
    const micro: ObstacleEntity = { id: 4, kind: 'micro', lane: 0, z: 0 };
    expect(visualSize(low).depth).toBeCloseTo(obstacleFootprint(low, cfg).depth);
    expect(visualSize(micro).depth).toBeCloseTo(obstacleFootprint(micro, cfg).depth);
    expect(visualSize(micro).width).toBeCloseTo(obstacleFootprint(micro, cfg).width);
  });

  it('uses full depth for red walls instead of rear trim', () => {
    const z = 6;
    const depth = cfg.tallDepth;
    const rearTrim = depth * gameCfg.hit.zRearTrimRatio;
    const redWall: ObstacleEntity = {
      id: 5,
      kind: 'tall',
      lane: 1,
      z,
      redWall: true,
    };
    const plainTall: ObstacleEntity = { id: 6, kind: 'tall', lane: 1, z };
    const redRange = obstacleCollisionZRange(redWall, cfg, gameCfg.hit);
    const plainRange = obstacleCollisionZRange(plainTall, cfg, gameCfg.hit);
    expect(redRange.minZ).toBeCloseTo(plainRange.minZ);
    expect(redRange.maxZ - plainRange.maxZ).toBeCloseTo(rearTrim);
    expect(redRange.maxZ).toBeCloseTo(z + depth / 2);
  });
});

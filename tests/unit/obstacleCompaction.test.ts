import { describe, expect, it } from 'vitest';
import { compactGroundObstacles } from '@core/levelgen/obstacleCompaction';
import type { ObstacleEntity } from '@core/levelgen/types';

const compaction = {
  lowDepth: 2.32,
  tallDepth: 5.1,
  maxChainTall: 2,
  maxChainLow: 2,
};

describe('compactGroundObstacles', () => {
  it('merges at most two adjacent tall obstacles and caps merged depth', () => {
    const obstacles: ObstacleEntity[] = [
      { id: 1, kind: 'tall', lane: 1, z: 0 },
      { id: 2, kind: 'tall', lane: 1, z: 4 },
      { id: 3, kind: 'tall', lane: 1, z: 8 },
    ];
    compactGroundObstacles(obstacles, 4, compaction);
    expect(obstacles).toHaveLength(2);
    expect(obstacles[0].z).toBe(2);
    expect(obstacles[0].zExtent).toBeCloseTo(5.712, 2);
    expect(obstacles[1].z).toBe(8);
    expect(obstacles[1].zExtent).toBeUndefined();
  });

  it('does not let a same-row pair occupy a neighbouring row center', () => {
    const obstacles: ObstacleEntity[] = [
      { id: 1, kind: 'tall', lane: 1, z: 0 },
      { id: 2, kind: 'tall', lane: 1, z: 1 },
    ];
    compactGroundObstacles(obstacles, 4, compaction);
    expect(obstacles).toHaveLength(1);
    const half = (obstacles[0].zExtent ?? 0) / 2;
    expect(Math.abs(obstacles[0].z - 4)).toBeGreaterThan(half);
  });

  it('keeps long chains split into capped pairs', () => {
    const obstacles: ObstacleEntity[] = [
      { id: 1, kind: 'low', lane: 0, z: 0 },
      { id: 2, kind: 'low', lane: 0, z: 4 },
      { id: 3, kind: 'low', lane: 0, z: 8 },
      { id: 4, kind: 'low', lane: 0, z: 12 },
    ];
    compactGroundObstacles(obstacles, 4, compaction);
    expect(obstacles).toHaveLength(2);
    expect(obstacles[0].z).toBe(2);
    expect(obstacles[0].zExtent).toBeCloseTo(2.6, 2);
    expect(obstacles[1].z).toBe(10);
    expect(obstacles[1].zExtent).toBeCloseTo(2.6, 2);
  });

  it('does not merge tall chains when mergeTallChains is false', () => {
    const obstacles: ObstacleEntity[] = [
      { id: 1, kind: 'tall', lane: 1, z: 0 },
      { id: 2, kind: 'tall', lane: 1, z: 4 },
    ];
    compactGroundObstacles(obstacles, 4, { ...compaction, mergeTallChains: false });
    expect(obstacles).toHaveLength(2);
    expect(obstacles[0].zExtent).toBeUndefined();
    expect(obstacles[1].zExtent).toBeUndefined();
  });
});

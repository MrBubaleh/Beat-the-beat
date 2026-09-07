import { describe, expect, it } from 'vitest';
import { resolveObstacleCrushes } from '@core/gameplay/entityCrush';
import type { ObstacleEntity } from '@core/levelgen/types';

describe('entityCrush', () => {
  it('destroys micro when overlapping a larger obstacle', () => {
    const obstacles: ObstacleEntity[] = [
      { id: 1, kind: 'micro', lane: 1, z: 0 },
      { id: 2, kind: 'low', lane: 1, z: 0.1 },
    ];
    resolveObstacleCrushes(obstacles, [], 1.5);
    expect(obstacles[0].broken).toBe(true);
    expect(obstacles[0].crushBroken).toBe(true);
    expect(obstacles[1].broken).not.toBe(true);
  });

  it('destroys micro when overlapping tall', () => {
    const obstacles: ObstacleEntity[] = [
      { id: 1, kind: 'tall', lane: 0, z: 0 },
      { id: 2, kind: 'micro', lane: 0, z: 0.05 },
    ];
    resolveObstacleCrushes(obstacles, [], 1.5);
    expect(obstacles[1].broken).toBe(true);
    expect(obstacles[1].crushBroken).toBe(true);
  });
});

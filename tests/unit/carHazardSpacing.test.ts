import { describe, expect, it } from 'vitest';
import {
  carHazardSpacingAllows,
  minCarHazardCenterGap,
} from '@core/levelgen/carHazardSpacing';
import type { ObstacleEntity } from '@core/levelgen/types';

const spacing = {
  tallTallMinGapScale: 1.65,
  mixedMinGapScale: 1.35,
  lowLowMinGapScale: 1,
  compactTallChains: false,
};

describe('carHazardSpacing', () => {
  it('requires wider center gaps for tall-tall and mixed pairs than low-low', () => {
    const minGapZ = 4;
    expect(minCarHazardCenterGap('low', 'low', minGapZ, spacing)).toBe(4);
    expect(minCarHazardCenterGap('tall', 'low', minGapZ, spacing)).toBeCloseTo(5.4);
    expect(minCarHazardCenterGap('low', 'tall', minGapZ, spacing)).toBeCloseTo(5.4);
    expect(minCarHazardCenterGap('tall', 'tall', minGapZ, spacing)).toBeCloseTo(6.6);
  });

  it('rejects tall-tall placement on default row spacing', () => {
    const obstacles: ObstacleEntity[] = [{ id: 1, kind: 'tall', lane: 1, z: 0 }];
    expect(
      carHazardSpacingAllows(obstacles, 1, 4, 'tall', 4, spacing),
    ).toBe(false);
    expect(
      carHazardSpacingAllows(obstacles, 1, 6.6, 'tall', 4, spacing),
    ).toBe(true);
  });

  it('keeps low-low spacing unchanged on default row spacing', () => {
    const obstacles: ObstacleEntity[] = [{ id: 1, kind: 'low', lane: 1, z: 0 }];
    expect(
      carHazardSpacingAllows(obstacles, 1, 4, 'low', 4, spacing),
    ).toBe(true);
  });
});

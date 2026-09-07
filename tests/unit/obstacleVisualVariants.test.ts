import { describe, expect, it } from 'vitest';
import type { ObstacleEntity } from '@core/levelgen/types';
import {
  resolveObstacleVisual,
  shouldReverseRoadObstacle,
} from '../../src/render/obstacleVisualVariants';

const obstacle = (overrides: Partial<ObstacleEntity>): ObstacleEntity => ({
  id: 17,
  kind: 'micro',
  lane: 0,
  z: 20,
  ...overrides,
});

describe('obstacle visual variants', () => {
  it('uses a nitro canister for every car micro obstacle', () => {
    for (let lane = 0; lane < 4; lane++) {
      for (let id = 1; id <= 12; id++) {
        expect(resolveObstacleVisual(obstacle({ id, lane }), false, 4)?.variant).toBe(
          'nitro-canister',
        );
      }
    }
  });

  it('faces the oncoming lane and its shoulder backwards, but keeps horse actions forward', () => {
    const flow = [0, -6, 17, 0];
    expect(shouldReverseRoadObstacle(0, flow, false)).toBe(false);
    expect(shouldReverseRoadObstacle(1, flow, false)).toBe(false);
    expect(shouldReverseRoadObstacle(2, flow, false)).toBe(true);
    expect(shouldReverseRoadObstacle(3, flow, false)).toBe(true);
    expect(shouldReverseRoadObstacle(2, flow, true)).toBe(false);
    expect(shouldReverseRoadObstacle(3, flow, true)).toBe(false);
  });

  it('maps medium and tall car hazards to distinct vehicle families', () => {
    const medium = resolveObstacleVisual(obstacle({ kind: 'low', lane: 1 }), false, 4);
    const heavy = resolveObstacleVisual(obstacle({ kind: 'tall', lane: 1 }), false, 4);
    expect(medium?.family).toBe('medium');
    expect(heavy?.family).toBe('heavy');
    expect(medium?.variant).not.toBe(heavy?.variant);
  });

  it('uses town-specific horse slide and dodge silhouettes', () => {
    const slide = resolveObstacleVisual(
      obstacle({ kind: 'overhead', horseAction: 'slide', visualTheme: 'frontierTown' }),
      true,
      4,
    );
    const dodge = resolveObstacleVisual(
      obstacle({ kind: 'tall', horseDodgeOnly: true, visualTheme: 'frontierTown' }),
      true,
      4,
    );
    expect(['saloon-awning', 'ranch-gate', 'station-frame']).toContain(slide?.variant);
    expect(['stagecoach', 'cargo-wagon', 'mine-cart', 'frontier-barricade']).toContain(dodge?.variant);
  });

  it('uses crate stacks for all horse jump obstacles', () => {
    const open = resolveObstacleVisual(
      obstacle({ kind: 'low', horseAction: 'jump' }),
      true,
      4,
    );
    const town = resolveObstacleVisual(
      obstacle({ kind: 'low', horseAction: 'jump', visualTheme: 'frontierTown' }),
      true,
      4,
    );
    expect(open?.variant).toBe('crate-stack');
    expect(town?.variant).toBe('crate-stack');
  });

  it('is stable for the same entity and keeps portals generic', () => {
    const source = obstacle({ id: 91, lane: 2, kind: 'low' });
    expect(resolveObstacleVisual(source, false, 4)).toEqual(
      resolveObstacleVisual(source, false, 4),
    );
    expect(resolveObstacleVisual(obstacle({ modePortal: 'car' }), false, 4)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  isTrainRoofBlockingHorsePath,
  playerTrainOffset,
} from '@core/gameplay/trainHorseOffer';
import type { ObstacleEntity } from '@core/levelgen/types';

describe('trainHorseOffer', () => {
  it('derives player offset from train world z', () => {
    expect(playerTrainOffset(-12)).toBe(12);
  });

  it('detects a roof tall between player and horse offsets', () => {
    const obstacles: ObstacleEntity[] = [
      {
        id: 1,
        kind: 'tall',
        lane: 1,
        z: 0,
        trainId: 9,
        trainOffsetZ: 5,
        unbreakable: true,
      },
    ];
    expect(isTrainRoofBlockingHorsePath(obstacles, 9, 2, 8)).toBe(true);
    expect(isTrainRoofBlockingHorsePath(obstacles, 9, 6, 8)).toBe(false);
    expect(isTrainRoofBlockingHorsePath(obstacles, 9, 2, 4)).toBe(false);
  });
});

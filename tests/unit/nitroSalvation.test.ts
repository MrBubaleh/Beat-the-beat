import { describe, expect, it } from 'vitest';
import levelgenRaw from '../../configs/levelgen.default.json';
import gameRaw from '../../configs/game.default.json';
import type { LevelgenConfig } from '@core/config/schemas';
import type { GameConfig } from '@core/config/schemas';
import {
  applySalvationTopUp,
  assessAheadSection,
  qualifiesForSalvation,
  salvationChance,
} from '@core/gameplay/nitroSalvation';

const levelgen = levelgenRaw as LevelgenConfig;
const salvation = (gameRaw as GameConfig).nitro.salvation;

describe('nitroSalvation', () => {
  it('marks multi-lane passable sections as difficult', () => {
    const obstacles = [
      { id: 1, kind: 'low' as const, lane: 0, z: 4 },
      { id: 2, kind: 'low' as const, lane: 1, z: 4 },
      { id: 3, kind: 'low' as const, lane: 2, z: 8 },
      { id: 4, kind: 'low' as const, lane: 3, z: 8 },
    ];
    const result = assessAheadSection(obstacles, [], levelgen, salvation);
    expect(result.passable).toBe(true);
    expect(result.difficult).toBe(true);
  });

  it('does not qualify when ahead is impassable', () => {
    const obstacles = [
      { id: 1, kind: 'tall' as const, lane: 0, z: 4 },
      { id: 2, kind: 'tall' as const, lane: 1, z: 4 },
      { id: 3, kind: 'tall' as const, lane: 2, z: 4 },
      { id: 4, kind: 'tall' as const, lane: 3, z: 4 },
    ];
    expect(
      qualifiesForSalvation(
        {
          playerMode: 'car',
          damageState: 'critical',
          nitroCharge: 75,
          nitroMaxFill: 100,
          songProgress: 0.5,
          obstacles,
          ramps: [],
          levelgen,
        },
        salvation,
      ),
    ).toBe(false);
  });

  it('requires critical health and nitro between 60% and full', () => {
    const obstacles = [
      { id: 1, kind: 'low' as const, lane: 0, z: 4 },
      { id: 2, kind: 'low' as const, lane: 1, z: 4 },
      { id: 3, kind: 'low' as const, lane: 2, z: 8 },
      { id: 4, kind: 'low' as const, lane: 3, z: 8 },
    ];
    const base = {
      playerMode: 'car' as const,
      damageState: 'critical' as const,
      nitroCharge: 75,
      nitroMaxFill: 100,
      songProgress: 0.5,
      obstacles,
      ramps: [],
      levelgen,
    };
    expect(qualifiesForSalvation(base, salvation)).toBe(true);
    expect(
      qualifiesForSalvation({ ...base, damageState: 'damaged' }, salvation),
    ).toBe(false);
    expect(
      qualifiesForSalvation({ ...base, nitroCharge: 55 }, salvation),
    ).toBe(false);
    expect(
      qualifiesForSalvation({ ...base, nitroCharge: 100 }, salvation),
    ).toBe(false);
  });

  it('ramps chance toward the end of the song', () => {
    expect(salvationChance(0.2, salvation)).toBeCloseTo(0.16);
    expect(salvationChance(0.95, salvation)).toBeCloseTo(0.53, 1);
  });

  it('fills only the remaining nitro gap on success', () => {
    const topped = applySalvationTopUp(
      82,
      100,
      0,
      0.5,
      salvation,
      true,
    );
    expect(topped.charge).toBe(100);
    expect(topped.applied).toBe(true);
    const failed = applySalvationTopUp(
      82,
      100,
      0.99,
      0.5,
      salvation,
      true,
    );
    expect(failed.charge).toBe(82);
    expect(failed.applied).toBe(false);
  });
});

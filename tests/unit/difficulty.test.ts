import { describe, expect, it } from 'vitest';
import levelgenRaw from '../../configs/levelgen.default.json';
import type { LevelgenConfig } from '@core/config/schemas';
import { longRunDifficultyProgress, lateSongEaseFactor } from '@core/levelgen/difficulty';
import { LevelGenerator } from '@core/levelgen/LevelGenerator';
import { isPassable } from '@core/levelgen/passability';

describe('long-run difficulty', () => {
  const config = levelgenRaw as LevelgenConfig;

  it('starts after the grace period and eases gently to one', () => {
    const cfg = config.longRunDifficulty;
    expect(longRunDifficultyProgress(cfg.delaySeconds - 1, cfg)).toBe(0);
    expect(
      longRunDifficultyProgress(cfg.delaySeconds + cfg.rampSeconds / 2, cfg),
    ).toBeCloseTo(0.5, 5);
    expect(
      longRunDifficultyProgress(cfg.delaySeconds + cfg.rampSeconds + 1, cfg),
    ).toBe(1);
  });

  it('eases density down slightly near the end of the song', () => {
    const cfg = config.longRunDifficulty;
    expect(lateSongEaseFactor(0.5, cfg.lateSongEaseStartProgress, cfg.lateSongEaseMaxReduction)).toBe(1);
    expect(
      lateSongEaseFactor(1, cfg.lateSongEaseStartProgress, cfg.lateSongEaseMaxReduction),
    ).toBeCloseTo(1 - cfg.lateSongEaseMaxReduction, 5);
  });

  it('raises obstacle pressure modestly over a long run', () => {
    const stable: LevelgenConfig = {
      ...config,
      segmentWeights: { obstacle: 1, coins: 0, bonus: 0, empty: 0 },
      redWallProbability: 0,
      rampProbability: 0,
      wallProbability: 0,
    };
    const early = new LevelGenerator(stable, 73);
    early.setDensityMultiplier(0.35);
    early.setLongRunProgress(0);
    const late = new LevelGenerator(stable, 73);
    late.setDensityMultiplier(0.35);
    late.setLongRunProgress(1);
    const count = (generator: LevelGenerator): number =>
      generator.generateUpTo(500).reduce(
        (sum, chunk) => sum + chunk.obstacles.length,
        0,
      );
    const earlyCount = count(early);
    const lateCount = count(late);
    expect(lateCount).toBeGreaterThan(earlyCount);
    expect(lateCount).toBeLessThan(earlyCount * 1.5);
  });

  it('preserves a reachable route at maximum long-run pressure', () => {
    for (let seed = 0; seed < 20; seed++) {
      const generator = new LevelGenerator(config, seed);
      generator.setDensityMultiplier(0.9);
      generator.setLongRunProgress(1);
      const chunks = generator.generateUpTo(300);
      const obstacles = chunks.flatMap((chunk) => chunk.obstacles);
      const ramps = chunks.flatMap((chunk) => chunk.ramps);
      expect(isPassable(obstacles, config, ramps), `seed ${seed}`).toEqual({
        passable: true,
        reason: 'ok',
      });
    }
  }, 10_000);
});

import { describe, expect, it } from 'vitest';
import { gameConfigSchema, levelgenConfigSchema } from '@core/config/schemas';
import { lateRunProgress, scaleTowardEnd } from '@core/levelgen/difficulty';
import { LevelGenerator } from '@core/levelgen/LevelGenerator';
import { isPassableAsCar } from '@core/levelgen/passability';
import gameJson from '../configs/game.default.json';
import levelgenJson from '../configs/levelgen.default.json';

const game = gameConfigSchema.parse(gameJson);
const levelgen = levelgenConfigSchema.parse(levelgenJson);

function generateNitroTraffic(progress: number, destroyMode = true, seed = 0x51a7) {
  const generator = new LevelGenerator(levelgen, seed);
  generator.setDestroyCarMode(destroyMode, destroyMode ? game.destroy : null);
  generator.setCarTraffic(game.destroy);
  generator.setObstacleCompaction({
    lowDepth: game.obstacle.lowDepth,
    tallDepth: game.obstacle.tallDepth,
    maxChainTall: 2,
    maxChainLow: 2,
  });
  generator.setNitroActive(true);
  generator.setDestroyNitroTraffic(100_000, 0);
  generator.setSongProgress(progress);
  generator.setLongRunProgress(progress);
  return generator.generateUpTo(79);
}

describe('Destroy nitro late-run balance', () => {
  it('starts the smooth difficulty ramp at 40% progress', () => {
    expect(lateRunProgress(0.39, 0, 0.4)).toBe(0);
    expect(lateRunProgress(0.4, 0, 0.4)).toBe(0);
    expect(lateRunProgress(0.7, 0, 0.4)).toBeCloseTo(0.5);
    expect(lateRunProgress(1, 0, 0.4)).toBe(1);
    expect(scaleTowardEnd(0.65, 1)).toBe(0.65);
  });

  it('replaces part of the late nitro green flow with tall traffic', () => {
    const seeds = [0x51a7, ...Array.from({ length: 16 }, (_, index) => Math.imul(index + 1, 0x9e3779b1) >>> 0)];
    const early = seeds.flatMap(seed => generateNitroTraffic(0.4, true, seed));
    const late = seeds.flatMap(seed => generateNitroTraffic(1, true, seed));
    const count = (chunks: typeof early, kind: 'micro' | 'low' | 'tall') =>
      chunks.flatMap((chunk) => chunk.obstacles)
        .filter((obstacle) => obstacle.kind === kind).length;

    expect(count(late, 'micro')).toBeLessThan(count(early, 'micro'));
    expect(count(late, 'low')).toBeLessThan(count(early, 'low'));
    expect(count(late, 'tall')).toBeGreaterThan(count(early, 'tall'));
  });

  it('keeps every generated late-nitro chunk passable as car', () => {
    for (const destroyMode of [false, true]) {
      for (const chunk of generateNitroTraffic(1, destroyMode)) {
        expect(isPassableAsCar(chunk.obstacles, levelgen, chunk.ramps).passable)
          .toBe(true);
      }
    }
  });

  it('also reduces late low traffic in classic car mode', () => {
    const early = generateNitroTraffic(0.4, false)
      .flatMap((chunk) => chunk.obstacles);
    const late = generateNitroTraffic(1, false)
      .flatMap((chunk) => chunk.obstacles);
    expect(late.filter((obstacle) => obstacle.kind === 'low').length)
      .toBeLessThan(early.filter((obstacle) => obstacle.kind === 'low').length);
    expect(late.filter((obstacle) => obstacle.kind === 'tall').length)
      .toBeGreaterThan(early.filter((obstacle) => obstacle.kind === 'tall').length);
  });
});

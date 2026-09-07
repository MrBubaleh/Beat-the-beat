import { describe, expect, it } from 'vitest';
import { deepMerge } from '../../src/core/config/deepMerge';
import {
  LEVELGEN_PRESET_IDS,
  PLAYER_DIFFICULTY_PRESET_IDS,
  getLevelgenPresetMeta,
  mergeLevelgenOverrideLayers,
  resolveLevelgenPreset,
} from '../../src/core/config/levelgenPresets';
import levelgenRaw from '../../configs/levelgen.default.json';
import type { LevelgenConfig } from '../../src/core/config/schemas';
import { LevelGenerator } from '../../src/core/levelgen/LevelGenerator';
import {
  isPassable,
  isPassableAsCar,
} from '../../src/core/levelgen/passability';

describe('levelgen presets', () => {
  it('merges nested overrides', () => {
    const merged = deepMerge(
      { a: 1, horse: { actionChunkProbability: 0.5, slideGroupMin: 2 } },
      { horse: { actionChunkProbability: 0.9, slideGroupMin: 2 } },
    );
    expect(merged).toEqual({
      a: 1,
      horse: { actionChunkProbability: 0.9, slideGroupMin: 2 },
    });
  });

  it('resolves production preset to default config', () => {
    const base = levelgenRaw as LevelgenConfig;
    const resolved = resolveLevelgenPreset('production', base);
    expect(resolved).toEqual(base);
  });

  it('merges multiple override layers for structured-traffic', () => {
    const base = levelgenRaw as LevelgenConfig;
    const resolved = resolveLevelgenPreset('structured-traffic', base);
    expect(resolved.car.phasesEnabled).toBe(true);
    expect(resolved.nitroReadyChallengeProbability).toBe(0.15);
    expect(resolved.segmentWeights.coins).toBe(0.32);
    expect(mergeLevelgenOverrideLayers(base, [{ baseDensity: 0.4 }, { lanes: 4 }])).toEqual({
      ...base,
      baseDensity: 0.4,
    });
  });

  it('keeps the fixed shared/car/horse layer order for every preset', () => {
    for (const presetId of LEVELGEN_PRESET_IDS) {
      const preset = getLevelgenPresetMeta(presetId);
      expect(preset.overrideLayers).toEqual([
        preset.branches.shared,
        preset.branches.car.balance,
        preset.branches.horse.balance,
        preset.branches.car.phases,
        preset.branches.horse.phases,
      ]);
    }
  });

  it('enables both traffic phase branches for every player difficulty', () => {
    for (const presetId of PLAYER_DIFFICULTY_PRESET_IDS) {
      const resolved = resolveLevelgenPreset(presetId, levelgenRaw as LevelgenConfig);
      expect(resolved.car.phasesEnabled, presetId).toBe(true);
      expect(resolved.horse.phasesEnabled, presetId).toBe(true);
    }
  });

  it('keeps passability for every registered preset', () => {
    const base = levelgenRaw as LevelgenConfig;
    for (const presetId of LEVELGEN_PRESET_IDS) {
      const config = resolveLevelgenPreset(presetId, base);
      const generator = new LevelGenerator(config, 4242);
      generator.setDensityMultiplier(config.baseDensity);
      const chunks = generator.generateUpTo(80);
      const obstacles = chunks.flatMap((chunk) => chunk.obstacles);
      const ramps = chunks.flatMap((chunk) => chunk.ramps);
      expect(isPassableAsCar(obstacles, config, ramps).passable).toBe(true);
      generator.setMode('horse');
      const horseChunks = generator.generateUpTo(120);
      const horseObstacles = horseChunks.flatMap((chunk) => chunk.obstacles);
      expect(isPassable(horseObstacles, config).passable).toBe(true);
    }
  });
});

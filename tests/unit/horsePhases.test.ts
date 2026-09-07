import { describe, expect, it } from 'vitest';
import { HorsePhasePlanner } from '../../src/core/levelgen/horsePhases';
import type { LevelgenConfig } from '../../src/core/config/schemas';
import levelgenRaw from '../../configs/levelgen.default.json';
import {
  PLAYER_DIFFICULTY_PRESET_IDS,
  resolveLevelgenPreset,
} from '../../src/core/config/levelgenPresets';
import { LevelGenerator } from '../../src/core/levelgen/LevelGenerator';
import { mulberry32 } from '../../src/core/levelgen/prng';

describe('HorsePhasePlanner', () => {
  const config = (levelgenRaw as LevelgenConfig).horse;

  it('returns neutral modifiers when phases are disabled', () => {
    const planner = new HorsePhasePlanner();
    const modifiers = planner.advanceChunk(
      () => 0.5,
      { ...config, phasesEnabled: false },
      0.5,
    );
    expect(modifiers.activePhase).toBeNull();
    expect(modifiers.actionChunkScale).toBe(1);
  });

  it('cycles through configured phases', () => {
    const planner = new HorsePhasePlanner();
    const enabled = { ...config, phasesEnabled: true };
    const phases = new Set(
      Array.from({ length: 120 }, (_, index) => {
        const modifiers = planner.advanceChunk(() => ((index * 19) % 97) / 97, enabled, 0.2);
        return modifiers.activePhase;
      }),
    );
    expect(phases.size).toBeGreaterThanOrEqual(3);
    expect(phases.has('weave')).toBe(true);
  });

  it('enables horse phases for mega-traffic preset', () => {
    const resolved = resolveLevelgenPreset('mega-traffic', levelgenRaw as LevelgenConfig);
    expect(resolved.horse.phasesEnabled).toBe(true);
    expect(resolved.horse.phaseWeights.overdriveTease).toBe(0.14);
  });

  it('generates at least three horse phases in 200 chunks for each player preset', () => {
    for (const presetId of PLAYER_DIFFICULTY_PRESET_IDS) {
      const resolved = resolveLevelgenPreset(presetId, levelgenRaw as LevelgenConfig);
      const planner = new HorsePhasePlanner();
      const rng = mulberry32(8128);
      const phases = new Set(
        Array.from({ length: 200 }, (_, index) =>
          planner.advanceChunk(rng, resolved.horse, index / 199).activePhase),
      );
      expect(phases.size, presetId).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps horse ground guides from long same-lane streaks', () => {
    for (const presetId of PLAYER_DIFFICULTY_PRESET_IDS) {
      const resolved = resolveLevelgenPreset(presetId, levelgenRaw as LevelgenConfig);
      const generator = new LevelGenerator(resolved, 9917);
      generator.setMode('horse');
      let guideCount = 0;
      for (let index = 0; index < 80; index++) {
        const chunk = generator.generateChunk(index);
        const groundGuides = chunk.coins
          .filter(
            (item) =>
              item.routeKind === 'safeGuide' &&
              item.actionGroupId === undefined &&
              (item.y ?? resolved.coinHeight) <= resolved.coinHeight + 0.01,
          )
          .sort((a, b) => a.z - b.z);
        guideCount += groundGuides.length;
        let maxStreak = groundGuides.length > 0 ? 1 : 0;
        let streak = groundGuides.length > 0 ? 1 : 0;
        let previousLane = groundGuides[0]?.lane;
        for (let coinIndex = 1; coinIndex < groundGuides.length; coinIndex++) {
          const coin = groundGuides[coinIndex];
          streak = coin.lane === previousLane ? streak + 1 : 1;
          previousLane = coin.lane;
          maxStreak = Math.max(maxStreak, streak);
        }
        expect(
          maxStreak,
          `${presetId}/${index}`,
        ).toBeLessThanOrEqual(resolved.horse.coinMaxSameLaneStreak + 1);
      }
      expect(guideCount, presetId).toBeGreaterThan(0);
    }
  });
});

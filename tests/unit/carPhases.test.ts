import { describe, expect, it } from 'vitest';
import { CarPhasePlanner } from '../../src/core/levelgen/carPhases';
import type { LevelgenConfig } from '../../src/core/config/schemas';
import levelgenRaw from '../../configs/levelgen.default.json';

describe('CarPhasePlanner', () => {
  const config = (levelgenRaw as LevelgenConfig).car;

  it('returns neutral modifiers when phases are disabled', () => {
    const planner = new CarPhasePlanner();
    const modifiers = planner.advanceChunk(
      () => 0.5,
      { ...config, phasesEnabled: false },
      0.5,
    );
    expect(modifiers.activePhase).toBeNull();
    expect(modifiers.densityScale).toBe(1);
  });

  it('cycles through configured phases', () => {
    const planner = new CarPhasePlanner();
    const enabled = { ...config, phasesEnabled: true };
    const phases = new Set(
      Array.from({ length: 120 }, (_, index) => {
        const modifiers = planner.advanceChunk(() => ((index * 17) % 97) / 97, enabled, 0.2);
        return modifiers.activePhase;
      }),
    );
    expect(phases.size).toBeGreaterThanOrEqual(3);
    expect(phases.has('weave')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import {
  ADRENALINE_PRESET_IDS,
  mergeAdrenalineOverrideLayers,
  resolveAdrenalinePreset,
  resolveGameWithAdrenalinePreset,
} from '../../src/core/config/adrenalinePresets';
import type { AdrenalineConfig, GameConfig } from '../../src/core/config/schemas';

describe('adrenaline presets', () => {
  it('resolves default preset to base adrenaline config', () => {
    const base = gameRaw as GameConfig;
    const resolved = resolveAdrenalinePreset('default', base);
    expect(resolved).toEqual(base.adrenaline);
  });

  it('merges override layers for high-risk', () => {
    const base = gameRaw as GameConfig;
    const resolved = resolveAdrenalinePreset('high-risk', base);
    expect(resolved.passiveDrainPerSecond).toBe(6.8);
    expect(resolved.collisionDamage).toBe(30);
    expect(resolved.damagedThresholdPercent).toBe(50);
    expect(resolved.criticalThresholdPercent).toBe(25);
    expect(resolved.max).toBe(base.adrenaline.max);
  });

  it('merges override layers for ox-alpha (slow strangle)', () => {
    const base = gameRaw as GameConfig;
    const resolved = resolveAdrenalinePreset('ox-alpha', base);
    expect(resolved.passiveDrainPerSecond).toBe(4.5);
    expect(resolved.passiveDrainPerSecond).not.toBe(base.adrenaline.passiveDrainPerSecond);
    expect(resolved.idleLaneDrainBonus).toBe(2.2);
    expect(resolved.idleLaneDrainBonus).not.toBe(base.adrenaline.idleLaneDrainBonus);
    expect(resolved.damagedThresholdPercent).toBe(50);
    expect(resolved.criticalThresholdPercent).toBe(25);
    expect(resolved.gainCoin).toBe(base.adrenaline.gainCoin);
    expect(resolved.collisionDamage).toBe(base.adrenaline.collisionDamage);
  });

  it('merges override layers for grok-pressure (tempo cooker)', () => {
    const base = gameRaw as GameConfig;
    const resolved = resolveAdrenalinePreset('grok-pressure', base);
    expect(resolved.passiveDrainPerSecond).toBe(7.2);
    expect(resolved.passiveDrainPerSecond).not.toBe(base.adrenaline.passiveDrainPerSecond);
    expect(resolved.idleLaneDrainBonus).toBe(1.95);
    expect(resolved.gainNearMiss).toBe(4);
    expect(resolved.gainNearMiss).not.toBe(base.adrenaline.gainNearMiss);
    expect(resolved.collisionDamage).toBe(base.adrenaline.collisionDamage);
    expect(resolved.damagedThresholdPercent).toBe(base.adrenaline.damagedThresholdPercent);
    expect(resolved.criticalNitroGainMultiplier).toBe(base.adrenaline.criticalNitroGainMultiplier);
  });

  it('merges override layers for gpt-5-redline (managed red zone)', () => {
    const base = gameRaw as GameConfig;
    const resolved = resolveAdrenalinePreset('gpt-5-redline', base);
    expect(resolved.passiveDrainPerSecond).toBe(6.3);
    expect(resolved.gainNearMiss).toBe(4.5);
    expect(resolved.collisionDamage).toBe(base.adrenaline.collisionDamage);
  });
  it('merges nested partial overrides', () => {
    const base = { max: 100, gainCoin: 1 } as AdrenalineConfig;
    const merged = mergeAdrenalineOverrideLayers(base, [{ gainCoin: 2.5 }, { gainSmash: 9 }]);
    expect(merged).toEqual({ max: 100, gainCoin: 2.5, gainSmash: 9 });
  });

  it('resolves every registered preset', () => {
    const base = gameRaw as GameConfig;
    for (const presetId of ADRENALINE_PRESET_IDS) {
      const game = resolveGameWithAdrenalinePreset(presetId, base);
      expect(game.adrenaline.max).toBeGreaterThan(0);
      expect(game.adrenaline.passiveDrainPerSecond).toBeGreaterThan(0);
    }
  });
});

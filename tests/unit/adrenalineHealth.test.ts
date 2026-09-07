import { describe, expect, it } from 'vitest';
import {
  adrenalineCoinGainMultiplier,
  applyAdrenalineCollision,
  gainAdrenaline,
  syncDamageStateFromAdrenaline,
  updateAdrenaline,
} from '../../src/core/gameplay/adrenalineHealth';
import type { AdrenalineConfig } from '../../src/core/config/schemas';

const cfg: AdrenalineConfig = {
  max: 100,
  start: 100,
  passiveDrainPerSecond: 10,
  drainRampSeconds: 0,
  drainStartScale: 1,
  idleLaneSeconds: 2,
  idleLaneDrainBonus: 2,
  rocketDrainMultiplier: 1,
  collisionDamage: 25,
  collisionLowHpThreshold: 28,
  collisionLowHpMultiplier: 1,
  damagedThresholdPercent: 60,
  criticalThresholdPercent: 30,
  criticalNitroGainMultiplier: 1.55,
  gainSmash: 15,
  gainCoin: 3,
  gainCoinCarMultiplier: 1.22,
  gainCoinHorseMultiplier: 1.22,
  gainCoinRocketMultiplier: 1.45,
  gainNearMiss: 4,
  gainHorseJumpClear: 8,
  gainHorseSlideClear: 6,
  gainNitroBurst: 0,
  nearMissMaxZ: -0.5,
};

describe('adrenalineHealth', () => {
  it('scales coin gain by player mode', () => {
    expect(adrenalineCoinGainMultiplier('car', cfg)).toBe(1.22);
    expect(adrenalineCoinGainMultiplier('horse', cfg)).toBe(1.22);
    expect(adrenalineCoinGainMultiplier('rocket', cfg)).toBe(1.45);
    expect(
      adrenalineCoinGainMultiplier('car', cfg, { airborneCar: true }),
    ).toBe(1.45);
  });

  it('maps adrenaline to damage stages for visuals', () => {
    expect(syncDamageStateFromAdrenaline(80, cfg)).toBe('normal');
    expect(syncDamageStateFromAdrenaline(50, cfg)).toBe('damaged');
    expect(syncDamageStateFromAdrenaline(20, cfg)).toBe('critical');
  });

  it('drains faster on idle lane', () => {
    const state = {
      adrenaline: 100,
      laneIdleSeconds: 0,
      isHit: false,
      damageState: 'normal' as const,
      recoveryTimer: 0,
      timeSinceLastHit: 0,
    };
    const iframe = { timer: 0 };
    updateAdrenaline(state, 1, iframe, cfg, {
      rocketMode: false,
      laneChanged: false,
      runSeconds: 0,
    });
    const afterIdle = { ...state, laneIdleSeconds: 3 };
    updateAdrenaline(afterIdle, 1, iframe, cfg, {
      rocketMode: false,
      laneChanged: false,
      runSeconds: 0,
    });
    expect(100 - state.adrenaline).toBeLessThan(100 - afterIdle.adrenaline);
  });

  it('drains slower at the start of the run', () => {
    const rampCfg: AdrenalineConfig = {
      ...cfg,
      passiveDrainPerSecond: 10,
      drainRampSeconds: 40,
      drainStartScale: 0.5,
      idleLaneDrainBonus: 1,
      idleLaneSeconds: 99,
    };
    const early = {
      adrenaline: 100,
      laneIdleSeconds: 0,
      isHit: false,
      damageState: 'normal' as const,
      recoveryTimer: 0,
      timeSinceLastHit: 0,
    };
    const late = { ...early };
    updateAdrenaline(early, 1, { timer: 0 }, rampCfg, {
      rocketMode: false,
      laneChanged: false,
      runSeconds: 5,
    });
    updateAdrenaline(late, 1, { timer: 0 }, rampCfg, {
      rocketMode: false,
      laneChanged: false,
      runSeconds: 40,
    });
    expect(100 - early.adrenaline).toBeLessThan(100 - late.adrenaline);
  });

  it('collision damage scales with current adrenaline', () => {
    const state = {
      adrenaline: 100,
      laneIdleSeconds: 0,
      isHit: false,
      damageState: 'normal' as const,
      recoveryTimer: 0,
      timeSinceLastHit: 0,
    };
    const iframe = { timer: 0 };
    applyAdrenalineCollision(state, cfg, iframe, { iframeSeconds: 0.8 });
    expect(state.adrenaline).toBe(75);

    const low = { ...state, adrenaline: 40 };
    applyAdrenalineCollision(low, cfg, iframe, { iframeSeconds: 0.8 });
    expect(low.adrenaline).toBe(30);
  });

  it('collision can game over at zero with full-ratio hit', () => {
    const lethalCfg: AdrenalineConfig = {
      ...cfg,
      collisionDamage: 100,
    };
    const state = {
      adrenaline: 20,
      laneIdleSeconds: 0,
      isHit: false,
      damageState: 'normal' as const,
      recoveryTimer: 0,
      timeSinceLastHit: 0,
    };
    const iframe = { timer: 0 };
    const result = applyAdrenalineCollision(state, lethalCfg, iframe, { iframeSeconds: 0.8 });
    expect(result).toBe('gameOver');
    expect(state.adrenaline).toBe(0);
  });

  it('pauses passive drain during hit iframe', () => {
    const state = {
      adrenaline: 100,
      laneIdleSeconds: 0,
      isHit: true,
      damageState: 'normal' as const,
      recoveryTimer: 0,
      timeSinceLastHit: 0,
    };
    updateAdrenaline(state, 1, { timer: 0.5 }, cfg, {
      rocketMode: false,
      laneChanged: false,
      runSeconds: 0,
    });
    expect(state.adrenaline).toBe(100);
  });

  it('gains adrenaline from rewards', () => {
    const state = {
      adrenaline: 40,
      laneIdleSeconds: 0,
      isHit: false,
      damageState: 'critical' as const,
      recoveryTimer: 0,
      timeSinceLastHit: 0,
    };
    gainAdrenaline(state, cfg.gainSmash, cfg);
    expect(state.adrenaline).toBe(55);
    expect(state.damageState).toBe('damaged');
  });
});

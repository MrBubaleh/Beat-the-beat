import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import type { GameConfig } from '@core/config/schemas';
import {
  createSkillMomentumState,
  onSkillMomentumHit,
  skillMomentumAchievableCap,
  skillMomentumHardCap,
  skillMomentumThresholdSpeed,
  updateSkillMomentum,
} from '@core/gameplay/skillMomentum';

const game = gameRaw as GameConfig;

function basePlayer() {
  return {
    mode: 'car' as const,
    speed: 24,
    timeSinceLastHit: 25,
    isAbilityActive: false,
    nitroCharge: 0,
    horseMomentum: 0,
    horseOverdriveRemaining: 0,
    rocketPhase: 'none' as const,
    rocketFx: 0,
    damageState: 'normal' as const,
  };
}

describe('skillMomentum', () => {
  it('raises hard cap by up to maxBonus', () => {
    expect(skillMomentumHardCap('car', game, 0)).toBeCloseTo(28);
    expect(skillMomentumHardCap('car', game, 1)).toBeCloseTo(36.4);
    expect(skillMomentumHardCap('rocket', game, 1)).toBeCloseTo(67.6);
  });

  it('uses higher achievable cap with nitro than without at same raw speed', () => {
    const player = basePlayer();
    const raw = 18;
    const withoutNitro = skillMomentumAchievableCap(
      player,
      game,
      raw,
      1,
      false,
    );
    const withNitro = skillMomentumAchievableCap(
      { ...player, isAbilityActive: true, nitroCharge: game.nitro.maxFill },
      game,
      raw,
      1,
      true,
    );
    expect(withNitro).toBeGreaterThan(withoutNitro);
    expect(skillMomentumThresholdSpeed(withNitro, game)).toBeGreaterThan(
      skillMomentumThresholdSpeed(withoutNitro, game),
    );
  });

  it('ramps up only for veteran with clean fast run', () => {
    const state = createSkillMomentumState();
    const player = basePlayer();
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 40; i++) {
      updateSkillMomentum(state, player, game, dt, {
        veteranUnlocked: true,
        rawSpeedBeforeCap: 26,
        speedMultiplier: 1,
        nitroBoostActive: false,
      });
    }
    expect(state.momentum).toBeGreaterThan(0.9);
  });

  it('stays at zero for novice gate', () => {
    const state = createSkillMomentumState();
    const player = basePlayer();
    const momentum = updateSkillMomentum(state, player, game, 1, {
      veteranUnlocked: false,
      rawSpeedBeforeCap: 26,
      speedMultiplier: 1,
      nitroBoostActive: false,
    });
    expect(momentum).toBe(0);
  });

  it('decays after hit over rampDownSeconds', () => {
    const state = createSkillMomentumState();
    state.momentum = 1;
    onSkillMomentumHit(state);
    const player = { ...basePlayer(), timeSinceLastHit: 0, speed: 10 };
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 16; i++) {
      updateSkillMomentum(state, player, game, dt, {
        veteranUnlocked: true,
        rawSpeedBeforeCap: 10,
        speedMultiplier: 1,
        nitroBoostActive: false,
      });
    }
    expect(state.momentum).toBeLessThan(0.05);
  });
});

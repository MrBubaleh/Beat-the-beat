import { describe, expect, it } from 'vitest';
import { configFallbacks } from '../../src/core/config/fallbacks';
import { PlayerSim } from '../../src/core/gameplay/PlayerSim';

const game = configFallbacks.game;

const idleInput = { laneDelta: 0 as const, jump: false, nitro: false };

describe('beatLaunch', () => {
  it('adds permanent additive speed from strong beats', () => {
    const baseline = new PlayerSim(game);
    baseline.update(1, idleInput, 1);

    const boosted = new PlayerSim(game);
    boosted.applyBeatLaunchBoost(game.beatLaunch.speedPerBeat, game.beatLaunch.maxBonus);
    boosted.update(1, idleInput, 1);

    expect(boosted.state.speed).toBeGreaterThan(baseline.state.speed);
    expect(boosted.state.speed - baseline.state.speed).toBeCloseTo(game.beatLaunch.speedPerBeat, 1);
  });

  it('caps accumulated beat launch bonus', () => {
    const sim = new PlayerSim(game);
    for (let i = 0; i < 20; i += 1) {
      sim.applyBeatLaunchBoost(game.beatLaunch.speedPerBeat, game.beatLaunch.maxBonus);
    }
    sim.update(1, idleInput, 1);
    const capped = new PlayerSim(game);
    capped.applyBeatLaunchBoost(game.beatLaunch.maxBonus, game.beatLaunch.maxBonus);
    capped.update(1, idleInput, 1);
    expect(sim.state.speed).toBeCloseTo(capped.state.speed, 1);
  });
});

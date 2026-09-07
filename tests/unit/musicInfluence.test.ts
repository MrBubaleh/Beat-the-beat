import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { DirectorConfig, GameConfig, LevelgenConfig } from '@core/config/schemas';
import { ActiveDirector } from '@core/director/ActiveDirector';
import { GameSim } from '@core/gameplay/GameSim';
import { makeMusic, withoutRocketSpawn } from './musicHelpers';
import { makeDodgeBot } from './dodgeBot';

describe('end-to-end music influence', () => {
  function run(energy: number): ReturnType<GameSim['getSnapshot']> {
    const game: GameConfig = {
      ...withoutRocketSpawn(gameRaw as GameConfig),
      ramp: { ...(gameRaw as GameConfig).ramp, startDelaySeconds: 100 },
    };
    const levelgen: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      rampProbability: 0,
      earlyRampProbability: 0,
      redWallProbability: 0,
      laneFlow: [0, 0, 0, 0],
    };
    const dodge = makeDodgeBot(levelgen.lanes);
    let sim!: GameSim;
    sim = new GameSim({
      game,
      levelgen,
      director: new ActiveDirector(directorRaw as DirectorConfig),
      consumeInput: () => dodge(sim.getSnapshot()),
      nowMs: () => 0,
      getMusic: () => makeMusic({ energy, brightness: energy, beat: energy > 0.7 }),
      seed: 42,
    });
    for (let i = 0; i < 8 * 60 && !sim.gameOver; i++) sim.fixedUpdate(1 / 60);
    return sim.getSnapshot();
  }

  it('produces materially different play and presentation from the same seed', () => {
    const calm = run(0.1);
    const active = run(0.9);
    expect(calm.phase).toBe('calm');
    expect(active.phase).not.toBe('calm');
    expect(active.player.speed).toBeGreaterThan(calm.player.speed);
    expect(active.vfxIntensity).toBeGreaterThan(calm.vfxIntensity);
    expect(active.effectiveDensity).toBeGreaterThan(calm.effectiveDensity);
    expect(active.musicPattern).not.toBeNull();
  });
});

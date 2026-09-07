import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import { GameSim } from '@core/gameplay/GameSim';
import { PassthroughDirector } from '@core/director/PassthroughDirector';
import { TutorialController } from '@core/tutorial/TutorialController';
import { emptyMusic, withoutRocketSpawn } from './musicHelpers';

describe('nitro readiness consumed by tutorial and render', () => {
  it.each(['classic', 'destroy', 'adrenaline'] as const)(
    'publishes full charge from the same tick and acquires the medium target in %s',
    (gameplayRules) => {
      const game = withoutRocketSpawn(gameRaw as GameConfig);
      game.nitro = { ...game.nitro, gainPerChargeLaneSecond: 10 };
      const levelgen = levelgenRaw as LevelgenConfig;
      const sim = new GameSim({
        game, levelgen, gameplayRules, seed: 42,
        director: new PassthroughDirector(directorRaw as DirectorConfig),
        consumeInput: () => [], nowMs: () => 0, getMusic: emptyMusic,
      });
      sim.fixedUpdate(0);
      const player = sim.playerSim.state;
      player.lane = levelgen.nitroChargeLanes[0];
      player.laneX = game.lane.positions[player.lane];
      player.nitroCharge = game.nitro.maxFill - 0.01;
      const initial = sim.getSnapshot();
      initial.obstacles.length = 0;
      initial.obstacles.push({ id: -900001, kind: 'low', lane: player.lane, z: 30 });
      expect(initial.nitroReady).toBe(false);
      sim.fixedUpdate(1 / 60);
      const full = sim.getSnapshot();
      expect(full.player.nitroCharge).toBe(game.nitro.maxFill);
      expect(full.nitroReady).toBe(true);
      const tutorial = new TutorialController(game);
      expect(tutorial.update(full, 1 / 60)).toMatchObject({
        active: true, stage: 'nitro', targetObstacleId: -900001,
      });
      sim.playerSim.activateNitro();
      expect(sim.getSnapshot().nitroReady).toBe(false);
      expect(tutorial.update(sim.getSnapshot(), 0.25).active).toBe(false);
    },
  );

  it.each(['classic', 'destroy', 'adrenaline'] as const)(
    'counts automatic collision nitro once and completes tutorial immediately in %s',
    (gameplayRules) => {
      const game = withoutRocketSpawn(gameRaw as GameConfig);
      const sim = new GameSim({
        game, levelgen: levelgenRaw as LevelgenConfig, gameplayRules, seed: 42,
        director: new PassthroughDirector(directorRaw as DirectorConfig),
        consumeInput: () => [], nowMs: () => 0, getMusic: emptyMusic,
      });
      sim.fixedUpdate(0);
      const player = sim.playerSim.state;
      const snapshot = sim.getSnapshot();
      snapshot.obstacles.length = 0;
      snapshot.ramps.length = 0;
      const target = { id: -900002, kind: 'low' as const, lane: player.lane, z: 30 };
      snapshot.obstacles.push(target);
      player.nitroCharge = game.nitro.maxFill;
      const tutorial = new TutorialController(game);
      expect(tutorial.update(sim.getSnapshot(), 0).stage).toBe('nitro');
      target.z = 0.6;
      sim.fixedUpdate(1 / 60);
      const activated = sim.getSnapshot();
      expect(activated.runStats.nitroActivations).toBe(1);
      expect(activated.player.isAbilityActive).toBe(true);
      expect(tutorial.update(activated, 0.25).active).toBe(false);
      sim.fixedUpdate(1 / 60);
      expect(sim.getSnapshot().runStats.nitroActivations).toBe(1);
      sim.playerSim.interruptNitro();
      player.nitroCharge = game.nitro.maxFill;
      snapshot.obstacles.push({ ...target, id: -900003, z: 30, broken: false });
      expect(tutorial.update(sim.getSnapshot(), 0.25).active).toBe(false);
    },
  );

  it('does not advertise ready nitro in horse/rocket or after restart', () => {
    const game = withoutRocketSpawn(gameRaw as GameConfig);
    const sim = new GameSim({
      game, levelgen: levelgenRaw as LevelgenConfig, seed: 42,
      director: new PassthroughDirector(directorRaw as DirectorConfig),
      consumeInput: () => [], nowMs: () => 0, getMusic: emptyMusic,
    });
    sim.playerSim.state.nitroCharge = game.nitro.maxFill;
    expect(sim.getSnapshot().nitroReady).toBe(true);
    sim.setMode('horse');
    expect(sim.getSnapshot().nitroReady).toBe(false);
    sim.setMode('rocket');
    expect(sim.getSnapshot().nitroReady).toBe(false);
    sim.restart();
    expect(sim.getSnapshot().nitroReady).toBe(false);
  });
});

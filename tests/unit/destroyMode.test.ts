import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { DirectorConfig, GameConfig, LevelgenConfig } from '@core/config/schemas';
import {
  DEFAULT_GAMEPLAY_RULES_ID,
  GAMEPLAY_RULES_IDS,
  isGameplayRulesId,
} from '@core/gameplay/gameplayRules';
import { GameSim } from '@core/gameplay/GameSim';
import { PassthroughDirector } from '@core/director/PassthroughDirector';
import { isPassableAsCar } from '@core/levelgen/passability';
import type { ObstacleEntity } from '@core/levelgen/types';
import { emptyMusic } from './musicHelpers';

const game = gameRaw as GameConfig;
const levelgen = levelgenRaw as LevelgenConfig;
const director = new PassthroughDirector(directorRaw as DirectorConfig);

describe('Destroy mode', () => {
  it('registers destroy as default gameplay rules id', () => {
    expect(GAMEPLAY_RULES_IDS).toContain('destroy');
    expect(DEFAULT_GAMEPLAY_RULES_ID).toBe('destroy');
    expect(isGameplayRulesId('destroy')).toBe(true);
  });

  it('ignores micro obstacles in car passability', () => {
    const obstacles: ObstacleEntity[] = [
      { id: 1, kind: 'micro', lane: 0, z: 0 },
      { id: 2, kind: 'micro', lane: 1, z: 0 },
      { id: 3, kind: 'micro', lane: 2, z: 0 },
      { id: 4, kind: 'tall', lane: 3, z: 12 },
    ];
    expect(isPassableAsCar(obstacles, levelgen).passable).toBe(true);
  });

  it('medium hit advances damage state in destroy', () => {
    const sim = new GameSim({
      game,
      levelgen,
      gameplayRules: 'destroy',
      director,
      consumeInput: () => [],
      nowMs: () => 0,
      getSongProgress: () => 0,
      getMusic: () => emptyMusic(),
      seed: 4242,
    });
    const snapshot = sim.getSnapshot();
    snapshot.player.mode = 'car';
    snapshot.player.nitroCharge = 0;
    snapshot.obstacles.push({
      id: 9901,
      kind: 'low',
      lane: snapshot.player.lane,
      z: 0.2,
    });
    sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().player.damageState).toBe('damaged');
    expect(sim.combo).toBe(0);
  });

  it('spawns micro obstacles in destroy car chunks', () => {
    const sim = new GameSim({
      game,
      levelgen,
      gameplayRules: 'destroy',
      director,
      consumeInput: () => [],
      nowMs: () => 0,
      getSongProgress: () => 0,
      getMusic: () => emptyMusic(),
      seed: 4242,
    });
    for (let i = 0; i < 600; i++) sim.fixedUpdate(1 / 60);
    const hasMicro = sim.getSnapshot().obstacles.some((o) => o.kind === 'micro');
    const groundCoins = sim.getSnapshot().coins.filter(
      (coin) =>
        coin.airPathId === undefined &&
        coin.airTargetTime === undefined &&
        coin.trainId === undefined,
    );
    expect(hasMicro).toBe(true);
    expect(groundCoins.length).toBe(0);
  });

  it('horse breaks micro obstacles and gains nitro in destroy', () => {
    const sim = new GameSim({
      game,
      levelgen,
      gameplayRules: 'destroy',
      director,
      consumeInput: () => [],
      nowMs: () => 0,
      getSongProgress: () => 0,
      getMusic: () => emptyMusic(),
    });
    const snapshot = sim.getSnapshot();
    snapshot.obstacles.push({
      id: 8801,
      kind: 'micro',
      lane: snapshot.player.lane,
      z: 0.2,
    });
    sim.playerSim.switchMode('horse');
    const nitroBefore = sim.getSnapshot().player.nitroCharge;
    for (let i = 0; i < 5; i++) sim.fixedUpdate(1 / 60);
    const after = sim.getSnapshot();
    const micro = after.obstacles.find((o) => o.id === 8801);
    expect(micro?.broken).toBe(true);
    expect(after.player.nitroCharge).toBeGreaterThan(nitroBefore);
  });
});

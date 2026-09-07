import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import { PassthroughDirector } from '@core/director/PassthroughDirector';
import { CollisionSystem } from '@core/gameplay/Collision';
import { GameSim } from '@core/gameplay/GameSim';
import { PlayerSim, createInitialPlayer } from '@core/gameplay/PlayerSim';
import type { PlayerAction } from '@core/gameplay/actions';
import type { CoinEntity, ObstacleEntity } from '@core/levelgen/types';
import { emptyMusic, makeMusic, withoutRocketSpawn } from './musicHelpers';

const game = withoutRocketSpawn(gameRaw as GameConfig);
const START_LANE = Math.floor(game.lane.positions.length / 2);

function low(lane: number, z: number, broken = false): ObstacleEntity {
  return { id: 1, kind: 'low', lane, z, broken: broken || undefined };
}

describe('CollisionSystem — forgiveness', () => {
  it('applies zGrace: a near miss by depth is forgiven, exact hitbox kills', () => {
    const forgiving = new CollisionSystem({ ...game, hit: { ...game.hit, zGrace: 0.3 } });
    const strict = new CollisionSystem({ ...game, hit: { ...game.hit, zGrace: 0 } });
    const player = createInitialPlayer(game.lane.positions);
    const obstacle = low(START_LANE, 1.4);
    const coins: CoinEntity[] = [];

    expect(forgiving.update(player, [obstacle], coins, []).hit).toBe(false);
    expect(strict.update(player, [obstacle], coins, []).hit).toBe(true);
  });

  it('applies heightGrace: feet slightly below the top still clear', () => {
    const forgiving = new CollisionSystem({ ...game, hit: { ...game.hit, heightGrace: 0.25 } });
    const strict = new CollisionSystem({ ...game, hit: { ...game.hit, heightGrace: 0 } });
    const player = createInitialPlayer(game.lane.positions);
    player.y = 0.9;
    const obstacle = low(START_LANE, 0);
    const coins: CoinEntity[] = [];

    expect(forgiving.update(player, [obstacle], coins, []).hit).toBe(false);
    expect(strict.update(player, [obstacle], coins, []).hit).toBe(true);
  });

  it('ignores broken obstacles', () => {
    const collision = new CollisionSystem(game);
    const player = createInitialPlayer(game.lane.positions);
    const coins: CoinEntity[] = [];
    expect(collision.update(player, [low(START_LANE, 0, true)], coins, []).hit).toBe(false);
  });

  it('returns the id of the hit obstacle', () => {
    const collision = new CollisionSystem(game);
    const player = createInitialPlayer(game.lane.positions);
    const coins: CoinEntity[] = [];
    const result = collision.update(player, [low(START_LANE, 0)], coins, []);
    expect(result.hit).toBe(true);
    expect(result.hitObstacleId).toBe(1);
  });
});

describe('PlayerSim — damage model', () => {
  it('steps damaged → critical → game over on consecutive hits', () => {
    const sim = new PlayerSim(game);
    sim.registerHit();
    expect(sim.state.damageState).toBe('damaged');
    expect(sim.state.isHit).toBe(true);
    expect(sim.state.recoveryTimer).toBe(game.hit.recoverySeconds);
    expect(sim.state.gameOver).toBe(false);

    sim.registerHit();
    expect(sim.state.damageState).toBe('critical');
    expect(sim.state.gameOver).toBe(false);

    sim.registerHit();
    expect(sim.state.gameOver).toBe(true);
  });

  it('recovers to normal when the recovery timer elapses without another hit', () => {
    const sim = new PlayerSim(game);
    sim.registerHit();
    const steps = Math.ceil(game.hit.recoverySeconds / (1 / 60)) + 5;
    for (let i = 0; i < steps; i++) {
      sim.update(1 / 60, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    expect(sim.state.damageState).toBe('normal');
    expect(sim.state.recoveryTimer).toBe(0);
    expect(sim.state.gameOver).toBe(false);
  });

  it('i-frames expire while damage persists', () => {
    const sim = new PlayerSim(game);
    sim.registerHit();
    const steps = Math.ceil(game.hit.iframeSeconds / (1 / 60)) + 5;
    for (let i = 0; i < steps; i++) {
      sim.update(1 / 60, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    expect(sim.state.isHit).toBe(false);
    expect(sim.state.damageState).toBe('damaged');
  });

  it('applies a speed penalty on hit and lifts it after recovery', () => {
    const hit = new PlayerSim(game);
    const clean = new PlayerSim(game);
    for (let i = 0; i < 30; i++) {
      hit.update(1 / 60, { laneDelta: 0, jump: false, nitro: false }, 1);
      clean.update(1 / 60, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    hit.registerHit();
    for (let i = 0; i < 30; i++) {
      hit.update(1 / 60, { laneDelta: 0, jump: false, nitro: false }, 1);
      clean.update(1 / 60, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    expect(hit.state.speed).toBeLessThan(clean.state.speed);

    const steps = Math.ceil(game.hit.recoverySeconds / (1 / 60)) + 5;
    for (let i = 0; i < steps; i++) {
      hit.update(1 / 60, { laneDelta: 0, jump: false, nitro: false }, 1);
      clean.update(1 / 60, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    expect(hit.state.damageState).toBe('normal');
    expect(hit.state.speed).toBeCloseTo(clean.state.speed, 5);
  });
});

describe('GameSim — i-frames break obstacles', () => {
  it('breaks obstacles hit during i-frames without escalating damage', () => {
    const longInvulnerability: GameConfig = {
      ...game,
      hit: { ...game.hit, iframeSeconds: 1000, recoverySeconds: 1000 },
      nitro: { ...game.nitro, gainPerChargeLaneSecond: 0 },
    };
    const director = new PassthroughDirector(directorRaw as DirectorConfig);
    let input: PlayerAction[] = [];
    const noFlow: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      laneFlow: [0, 0, 0, 0],
      redWallProbability: 0,
      rampProbability: 0,
    };
    const sim = new GameSim({
      game: longInvulnerability,
      levelgen: noFlow,
      director,
      consumeInput: () => input,
      nowMs: () => 0,
      getMusic: () => emptyMusic(),
    });

    const initial = sim.getSnapshot();
    initial.obstacles.push(
      { id: 9001, kind: 'low', lane: initial.player.lane, z: 4, broken: false },
      { id: 9002, kind: 'low', lane: initial.player.lane, z: 8, broken: false },
    );

    const steer = (): PlayerAction[] => {
      const snapshot = sim.getSnapshot();
      const nearest = snapshot.obstacles
        .filter((o) => o.z > 0 && !o.broken)
        .sort((a, b) => a.z - b.z)[0];
      if (!nearest) return [];
      if (nearest.lane > snapshot.player.lane) return ['laneLeft'];
      if (nearest.lane < snapshot.player.lane) return ['laneRight'];
      return [];
    };

    let firstHit = false;
    let maxBroken = 0;
    for (let i = 0; i < 3600; i++) {
      input = steer();
      sim.fixedUpdate(1 / 60);
      const snapshot = sim.getSnapshot();
      const player = snapshot.player;
      if (!firstHit && player.damageState === 'damaged') firstHit = true;
      maxBroken = Math.max(maxBroken, snapshot.obstacles.filter((o) => o.broken).length);
    }

    expect(firstHit).toBe(true);
    expect(maxBroken).toBeGreaterThan(1);
    expect(sim.getSnapshot().player.damageState).toBe('damaged');
    expect(sim.gameOver).toBe(false);
  });
});

describe('GameSim — beat pulse', () => {
  function makeSim(beat: () => boolean): GameSim {
    const director = new PassthroughDirector(directorRaw as DirectorConfig);
    return new GameSim({
      game,
      levelgen: levelgenRaw as LevelgenConfig,
      director,
      consumeInput: () => [],
      nowMs: () => 0,
      getMusic: () => makeMusic({ beat: beat() }),
    });
  }

  it('spikes pulse on beat and decays otherwise', () => {
    let beat = false;
    const sim = makeSim(() => beat);

    beat = true;
    sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().pulse).toBe(1);

    beat = false;
    for (let i = 0; i < 300; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().pulse).toBe(0);
  });

  it('keeps pulse at 0 without beats', () => {
    const sim = makeSim(() => false);
    for (let i = 0; i < 60; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().pulse).toBe(0);
  });
});

describe('GameSim — strong pulse', () => {
  function makeSim(music: () => ReturnType<typeof makeMusic>): GameSim {
    const director = new PassthroughDirector(directorRaw as DirectorConfig);
    return new GameSim({
      game,
      levelgen: levelgenRaw as LevelgenConfig,
      director,
      consumeInput: () => [],
      nowMs: () => 0,
      getMusic: music,
    });
  }

  it('fires strongPulse only when a beat lands on high energy', () => {
    let beat = false;
    const sim = makeSim(() => makeMusic({ beat, energy: 0.9 }));
    sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().strongPulse).toBe(0);

    beat = true;
    sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().strongPulse).toBe(1);
  });

  it('keeps strongPulse at 0 on low-energy beats and decays it', () => {
    const sim = makeSim(() => makeMusic({ beat: true, energy: 0.3 }));
    sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().strongPulse).toBe(0);
    expect(sim.getSnapshot().pulse).toBe(1);

    for (let i = 0; i < 300; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().strongPulse).toBe(0);
  });
});

describe('GameSim — turbo episode', () => {
  function makeSim(music: () => ReturnType<typeof makeMusic>): GameSim {
    const director = new PassthroughDirector(directorRaw as DirectorConfig);
    return new GameSim({
      game,
      levelgen: levelgenRaw as LevelgenConfig,
      director,
      consumeInput: () => [],
      nowMs: () => 0,
      getMusic: music,
    });
  }

  it('stays off below the energy threshold', () => {
    const sim = makeSim(() => makeMusic({ energy: 0.3 }));
    for (let i = 0; i < 300; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().turbo).toBe(0);
  });

  it('activates after sustained high energy and boosts speed', () => {
    const sim = makeSim(() => makeMusic({ energy: 0.9, beat: true }));
    expect(sim.getSnapshot().turbo).toBe(0);

    const sustainSteps = Math.ceil(game.turbo.sustainSeconds / (1 / 60)) + 2;
    for (let i = 0; i < sustainSteps; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().turbo).toBeGreaterThan(0);
    expect(sim.getSnapshot().speedMultiplier).toBeGreaterThan(1);
    const turboRows = sim.getSnapshot().obstacles.filter(
      (obstacle) => obstacle.z > 0 && obstacle.kind === 'low',
    );
    expect(turboRows.length).toBeGreaterThanOrEqual(game.turbo.sceneRows * 2);
  });

  it('stages a horse turbo as spaced jump rows with airborne coins', () => {
    const sim = makeSim(() => makeMusic({ energy: 0.9, beat: true }));
    sim.setMode('horse');
    const sustainSteps = Math.ceil(game.turbo.sustainSeconds / (1 / 60)) + 2;
    for (let i = 0; i < sustainSteps; i++) sim.fixedUpdate(1 / 60);

    const snapshot = sim.getSnapshot();
    const jumpRows = snapshot.obstacles.filter(
      (obstacle) => obstacle.z > 0 && obstacle.horseAction === 'jump',
    );
    expect(jumpRows.length).toBeGreaterThanOrEqual(
      game.turbo.sceneRows * (levelgenRaw as LevelgenConfig).lanes,
    );
    expect(snapshot.coins.some((coin) => coin.y === (levelgenRaw as LevelgenConfig).horse.jumpCoinHeight)).toBe(true);
  });

  it('deactivates after the turbo duration and enters cooldown', () => {
    const sim = makeSim(() => makeMusic({ energy: 0.9, beat: true }));
    const sustainSteps = Math.ceil(game.turbo.sustainSeconds / (1 / 60)) + 2;
    for (let i = 0; i < sustainSteps; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().turbo).toBeGreaterThan(0);

    const durationSteps = Math.ceil(game.turbo.durationSeconds / (1 / 60)) + 2;
    for (let i = 0; i < durationSteps; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().turbo).toBe(0);

    for (let i = 0; i < 120; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().turbo).toBe(0);
  });

  it('does not re-trigger during cooldown', () => {
    const sim = makeSim(() => makeMusic({ energy: 0.9, beat: true }));
    const sustainSteps = Math.ceil(game.turbo.sustainSeconds / (1 / 60)) + 2;
    for (let i = 0; i < sustainSteps; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().turbo).toBeGreaterThan(0);

    const durationSteps = Math.ceil(game.turbo.durationSeconds / (1 / 60)) + 2;
    for (let i = 0; i < durationSteps; i++) sim.fixedUpdate(1 / 60);

    const cooldownSteps = Math.ceil(game.turbo.cooldownSeconds / (1 / 60)) + 2;
    for (let i = 0; i < Math.floor(cooldownSteps / 2); i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().turbo).toBe(0);
  });
});

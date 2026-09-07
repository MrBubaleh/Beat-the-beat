import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import type { PlayerAction } from '@core/gameplay/actions';
import { CollisionSystem } from '@core/gameplay/Collision';
import { createInitialPlayer, PlayerSim } from '@core/gameplay/PlayerSim';
import { GameSim } from '@core/gameplay/GameSim';
import type { CoinEntity } from '@core/levelgen/types';
import { comboMultiplier } from '@core/gameplay/Combo';
import { DirectorMemory } from '@core/director/DirectorMemory';
import type { Director, DirectorOutput } from '@core/director/types';
import { PassthroughDirector } from '@core/director/PassthroughDirector';
import { emptyMusic, makeMusic, withoutRocketSpawn } from './musicHelpers';

class PhaseDirector implements Director {
  readonly memory = new DirectorMemory();
  constructor(public phase: string) {}

  get phaseElapsed(): number {
    return 0;
  }

  update(): DirectorOutput {
    return { intents: [], phase: this.phase, phaseElapsed: 0 };
  }

  reset(): void {
    this.memory.clear();
  }
}

const gameNoRocket = withoutRocketSpawn(gameRaw as GameConfig);

describe('PlayerSim', () => {
  const cfg = gameRaw as GameConfig;
  it('switches lanes toward the target with a lerp', () => {
    const sim = new PlayerSim(cfg);
    const start = Math.floor(cfg.lane.positions.length / 2);
    sim.update(0.01, { laneDelta: 1, jump: false, nitro: false }, 1);
    expect(sim.state.lane).toBe(start + 1);
    expect(sim.state.laneX).toBeGreaterThan(cfg.lane.positions[start]);
    for (let i = 0; i < 60; i++) sim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    expect(sim.state.laneX).toBeCloseTo(cfg.lane.positions[start + 1], 2);
  });

  it('launchFromRamp throws the player into the air and lands back on the ground', () => {
    const sim = new PlayerSim(cfg);
    sim.launchFromRamp();
    expect(sim.state.airState).toBe('airborne');
    const apexSteps = Math.round(cfg.ramp.flightTimeSeconds / 0.01 / 2);
    for (let i = 0; i < apexSteps; i++) sim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    expect(sim.state.y).toBeGreaterThan(cfg.ramp.height * 0.95);
    const totalSteps = Math.ceil((cfg.ramp.flightTimeSeconds + cfg.ramp.landingTimeSeconds) / 0.01) + 5;
    for (let i = 0; i < totalSteps; i++) sim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    expect(sim.state.y).toBeCloseTo(0, 5);
    expect(sim.state.airState).toBe('grounded');
  });

  it('speed ramps over time and eases toward the intent multiplier', () => {
    const sim = new PlayerSim(cfg);
    for (let i = 0; i < 240; i++) sim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 2);
    expect(sim.state.speed).toBeGreaterThan(cfg.speeds.base * 1.9);
    expect(sim.state.speed).toBeLessThan(cfg.speeds.max * 2 + 1);
    const eased = new PlayerSim(cfg);
    eased.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 2);
    expect(eased.state.speed).toBeLessThan(cfg.speeds.base * 2);
  });

  function rawSpeedAt(sim: PlayerSim): number {
    return cfg.speeds.base + cfg.speeds.rampPerSecond * sim.state.gameTime;
  }

  it('keeps the speed multiplier above the configured floor', () => {
    const sim = new PlayerSim(cfg);
    for (let i = 0; i < 600; i++) sim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 0.1);
    expect(sim.state.speed).toBeGreaterThanOrEqual(rawSpeedAt(sim) * cfg.speeds.speedFloor - 1e-6);
    expect(sim.state.speed).toBeLessThan(rawSpeedAt(sim) * (cfg.speeds.speedFloor + 0.02));
  });

  it('accelerates faster than it decelerates', () => {
    const accel = new PlayerSim(cfg);
    let accelTicks = 0;
    for (let i = 0; i < 200; i++) {
      accel.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1.05);
      accelTicks++;
      if (accel.state.speed >= rawSpeedAt(accel) * 1.05 - 1e-6) break;
    }
    const decel = new PlayerSim(cfg);
    let decelTicks = 0;
    for (let i = 0; i < 200; i++) {
      decel.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 0.95);
      decelTicks++;
      if (decel.state.speed <= rawSpeedAt(decel) * 0.95 + 1e-6) break;
    }
    expect(accelTicks).toBeGreaterThan(0);
    expect(accelTicks).toBeLessThan(decelTicks);
  });
});

describe('CollisionSystem', () => {
  it('does not hit a tall obstacle whose rear has already passed the player', () => {
    const collision = new CollisionSystem(gameRaw as GameConfig);
    const player = createInitialPlayer(gameRaw.lane.positions);
    const start = Math.floor(gameRaw.lane.positions.length / 2);
    const passed = [{
      id: 1,
      kind: 'tall' as const,
      lane: start,
      z: -3.6,
    }];
    expect(collision.update(player, passed, [], []).hit).toBe(false);
    const tailing = [{
      id: 2,
      kind: 'tall' as const,
      lane: start,
      z: -2.2,
    }];
    expect(collision.update(player, tailing, [], []).hit).toBe(true);
  });

  it('detects a hit on a low obstacle and disables hits while airborne', () => {
    const collision = new CollisionSystem(gameRaw as GameConfig);
    const player = createInitialPlayer(gameRaw.lane.positions);
    const start = Math.floor(gameRaw.lane.positions.length / 2);
    const obstacles = [{ id: 1, kind: 'low' as const, lane: start, z: 0 }];
    expect(collision.update(player, obstacles, [], []).hit).toBe(true);
    player.airState = 'airborne';
    expect(collision.update(player, obstacles, [], []).hit).toBe(false);
  });

  it('a tall obstacle hits when grounded and is cleared by a ramp', () => {
    const collision = new CollisionSystem(gameRaw as GameConfig);
    const player = createInitialPlayer(gameRaw.lane.positions);
    const start = Math.floor(gameRaw.lane.positions.length / 2);
    const tall = [{ id: 1, kind: 'tall' as const, lane: start, z: 0 }];
    expect(collision.update(player, tall, [], []).hit).toBe(true);
    player.airState = 'airborne';
    expect(collision.update(player, tall, [], []).hit).toBe(false);
  });

  it('requires a slide to pass through an overhead horse obstacle', () => {
    const game = gameRaw as GameConfig;
    const collision = new CollisionSystem(game);
    const player = createInitialPlayer(game.lane.positions);
    player.mode = 'horse';
    const overhead = [{ id: 9, kind: 'overhead' as const, lane: player.lane, z: 0 }];

    expect(collision.update(player, overhead, [], []).hit).toBe(false);
    player.isSliding = true;
    expect(collision.update(player, overhead, [], []).hit).toBe(false);
    player.isSliding = false;
    player.airState = 'airborne';
    player.airSource = 'horseJump';
    player.y = 0.7;
    expect(collision.update(player, overhead, [], []).hit).toBe(true);
  });

  it('requires dodging a horse dodge-only obstacle regardless of jump or slide height', () => {
    const game = gameRaw as GameConfig;
    const collision = new CollisionSystem(game);
    const player = createInitialPlayer(game.lane.positions);
    player.mode = 'horse';
    player.airState = 'airborne';
    player.airSource = 'horseJump';
    player.y = game.horse.height;
    const obstacle = [{
      id: 10,
      kind: 'tall' as const,
      lane: player.lane,
      z: 0,
      horseDodgeOnly: true,
    }];
    expect(collision.update(player, obstacle, [], []).hit).toBe(true);
    player.isSliding = true;
    expect(collision.update(player, obstacle, [], []).hit).toBe(true);
  });

  it('collects coins on overlap', () => {
    const collision = new CollisionSystem(gameRaw as GameConfig);
    const player = createInitialPlayer(gameRaw.lane.positions);
    const start = Math.floor(gameRaw.lane.positions.length / 2);
    const coins = [{ id: 1, lane: start, z: 0, collected: false }];
    expect(collision.update(player, [], coins, []).coinCollected).toBe(true);
    expect(coins[0].collected).toBe(true);
  });

  it('does not collect an airborne coin above or below the player hitbox', () => {
    const collision = new CollisionSystem(gameRaw as GameConfig);
    const player = createInitialPlayer(gameRaw.lane.positions);
    const start = Math.floor(gameRaw.lane.positions.length / 2);
    player.y = 4;
    const above = [{ id: 1, lane: start, z: 0, y: 5.6, collected: false }];
    const below = [{ id: 2, lane: start, z: 0, y: 3.2, collected: false }];
    expect(collision.update(player, [], above, []).coinCollected).toBe(false);
    expect(collision.update(player, [], below, []).coinCollected).toBe(false);
  });

  it('collects a coin grazing the visible edge but not one beyond the grace margin', () => {
    const cfg = gameRaw as GameConfig;
    const collision = new CollisionSystem(cfg);
    const player = createInitialPlayer(cfg.lane.positions);
    const start = Math.floor(cfg.lane.positions.length / 2);
    const coinX = cfg.lane.positions[start];
    const edge = cfg.player.width / 2 + cfg.coin.collectGrace + cfg.coin.radius;
    player.laneX = coinX + edge - 0.01;
    const touching = [{ id: 1, lane: start, z: 0, y: 0.6, collected: false }];
    expect(collision.update(player, [], touching, []).coinCollected).toBe(true);

    player.laneX = coinX + edge + 0.01;
    const outside = [{ id: 2, lane: start, z: 0, y: 0.6, collected: false }];
    expect(collision.update(player, [], outside, []).coinCollected).toBe(false);
  });

  it('picks up a bonus in the player lane and reports its kind', () => {
    const collision = new CollisionSystem(gameRaw as GameConfig);
    const player = createInitialPlayer(gameRaw.lane.positions);
    const start = Math.floor(gameRaw.lane.positions.length / 2);
    const other = (start + 1) % gameRaw.lane.positions.length;
    const bonuses = [
      { id: 1, kind: 'horse' as const, lane: start, z: 0, collected: false },
      { id: 2, kind: 'horse' as const, lane: other, z: 0, collected: false },
    ];
    const result = collision.update(player, [], [], bonuses);
    expect(result.bonusCollected).toBe('horse');
    expect(bonuses[0].collected).toBe(true);
    expect(bonuses[1].collected).toBe(false);
  });

  it('hits obstacles while the car is in ramp landing, but not while airborne', () => {
    const collision = new CollisionSystem(gameRaw as GameConfig);
    const player = createInitialPlayer(gameRaw.lane.positions);
    const start = Math.floor(gameRaw.lane.positions.length / 2);
    const tall = [{ id: 1, kind: 'tall' as const, lane: start, z: 0 }];
    player.airState = 'airborne';
    player.airSource = 'ramp';
    expect(collision.update(player, tall, [], []).hit).toBe(false);
    player.airState = 'landing';
    player.y = (gameRaw as GameConfig).ramp.height * 0.12;
    expect(collision.update(player, tall, [], []).hit).toBe(true);
    const low = [{ id: 2, kind: 'low' as const, lane: start, z: 0 }];
    expect(collision.update(player, low, [], []).hit).toBe(true);
  });

  it('crushes overlapping coins without collecting them', () => {
    const collision = new CollisionSystem(gameRaw as GameConfig);
    const player = createInitialPlayer(gameRaw.lane.positions);
    const start = Math.floor(gameRaw.lane.positions.length / 2);
    const coins: CoinEntity[] = [{
      id: 11,
      lane: start,
      z: 8,
      y: 0.55,
      collected: false,
      crushArmed: true,
    }];
    const obstacles = [{ id: 1, kind: 'low' as const, lane: start, z: 8 }];
    const result = collision.update(player, obstacles, coins, []);
    expect(result.destroyedCoinIds).toEqual([11]);
    expect(coins[0].destroyed).toBe(true);
    expect(coins[0].collected).toBe(false);
    expect(result.coinCollected).toBe(false);
  });

  it('does not crush a coin that spawned already overlapping an obstacle', () => {
    const collision = new CollisionSystem(gameRaw as GameConfig);
    const player = createInitialPlayer(gameRaw.lane.positions);
    const start = Math.floor(gameRaw.lane.positions.length / 2);
    const coins: CoinEntity[] = [{ id: 12, lane: start, z: 8, y: 0.55, collected: false }];
    const obstacles = [{ id: 1, kind: 'low' as const, lane: start, z: 8 }];
    const first = collision.update(player, obstacles, coins, []);
    expect(first.destroyedCoinIds).toEqual([]);
    expect(first.coinCollected).toBe(false);
    expect(coins[0].destroyed).toBeUndefined();
    expect(coins[0].crushArmed).toBeUndefined();
    coins[0].z = 16;
    collision.update(player, obstacles, coins, []);
    expect(coins[0].crushArmed).toBe(true);
    coins[0].z = 8;
    const second = collision.update(player, obstacles, coins, []);
    expect(second.destroyedCoinIds).toEqual([12]);
    expect(second.coinCollected).toBe(false);
  });

  it('crushes ground coins that overlap a train but leaves the train roof coins', () => {
    const collision = new CollisionSystem(gameRaw as GameConfig);
    const player = createInitialPlayer(gameRaw.lane.positions);
    const start = Math.floor(gameRaw.lane.positions.length / 2);
    const other = (start + 1) % gameRaw.lane.positions.length;
    const train = {
      id: 77,
      lane: start,
      z: 0,
      length: 18,
      height: 2.7,
      rideDuration: 3,
      rideRemaining: 3,
      landingDelay: 0,
      landingInset: 6,
      rideStarted: false,
      variant: 0 as const,
    };
    const coins: CoinEntity[] = [
      { id: 21, lane: start, z: 1, y: 0.55, collected: false },
      { id: 22, lane: start, z: 1, y: 3.2, collected: false, trainId: 77 },
      { id: 23, lane: other, z: 1, y: 0.55, collected: false },
    ];
    const result = collision.update(player, [], coins, [], [], [train]);
    expect(result.destroyedCoinIds).toEqual([21]);
    expect(coins[0].destroyed).toBe(true);
    expect(coins[1].destroyed).toBeUndefined();
    expect(coins[2].destroyed).toBeUndefined();
    expect(result.coinCollected).toBe(false);
  });
});

describe('GameSim', () => {
  function makeSim(
    seed?: number,
    levelgenOverride?: LevelgenConfig,
  ): { sim: GameSim; director: PassthroughDirector; setInput: (a: PlayerAction[]) => void } {
    const director = new PassthroughDirector(directorRaw as DirectorConfig);
    let input: PlayerAction[] = [];
    const sim = new GameSim({
      game: gameNoRocket,
      levelgen: levelgenOverride ?? (levelgenRaw as LevelgenConfig),
      director,
      consumeInput: () => input,
      nowMs: () => 0,
      getMusic: () => emptyMusic(),
      seed,
    });
    return { sim, director, setInput: (a) => (input = a) };
  }

  it('does not award coins crushed by an obstacle or a train', () => {
    const emptyLevelgen: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      rampProbability: 0,
      redWallProbability: 0,
    };
    const { sim } = makeSim(1, emptyLevelgen);
    const snap = sim.getSnapshot();
    const otherLane = (snap.player.lane + 1) % gameRaw.lane.positions.length;
    snap.obstacles.push({ id: 8101, kind: 'low', lane: otherLane, z: 8 });
    snap.coins.push({
      id: 8102,
      lane: otherLane,
      z: 8,
      y: 0.55,
      collected: false,
      crushArmed: true,
    });
    snap.trains.push({
      id: 8103,
      lane: snap.player.lane,
      z: 12,
      length: 16,
      height: 2.7,
      rideDuration: 3,
      rideRemaining: 3,
      landingDelay: 0,
      landingInset: 6,
      rideStarted: false,
      variant: 0,
    });
    snap.coins.push({ id: 8104, lane: snap.player.lane, z: 12, y: 0.55, collected: false });
    snap.coins.push({
      id: 8105,
      lane: snap.player.lane,
      z: 12,
      y: 3.2,
      collected: false,
      trainId: 8103,
    });
    const coinsBefore = snap.player.coins;
    sim.fixedUpdate(1 / 60);
    const after = sim.getSnapshot();
    expect(after.coins.find((coin) => coin.id === 8102)?.destroyed).toBe(true);
    expect(after.coins.find((coin) => coin.id === 8104)?.destroyed).toBe(true);
    expect(after.coins.find((coin) => coin.id === 8105)?.destroyed).not.toBe(true);
    expect(after.player.coins).toBe(coinsBefore);
  });

  it('scrolls obstacles per lane flow', () => {
    const flowCfg: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      laneFlow: [0, -6, 12, 0],
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
    };
    const { sim } = makeSim(123, flowCfg);
    const snap = sim.getSnapshot();
    snap.obstacles.push(
      { id: 1, kind: 'low', lane: 0, z: 100 },
      { id: 2, kind: 'low', lane: 1, z: 100 },
      { id: 3, kind: 'low', lane: 2, z: 100 },
      { id: 4, kind: 'low', lane: 3, z: 100 },
      { id: 5, kind: 'low', lane: 1, z: 110, flowGroupId: 77 },
      { id: 6, kind: 'low', lane: 2, z: 110, flowGroupId: 77 },
    );
    const initial = new Map(snap.obstacles.map((o) => [o.id, o.z]));
    for (let i = 0; i < 60; i++) sim.fixedUpdate(1 / 60);
    const after = new Map(sim.getSnapshot().obstacles.map((o) => [o.id, o.z]));
    const delta = (lane: number): number => initial.get(lane + 1)! - after.get(lane + 1)!;
    expect(delta(2)).toBeGreaterThan(delta(0));
    expect(delta(0)).toBeGreaterThan(delta(1));
    expect(delta(3)).toBeCloseTo(delta(0), 5);
    const groupedDrift = Math.abs(after.get(5)! - after.get(6)!);
    expect(groupedDrift).toBeCloseTo(
      Math.abs(flowCfg.laneFlow[2] - flowCfg.laneFlow[1]) *
        flowCfg.multiLaneFlowFactor,
      1,
    );
  });

  it('scrolls ground coins with the same lane flow as obstacles', () => {
    const flowCfg: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      laneFlow: [0, -6, 12, 0],
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
    };
    const { sim } = makeSim(123, flowCfg);
    const snap = sim.getSnapshot();
    snap.obstacles.push({ id: 1, kind: 'low', lane: 2, z: 80 });
    snap.coins.push({ id: 2, lane: 2, z: 88, y: 0.55, collected: false });
    const coinStart = snap.coins[0].z;
    const obstacleStart = snap.obstacles[0].z;
    for (let i = 0; i < 60; i++) sim.fixedUpdate(1 / 60);
    const after = sim.getSnapshot();
    const coin = after.coins.find((item) => item.id === 2);
    const obstacle = after.obstacles.find((item) => item.id === 1);
    expect(coin).toBeDefined();
    expect(obstacle).toBeDefined();
    expect(coin!.destroyed).not.toBe(true);
    expect(coinStart - coin!.z).toBeCloseTo(obstacleStart - obstacle!.z, 2);
  });

  it('keeps jump coins locked above their horse obstacles despite lane flow', () => {
    const flowCfg: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      laneFlow: [0, -6, 12, 0],
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
    };
    const { sim } = makeSim(123, flowCfg);
    sim.setMode('horse');
    const snap = sim.getSnapshot();
    snap.obstacles.push({
      id: 31,
      kind: 'low',
      lane: 2,
      z: 70,
      horseAction: 'jump',
      actionGroupId: 900,
      flowGroupId: 12,
    });
    snap.coins.push({
      id: 32,
      lane: 2,
      z: 70,
      y: (levelgenRaw as LevelgenConfig).horse.jumpCoinHeight,
      collected: false,
      actionGroupId: 900,
      flowGroupId: 12,
    });
    for (let i = 0; i < 60; i++) sim.fixedUpdate(1 / 60);
    const after = sim.getSnapshot();
    const coin = after.coins.find((item) => item.id === 32);
    const obstacle = after.obstacles.find((item) => item.id === 31);
    expect(coin?.z).toBeCloseTo(obstacle!.z, 5);
    expect(coin?.destroyed).not.toBe(true);
  });

  it('keeps a linked ramp at a fixed lead ahead of its red wall despite lane flow', () => {
    const emptyCfg: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      laneFlow: [0, -6, 12, 0],
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
    };
    const { sim } = makeSim(123, emptyCfg);
    const snap = sim.getSnapshot();
    snap.player.gameTime = (gameRaw as GameConfig).ramp.startDelaySeconds;
    const gateId = 91;
    const ramp = { id: 900, lane: 2, z: 40, gateId };
    snap.ramps.push(ramp);
    for (let lane = 0; lane < emptyCfg.lanes; lane++) {
      snap.obstacles.push({
        id: 901 + lane,
        kind: 'tall',
        lane,
        z: 52,
        redWall: true,
        gateId,
      });
    }
    const initialGap = snap.obstacles[0].z - ramp.z;
    for (let i = 0; i < 60; i++) sim.fixedUpdate(1 / 60);
    expect(snap.obstacles[0].z - ramp.z).toBeCloseTo(initialGap, 5);
  });

  it('advances distance and generates entities', () => {
    const { sim } = makeSim();
    for (let i = 0; i < 120; i++) sim.fixedUpdate(1 / 60);
    const snapshot = sim.getSnapshot();
    expect(snapshot.player.distance).toBeGreaterThan(0);
    expect(snapshot.obstacles.length + snapshot.coins.length).toBeGreaterThan(0);
    expect(snapshot.combo).toBe(0);
    expect(snapshot.comboMultiplier).toBe(1);
  });

  it('keeps newly generated chunks near the active world after a long run', () => {
    const { sim } = makeSim(321);
    for (let i = 0; i < 2400; i++) {
      for (const obstacle of sim.getSnapshot().obstacles) {
        if (obstacle.z < 10) obstacle.broken = true;
      }
      sim.fixedUpdate(1 / 60);
    }
    const snapshot = sim.getSnapshot();
    expect(snapshot.player.distance).toBeGreaterThan(200);
    expect(Math.max(...snapshot.obstacles.map((obstacle) => obstacle.z))).toBeLessThan(200);
  });

  it('builds combo by dodging obstacles and clears it on restart', () => {
    const combo = (gameRaw as GameConfig).combo;
    const noWalls: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      redWallProbability: 0,
      rampProbability: 0,
      wallProbability: 0,
      nitroReadyChallengeProbability: 0,
      laneFlow: [0, 0, 0, 0],
    };
    const { sim, setInput } = makeSim(1337, noWalls);
    const initial = sim.getSnapshot();
    initial.obstacles.push({
      id: 999,
      kind: 'low',
      lane: initial.player.lane,
      z: 20,
    });
    sim.fixedUpdate(1 / 60);
    setInput(['laneRight']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    for (let i = 0; i < 600 && sim.getSnapshot().combo === 0; i++) {
      sim.fixedUpdate(1 / 60);
    }
    expect(sim.getSnapshot().combo).toBe(1);
    const snapshot = sim.getSnapshot();
    expect(snapshot.comboMultiplier).toBe(comboMultiplier(snapshot.combo, combo));

    sim.restart();
    const restarted = sim.getSnapshot();
    expect(restarted.combo).toBe(0);
    expect(restarted.comboMultiplier).toBe(1);
    expect(restarted.player.combo).toBe(0);
  });

  it('resets combo when the player is hit', () => {
    const stable: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      twoObstacleBias: 0,
      tallProbability: 0,
      redWallProbability: 0,
      rampProbability: 0,
      wallProbability: 0,
      nitroReadyChallengeProbability: 0,
      laneFlow: [0, 0, 0, 0],
    };
    const { sim, setInput } = makeSim(1337, stable);
    const initial = sim.getSnapshot();
    initial.obstacles.push({
      id: 998,
      kind: 'low',
      lane: initial.player.lane,
      z: 20,
    });
    sim.fixedUpdate(1 / 60);
    setInput(['laneRight']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    for (let i = 0; i < 600 && sim.getSnapshot().combo === 0; i++) {
      sim.fixedUpdate(1 / 60);
    }
    const beforeHit = sim.getSnapshot();
    expect(beforeHit.combo).toBeGreaterThan(0);
    expect(beforeHit.player.damageState).toBe('normal');

    beforeHit.obstacles.push({
      id: 997,
      kind: 'low',
      lane: beforeHit.player.lane,
      z: 0.5,
    });
    sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().player.damageState).not.toBe('normal');
    expect(sim.getSnapshot().combo).toBe(0);
  });

  it('ghost mode skips player collisions while the world still advances', () => {
    const { sim } = makeSim();
    sim.setGhost(true);
    const startDistance = sim.getSnapshot().player.distance;
    for (let i = 0; i < 120; i++) sim.fixedUpdate(1 / 60);
    const snap = sim.getSnapshot();
    snap.obstacles.push({
      id: 4242,
      kind: 'tall',
      lane: snap.player.lane,
      z: 0.4,
    });
    for (let i = 0; i < 45; i++) sim.fixedUpdate(1 / 60);
    expect(sim.gameOver).toBe(false);
    expect(sim.getSnapshot().player.damageState).toBe('normal');
    expect(sim.getSnapshot().player.distance).toBeGreaterThan(startDistance);
  });

  it('emits game over when steering into an obstacle and restarts cleanly', () => {
    const { sim, setInput } = makeSim();
    let actions: PlayerAction[] = [];
    for (let i = 0; i < 2400 && !sim.gameOver; i++) {
      const snapshot = sim.getSnapshot();
      const nearest = snapshot.obstacles
        .filter((o) => o.z > 0)
        .sort((a, b) => a.z - b.z)[0];
      actions = nearest
        ? nearest.lane > snapshot.player.lane
          ? ['laneLeft']
          : nearest.lane < snapshot.player.lane
            ? ['laneRight']
            : []
        : [];
      setInput(actions);
      sim.fixedUpdate(1 / 60);
      setInput([]);
    }
    expect(sim.gameOver).toBe(true);

    sim.restart();
    const snapshot = sim.getSnapshot();
    expect(snapshot.player.gameOver).toBe(false);
    expect(snapshot.player.distance).toBe(0);
    expect(snapshot.player.coins).toBe(0);
  });

  it('passthrough director keeps phase calm and emits the default speed intent', () => {
    const { sim, director } = makeSim();
    sim.fixedUpdate(1 / 60);
    expect(director.phase).toBe('calm');
    expect(director.memory.intents.some((i) => i.target === 'speed' && i.value === 1)).toBe(true);
  });

  it('schedules a speed-timed safe pattern when the musical phase changes', () => {
    const director = new PhaseDirector('calm');
    const emptyLevelgen: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      rampProbability: 0,
      earlyRampProbability: 0,
      redWallProbability: 0,
      laneFlow: [0, 0, 0, 0],
    };
    const sim = new GameSim({
      game: gameNoRocket,
      levelgen: emptyLevelgen,
      director,
      consumeInput: () => [],
      nowMs: () => 0,
      getMusic: () => emptyMusic(),
      seed: 42,
    });
    sim.fixedUpdate(1 / 60);
    sim.playerSim.state.gameTime = (gameRaw as GameConfig).ramp.startDelaySeconds;
    director.phase = 'buildUp';
    sim.fixedUpdate(1 / 60);
    const snap = sim.getSnapshot();
    expect(snap.musicPattern).toBe('peakGate');
    expect(snap.musicScene).toMatchObject({
      kind: 'peakGate',
      phase: 'buildUp',
      reason: 'phase:buildUp',
      routeHint: 'ramp',
      echo: 'none',
    });
    expect(snap.musicScene!.remainingSeconds).toBeCloseTo(4, 1);
    expect(snap.musicScene!.guideLanes).toEqual([snap.player.lane]);
    const linkedRamp = snap.ramps.find((ramp) => ramp.gateId !== undefined);
    expect(linkedRamp).toBeDefined();
    expect(linkedRamp!.z / snap.player.speed).toBeCloseTo(4, 1);
    const linkedWall = snap.obstacles.filter(
      (obstacle) => obstacle.redWall && obstacle.gateId !== undefined,
    );
    expect(linkedWall).toHaveLength(emptyLevelgen.lanes);
  });

  it('schedules one scene from a rising strong beat without a phase change', () => {
    const director = new PhaseDirector('buildUp');
    let music = makeMusic({ energy: 0.35, brightness: 0.35, beat: false });
    const sim = new GameSim({
      game: gameNoRocket,
      levelgen: {
        ...(levelgenRaw as LevelgenConfig),
        segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
        rampProbability: 0,
        earlyRampProbability: 0,
        redWallProbability: 0,
        laneFlow: [0, 0, 0, 0],
      },
      director,
      consumeInput: () => [],
      nowMs: () => 0,
      getMusic: () => music,
      seed: 43,
    });

    sim.fixedUpdate(1 / 60);
    music = makeMusic({ energy: 0.9, brightness: 0.9, beat: true });
    sim.fixedUpdate(1 / 60);

    expect(sim.getSnapshot().musicScene).toMatchObject({
      phase: 'buildUp',
      reason: 'cue:risingBeat',
    });
  });

  it('adds a visible alternative ramp on a later strong beat', () => {
    const baseGame = gameNoRocket;
    const game: GameConfig = {
      ...baseGame,
      musicScenes: {
        ...baseGame.musicScenes,
        echoChance: 1,
        echoCooldownSeconds: 0,
        echoMinArrivalSeconds: 0.1,
        echoMaxArrivalSeconds: 10,
      },
    };
    const director = new PhaseDirector('calm');
    let music = emptyMusic();
    const sim = new GameSim({
      game,
      levelgen: {
        ...(levelgenRaw as LevelgenConfig),
        segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
        rampProbability: 0,
        earlyRampProbability: 0,
        redWallProbability: 0,
        laneFlow: [0, 0, 0, 0],
      },
      director,
      consumeInput: () => [],
      nowMs: () => 0,
      getMusic: () => music,
      seed: 44,
    });
    sim.fixedUpdate(1 / 60);
    sim.playerSim.state.gameTime = game.ramp.startDelaySeconds;
    director.phase = 'buildUp';
    sim.fixedUpdate(1 / 60);
    sim.getSnapshot().ramps.push({ id: -99, lane: 1, z: 15, musicSceneId: 777 });
    for (let i = 0; i < 24; i++) {
      music = makeMusic({ energy: 0.9, brightness: 0.9, beat: true });
      sim.fixedUpdate(1 / 60);
    }

    const snapshot = sim.getSnapshot();
    const ramps = snapshot.ramps.filter((ramp) => ramp.musicSceneId === 777);
    expect(ramps).toHaveLength(2);
    expect(new Set(ramps.map((ramp) => ramp.lane)).size).toBe(2);
  });

  it('places a road horse pickup during a peak at the end of a guided obstacle corridor', () => {
    const baseGame = gameNoRocket;
    const eventGame: GameConfig = {
      ...baseGame,
      horse: {
        ...baseGame.horse,
        firstHorseMinSeconds: 0,
        modeBonusMinSeconds: 0,
        lateSongSwitchMinSeconds: 0,
        roadHorsePickupChance: 1,
        lateSongRoadHorsePickupChance: 1,
      },
    };
    const emptyLevelgen: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      rampProbability: 0,
      earlyRampProbability: 0,
      redWallProbability: 0,
      laneFlow: [0, 0, 0, 0],
    };
    const director = new PhaseDirector('calm');
    const sim = new GameSim({
      game: eventGame,
      levelgen: emptyLevelgen,
      director,
      consumeInput: () => [],
      nowMs: () => 0,
      getMusic: () => emptyMusic(),
      getSongProgress: () => 1,
      seed: 144,
    });
    sim.fixedUpdate(1 / 60);
    director.phase = 'peak';
    sim.fixedUpdate(1 / 60);
    const snapshot = sim.getSnapshot();
    const bonus = snapshot.bonuses.find((candidate) => candidate.kind === 'horse');
    expect(snapshot.musicPattern).toBe('horseRoadTransition');
    expect(bonus).toBeDefined();
    expect(snapshot.ramps).toHaveLength(0);
    expect(snapshot.runStats.horseOffers).toBe(1);
    expect(snapshot.coins).toHaveLength(eventGame.horse.roadHorsePickupRows);
    for (const coin of snapshot.coins) {
      const row = snapshot.obstacles.filter((obstacle) => obstacle.z === coin.z);
      expect(row).toHaveLength(emptyLevelgen.lanes - 1);
      expect(row.some((obstacle) => obstacle.lane === coin.lane)).toBe(false);
    }
    const lastCoinZ = Math.max(...snapshot.coins.map((coin) => coin.z));
    expect(bonus!.z - lastCoinZ).toBe(eventGame.horse.roadHorsePickupGapZ);
    expect(bonus!.lane).toBe(snapshot.coins.at(-1)!.lane);
  });

  it('mixes red and smashable objects in the music-driven intense slalom', () => {
    const director = new PhaseDirector('calm');
    const emptyLevelgen: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      rampProbability: 0,
      earlyRampProbability: 0,
      redWallProbability: 0,
      laneFlow: [0, 0, 0, 0],
    };
    const sim = new GameSim({
      game: gameNoRocket,
      levelgen: emptyLevelgen,
      director,
      consumeInput: () => [],
      nowMs: () => 0,
      getMusic: () => emptyMusic(),
      seed: 42,
    });
    sim.fixedUpdate(1 / 60);
    director.phase = 'intense';
    sim.fixedUpdate(1 / 60);
    const patternObstacles = sim
      .getSnapshot()
      .obstacles.filter((obstacle) => obstacle.id <= -100000);
    expect(patternObstacles.some((obstacle) => obstacle.kind === 'tall')).toBe(true);
    expect(patternObstacles.some((obstacle) => obstacle.kind === 'low')).toBe(true);
  });

  it('offers the first horse pickup only after 30 seconds and in ramp flight', () => {
    const baseGame = gameNoRocket;
    const eventGame: GameConfig = {
      ...baseGame,
      horse: {
        ...baseGame.horse,
        modeBonusMinSeconds: 0,
        firstHorseMinSeconds: 30,
        horseRampPickupChance: 1,
      },
      train: { ...baseGame.train, chance: 0 },
    };
    const emptyLevelgen: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      rampProbability: 0,
      redWallProbability: 0,
    };
    const makeRampSim = (gameTime: number): GameSim => {
      const sim = new GameSim({
        game: eventGame,
        levelgen: emptyLevelgen,
        director: new PhaseDirector('peak'),
        consumeInput: () => [],
        nowMs: () => 0,
        getMusic: () => emptyMusic(),
        seed: 42,
      });
      const snapshot = sim.getSnapshot();
      snapshot.player.gameTime = gameTime;
      snapshot.ramps.push({ id: 7000 + gameTime, lane: snapshot.player.lane, z: 0 });
      return sim;
    };

    const early = makeRampSim(29);
    early.fixedUpdate(1 / 60);
    expect(early.getSnapshot().bonuses).toHaveLength(0);

    const eligible = makeRampSim(30);
    eligible.getSnapshot().ramps[0].gateId = 7300;
    eligible.getSnapshot().obstacles.push(
      {
        id: 7301,
        kind: 'tall',
        lane: eligible.getSnapshot().player.lane,
        z: 14,
        redWall: true,
        gateId: 7300,
      },
      {
        id: 7302,
        kind: 'low',
        lane: eligible.getSnapshot().player.lane,
        z: 45,
        nitroChallenge: true,
      },
    );
    eligible.fixedUpdate(1 / 60);
    const eligibleSnapshot = eligible.getSnapshot();
    const bonus = eligibleSnapshot.bonuses[0];
    expect(bonus.kind).toBe('horse');
    expect(bonus.airPathId).toBeDefined();
    expect(bonus.airTargetTime).toBeGreaterThan(eventGame.ramp.airCoinStartSeconds);
    expect(bonus.airTargetTime).toBeLessThan(eventGame.ramp.airCoinEndSeconds);
    const guideCoins = eligibleSnapshot.coins.filter(
      (coin) => coin.airPathId === bonus.airPathId,
    );
    expect(
      guideCoins.some((coin) => (coin.airTargetTime ?? 0) < (bonus.airTargetTime ?? 0)),
    ).toBe(true);
    expect(
      guideCoins.some(
        (coin) => Math.abs((coin.airTargetTime ?? 0) - (bonus.airTargetTime ?? 0)) < 0.0001,
      ),
    ).toBe(false);
    expect(bonus.y).toBeGreaterThan(eventGame.obstacle.tallHeight);
  });

  it('applies the configured ramp chance and guarantees the next event at the maximum interval', () => {
    const baseGame = gameNoRocket;
    const eventGame: GameConfig = {
      ...baseGame,
      horse: {
        ...baseGame.horse,
        modeBonusMinSeconds: 0,
        modeBonusMaxSeconds: 65,
        firstHorseMinSeconds: 0,
        firstHorseGuaranteedSeconds: 999,
      },
      train: { ...baseGame.train, chance: 0 },
    };
    const emptyLevelgen: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      rampProbability: 0,
      redWallProbability: 0,
    };
    const triggersPickup = (seed: number, guaranteed: boolean): boolean => {
      const sim = new GameSim({
        game: guaranteed
          ? {
              ...eventGame,
              horse: { ...eventGame.horse, modeBonusMaxSeconds: 0.001 },
            }
          : eventGame,
        levelgen: emptyLevelgen,
        director: new PhaseDirector('peak'),
        consumeInput: () => [],
        nowMs: () => 0,
        getMusic: () => emptyMusic(),
        seed,
      });
      const snapshot = sim.getSnapshot();
      snapshot.player.gameTime = 50;
      snapshot.ramps.push({ id: 7400 + seed, lane: snapshot.player.lane, z: 0 });
      sim.fixedUpdate(1 / 60);
      return snapshot.bonuses.some((bonus) => bonus.kind === 'horse');
    };

    const normalHits = Array.from({ length: 80 }, (_, seed) =>
      triggersPickup(seed, false) ? 1 : 0,
    ).reduce<number>((sum, value) => sum + value, 0);
    expect(normalHits).toBeGreaterThan(40);
    expect(normalHits).toBeLessThan(72);
    expect(Array.from({ length: 12 }, (_, seed) => triggersPickup(seed, true)).every(Boolean)).toBe(
      true,
    );
  });

  it('keeps only one pending mode bonus during a culmination', () => {
    const baseGame = gameNoRocket;
    const eventGame: GameConfig = {
      ...baseGame,
      horse: {
        ...baseGame.horse,
        modeBonusMinSeconds: 0,
        firstHorseMinSeconds: 0,
        horseRampPickupChance: 1,
      },
      train: { ...baseGame.train, chance: 0 },
    };
    const sim = new GameSim({
      game: eventGame,
      levelgen: {
        ...(levelgenRaw as LevelgenConfig),
        segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
        rampProbability: 0,
        redWallProbability: 0,
      },
      director: new PhaseDirector('peak'),
      consumeInput: () => [],
      nowMs: () => 0,
      getMusic: () => emptyMusic(),
      seed: 7,
    });
    const snapshot = sim.getSnapshot();
    snapshot.player.gameTime = 50;
    snapshot.ramps.push({ id: 7100, lane: snapshot.player.lane, z: 0 });
    sim.fixedUpdate(1 / 60);
    for (let i = 0; i < 10; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().bonuses).toHaveLength(1);
  });

  it('applies the mode-switch cooldown before offering the horse again', () => {
    const baseGame = gameNoRocket;
    const cooldownGame: GameConfig = {
      ...baseGame,
      horse: {
        ...baseGame.horse,
        modeBonusMinSeconds: 0.25,
        firstHorseMinSeconds: 0,
        horseRampPickupChance: 1,
      },
      train: { ...baseGame.train, chance: 0 },
    };
    const canSpawnAfter = (elapsedSeconds: number): boolean => {
      const sim = new GameSim({
        game: cooldownGame,
        levelgen: {
          ...(levelgenRaw as LevelgenConfig),
          segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
          rampProbability: 0,
          earlyRampProbability: 0,
          redWallProbability: 0,
        },
        director: new PhaseDirector('peak'),
        consumeInput: () => [],
        nowMs: () => 0,
        getMusic: () => emptyMusic(),
        seed: 91,
      });
      sim.setMode('horse');
      sim.setMode('car');
      sim.getSnapshot().player.gameTime = 100;
      for (let i = 0; i < Math.ceil(elapsedSeconds * 60); i++) sim.fixedUpdate(1 / 60);
      sim.getSnapshot().ramps.push({ id: 7600, lane: sim.getSnapshot().player.lane, z: 0 });
      sim.fixedUpdate(1 / 60);
      return sim.getSnapshot().bonuses.some((bonus) => bonus.kind === 'horse');
    };

    expect(canSpawnAfter(0.1)).toBe(false);
    expect(canSpawnAfter(0.3)).toBe(true);
  });

  it('clears bonuses on restart', () => {
    const sim = new GameSim({
      game: gameNoRocket,
      levelgen: levelgenRaw as LevelgenConfig,
      director: new PhaseDirector('buildUp'),
      consumeInput: () => [],
      nowMs: () => 0,
      getMusic: () => emptyMusic(),
      seed: 3,
    });
    sim.getSnapshot().bonuses.push({
      id: 7200,
      kind: 'horse',
      lane: sim.getSnapshot().player.lane,
      z: 20,
      collected: false,
    });
    expect(sim.getSnapshot().bonuses).toHaveLength(1);
    sim.restart();
    expect(sim.getSnapshot().bonuses).toHaveLength(0);
    expect(sim.getSnapshot().bonusPicked).toBeNull();
  });
});

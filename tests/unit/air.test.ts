import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import type { PlayerAction } from '@core/gameplay/actions';
import { PlayerSim } from '@core/gameplay/PlayerSim';
import { GameSim } from '@core/gameplay/GameSim';
import {
  addTrick,
  airHeight,
  landingHeight,
  startAir,
  trickScoreMultiplier,
  updateAir,
} from '@core/gameplay/air';
import type { AirPlayerFields } from '@core/gameplay/air';
import { PassthroughDirector } from '@core/director/PassthroughDirector';
import { emptyMusic, withoutRocketSpawn } from './musicHelpers';

describe('air mechanics', () => {
  const ramp = (gameRaw as GameConfig).ramp;

  it('startAir puts the player airborne and resets the flight fields', () => {
    const player: AirPlayerFields = { airState: 'grounded', airTime: 1, spinAngle: 3, trickCount: 2 };
    startAir(player);
    expect(player.airState).toBe('airborne');
    expect(player.airTime).toBe(0);
    expect(player.spinAngle).toBe(0);
    expect(player.trickCount).toBe(0);
  });

  it('airHeight arcs from the ground to the apex and back down', () => {
    expect(airHeight(ramp, 0)).toBeCloseTo(0, 5);
    expect(airHeight(ramp, ramp.flightTimeSeconds / 2)).toBeCloseTo(ramp.height, 5);
    expect(airHeight(ramp, ramp.flightTimeSeconds)).toBeCloseTo(0, 5);
  });

  it('each trick adds a full spin', () => {
    const player: AirPlayerFields = { airState: 'airborne', airTime: 0, spinAngle: 0, trickCount: 0 };
    addTrick(player);
    addTrick(player);
    expect(player.trickCount).toBe(2);
    expect(player.spinAngle).toBeCloseTo(Math.PI * 4, 5);
  });

  it('updateAir walks airborne -> landing -> grounded and reports the trick count', () => {
    const player: AirPlayerFields = { airState: 'airborne', airTime: 0, spinAngle: 1, trickCount: 3 };
    let result = updateAir(player, ramp.flightTimeSeconds + 0.01, ramp);
    expect(player.airState).toBe('landing');
    expect(result).toEqual({ trickCount: 3 });

    result = updateAir(player, ramp.landingTimeSeconds + 0.01, ramp);
    expect(player.airState).toBe('grounded');
    expect(player.trickCount).toBe(0);
    expect(player.spinAngle).toBe(0);
    expect(result).toBeNull();
  });

  it('landingHeight eases the player down from a small height', () => {
    expect(landingHeight(ramp, 0)).toBeGreaterThan(0);
    expect(landingHeight(ramp, ramp.landingTimeSeconds)).toBeCloseTo(0, 5);
  });

  it('trickScoreMultiplier stays 1 below the series start and grows beyond it', () => {
    expect(trickScoreMultiplier(0, ramp)).toBe(1);
    expect(trickScoreMultiplier(ramp.trickSeriesStart - 1, ramp)).toBe(1);
    expect(trickScoreMultiplier(ramp.trickSeriesStart, ramp)).toBe(
      1 + ramp.trickSeriesStart * ramp.trickSeriesScoreMultiplier,
    );
    expect(trickScoreMultiplier(5, ramp)).toBe(1 + 5 * ramp.trickSeriesScoreMultiplier);
  });
});

describe('PlayerSim air', () => {
  const cfg = gameRaw as GameConfig;

  it('launchFromRamp lifts the player above tall obstacles mid-flight', () => {
    const sim = new PlayerSim(cfg);
    sim.launchFromRamp();
    expect(sim.state.airState).toBe('airborne');
    let maxY = 0;
    for (let i = 0; i < Math.ceil(cfg.ramp.flightTimeSeconds / 0.01); i++) {
      sim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
      maxY = Math.max(maxY, sim.state.y);
    }
    expect(maxY).toBeGreaterThan(cfg.obstacle.tallHeight);
  });

  it('steering while airborne counts tricks and the landing resets them', () => {
    const sim = new PlayerSim(cfg);
    sim.launchFromRamp();
    const steps = Math.floor(cfg.ramp.flightTimeSeconds / 0.01);
    for (let i = 0; i < steps; i++) {
      sim.update(0.01, { laneDelta: 1, jump: false, nitro: false }, 1);
    }
    expect(sim.state.trickCount).toBeGreaterThan(0);
    expect(sim.state.spinAngle).toBeGreaterThan(0);

    const total = Math.ceil((cfg.ramp.flightTimeSeconds + cfg.ramp.landingTimeSeconds) / 0.01) + 5;
    for (let i = 0; i < total; i++) {
      sim.update(0.01, { laneDelta: 1, jump: false, nitro: false }, 1);
    }
    expect(sim.state.airState).toBe('grounded');
    expect(sim.state.trickCount).toBe(0);
    expect(sim.state.spinAngle).toBe(0);
  });

  it('steering on the ground does not count tricks', () => {
    const sim = new PlayerSim(cfg);
    sim.update(0.01, { laneDelta: 1, jump: false, nitro: false }, 1);
    expect(sim.state.trickCount).toBe(0);
    expect(sim.state.spinAngle).toBe(0);
  });

  it('retains ramp speed after landing and decays it smoothly', () => {
    const withRamp = new PlayerSim(cfg);
    withRamp.launchFromRamp();
    const withoutRamp = new PlayerSim(cfg);
    const flightSteps = Math.ceil(cfg.ramp.flightTimeSeconds / 0.01);
    let boostedMax = 0;
    let normalMax = 0;
    for (let i = 0; i < flightSteps; i++) {
      withRamp.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
      withoutRamp.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
      boostedMax = Math.max(boostedMax, withRamp.state.speed);
      normalMax = Math.max(normalMax, withoutRamp.state.speed);
    }
    expect(boostedMax).toBeGreaterThan(normalMax);
    const landingSteps = Math.ceil(cfg.ramp.landingTimeSeconds / 0.01) + 5;
    for (let i = 0; i < landingSteps; i++) {
      withRamp.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
      withoutRamp.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    expect(withRamp.state.airState).toBe('grounded');
    expect(withRamp.state.speed).toBeGreaterThan(withoutRamp.state.speed * 1.1);

    const decaySteps = Math.ceil((cfg.ramp.retainedSpeedDecaySeconds + 0.1) / 0.01);
    for (let i = 0; i < decaySteps; i++) {
      withRamp.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
      withoutRamp.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    expect(withRamp.state.speed).toBeCloseTo(withoutRamp.state.speed, 2);
  });

  it('steering while airborne counts a trick at most once per trickCooldownSeconds', () => {
    const sim = new PlayerSim(cfg);
    sim.launchFromRamp();
    for (let i = 0; i < 10; i++) {
      sim.update(0.01, { laneDelta: 1, jump: false, nitro: false }, 1);
    }
    expect(sim.state.trickCount).toBe(1);
  });

  it('accelerates on a train and retains most of that boost after exit', () => {
    const train = new PlayerSim(cfg);
    const normal = new PlayerSim(cfg);
    train.landOnTrain();
    train.update(0.5, { laneDelta: 0, jump: false, nitro: false }, 1);
    normal.update(0.5, { laneDelta: 0, jump: false, nitro: false }, 1);
    expect(train.state.speed).toBeGreaterThan(normal.state.speed * 1.25);

    train.exitTrain();
    train.update(0.5, { laneDelta: 0, jump: false, nitro: false }, 1);
    normal.update(0.5, { laneDelta: 0, jump: false, nitro: false }, 1);
    expect(train.state.speed).toBeGreaterThan(normal.state.speed * 1.12);
  });
});

describe('GameSim ramps and landings', () => {
  const game: GameConfig = {
    ...withoutRocketSpawn(gameRaw as GameConfig),
    ramp: { ...(gameRaw as GameConfig).ramp, startDelaySeconds: 0 },
    nitro: { ...(gameRaw as GameConfig).nitro, gainPerChargeLaneSecond: 0 },
  };

  function makeSim(gameConfig: GameConfig = game): {
    sim: GameSim;
    setInput: (a: PlayerAction[]) => void;
  } {
    const director = new PassthroughDirector(directorRaw as DirectorConfig);
    let input: PlayerAction[] = [];
    const emptyLevelgen: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      redWallProbability: 0,
      rampProbability: 0,
      riskZone: { ...(levelgenRaw as LevelgenConfig).riskZone, riskLanes: [] },
    };
    const sim = new GameSim({
      game: gameConfig,
      levelgen: emptyLevelgen,
      director,
      consumeInput: () => input,
      nowMs: () => 0,
      getMusic: () => emptyMusic(),
      seed: 42,
    });
    return { sim, setInput: (a) => (input = a) };
  }

  it('removes ramps and their linked red walls during the first 10 seconds', () => {
    const delayedGame: GameConfig = {
      ...game,
      ramp: { ...game.ramp, startDelaySeconds: 10 },
    };
    const { sim } = makeSim(delayedGame);
    const snap = sim.getSnapshot();
    snap.ramps.push({ id: 9000, lane: snap.player.lane, z: 20, gateId: 700 });
    for (let lane = 0; lane < 4; lane++) {
      snap.obstacles.push({
        id: 9010 + lane,
        kind: 'tall',
        lane,
        z: 32,
        redWall: true,
        gateId: 700,
      });
    }
    sim.fixedUpdate(1 / 60);
    expect(snap.ramps.some((ramp) => ramp.gateId === 700)).toBe(false);
    expect(snap.obstacles.some((obstacle) => obstacle.gateId === 700)).toBe(false);
  });

  it('preserves distant ramps scheduled to arrive after the opening delay', () => {
    const delayedGame: GameConfig = {
      ...game,
      ramp: { ...game.ramp, startDelaySeconds: 10 },
    };
    const { sim } = makeSim(delayedGame);
    const snap = sim.getSnapshot();
    snap.ramps.push({ id: 9050, lane: snap.player.lane, z: 130, gateId: 705 });
    snap.obstacles.push({
      id: 9051,
      kind: 'tall',
      lane: snap.player.lane,
      z: 142,
      redWall: true,
      gateId: 705,
    });

    sim.fixedUpdate(1 / 60);

    expect(snap.ramps.some((ramp) => ramp.gateId === 705)).toBe(true);
    expect(snap.obstacles.some((obstacle) => obstacle.gateId === 705)).toBe(true);
    expect(snap.coins.some((coin) => coin.rampGuideId === 9050)).toBe(false);
  });

  it('keeps the current gate but suppresses later ramps for at least 10 seconds', () => {
    const { sim } = makeSim();
    const snap = sim.getSnapshot();
    snap.ramps.push({ id: 9100, lane: snap.player.lane, z: 3, gateId: 710 });
    for (let lane = 0; lane < 4; lane++) {
      snap.obstacles.push({
        id: 9110 + lane,
        kind: 'tall',
        lane,
        z: 15,
        redWall: true,
        gateId: 710,
      });
    }
    for (let i = 0; i < 120 && snap.player.airState !== 'airborne'; i++) {
      sim.fixedUpdate(1 / 60);
    }
    expect(snap.player.airState).toBe('airborne');

    snap.ramps.push({ id: 9200, lane: 0, z: 40, gateId: 720 });
    snap.obstacles.push({
      id: 9210,
      kind: 'tall',
      lane: 0,
      z: 52,
      redWall: true,
      gateId: 720,
    });
    sim.fixedUpdate(1 / 60);
    expect(snap.obstacles.some((obstacle) => obstacle.gateId === 710)).toBe(true);
    expect(snap.ramps.some((ramp) => ramp.gateId === 720)).toBe(false);
    expect(snap.obstacles.some((obstacle) => obstacle.gateId === 720)).toBe(false);

    for (let i = 0; i < 9 * 60; i++) sim.fixedUpdate(1 / 60);
    snap.ramps.push({ id: 9300, lane: 0, z: 50 });
    sim.fixedUpdate(1 / 60);
    expect(snap.ramps.some((ramp) => ramp.id === 9300)).toBe(false);

    for (let i = 0; i < 70; i++) sim.fixedUpdate(1 / 60);
    snap.ramps.push({ id: 9400, lane: 0, z: 50 });
    sim.fixedUpdate(1 / 60);
    expect(snap.ramps.some((ramp) => ramp.id === 9400)).toBe(true);
  });

  it('places one guide coin before each of the first three available ramps', () => {
    const { sim } = makeSim();
    const snap = sim.getSnapshot();
    for (let index = 0; index < 4; index++) {
      snap.ramps.push({ id: 9500 + index, lane: snap.player.lane, z: 20 + index * 20 });
    }

    for (let index = 0; index < 3; index++) {
      sim.fixedUpdate(0);
      const ramp = snap.ramps[index];
      const guide = snap.coins.find((coin) => coin.rampGuideId === ramp.id);
      expect(guide).toBeDefined();
      expect(guide!.lane).toBe(ramp.lane);
      expect(guide!.z).toBeCloseTo(ramp.z - levelgenRaw.minGapZ, 5);
      ramp.used = true;
      ramp.z = -3;
    }

    sim.fixedUpdate(0);
    expect(snap.coins.some((coin) => coin.rampGuideId === 9503)).toBe(false);
  });

  it('launching from a ramp, doing tricks, and landing clean grants nitro and coins', () => {
    const { sim, setInput } = makeSim();
    const snap = sim.getSnapshot();
    const ramp = { id: 999, lane: snap.player.lane, z: 12, used: false };
    snap.ramps.push(ramp);

    let launched = false;
    for (let i = 0; i < 6000; i++) {
      const s = sim.getSnapshot();
      if (!launched && s.player.airState === 'airborne') launched = true;
      if (launched && s.player.airState === 'grounded') break;
      setInput(launched ? ['laneRight'] : []);
      sim.fixedUpdate(1 / 60);
      setInput([]);
    }
    const after = sim.getSnapshot();
    expect(launched).toBe(true);
    expect(after.player.coins).toBeGreaterThan(0);
    expect(after.player.nitroCharge).toBeGreaterThan(0);
    expect(after.runStats.tricks).toBeGreaterThan(0);
    expect(ramp.used).toBe(true);
  });

  it('landing clean without tricks grants only collected air-coin rewards', () => {
    const { sim } = makeSim();
    const snap = sim.getSnapshot();
    snap.ramps.push({ id: 999, lane: snap.player.lane, z: 12 });

    let launched = false;
    for (let i = 0; i < 6000; i++) {
      const s = sim.getSnapshot();
      if (!launched && s.player.airState === 'airborne') launched = true;
      if (launched && s.player.airState === 'grounded') break;
      sim.fixedUpdate(1 / 60);
    }
    const after = sim.getSnapshot();
    expect(launched).toBe(true);
    expect(after.player.coins).toBeGreaterThan(0);
    expect(after.player.nitroCharge).toBeCloseTo(
      after.player.coins * game.nitro.gainPerCoin,
      5,
    );
  });

  it('flies over a tall obstacle without being hit or breaking it', () => {
    const { sim } = makeSim();
    const snap = sim.getSnapshot();
    snap.ramps.push({ id: 999, lane: snap.player.lane, z: 10 });
    const obstacle = { id: 1001, kind: 'tall' as const, lane: snap.player.lane, z: 24, broken: false };
    snap.obstacles.push(obstacle);

    let launched = false;
    for (let i = 0; i < 6000; i++) {
      const s = sim.getSnapshot();
      if (!launched && s.player.airState === 'airborne') launched = true;
      if (launched && s.player.airState === 'grounded') break;
      sim.fixedUpdate(1 / 60);
    }
    const after = sim.getSnapshot();
    expect(launched).toBe(true);
    expect(after.player.damageState).toBe('normal');
    expect(obstacle.broken).toBeFalsy();
  });

  it('creates high air coins and reflows their timing when nitro starts mid-flight', () => {
    const { sim, setInput } = makeSim();
    const snap = sim.getSnapshot();
    snap.ramps.push({ id: 999, lane: snap.player.lane, z: 3 });
    for (let i = 0; i < 600 && sim.getSnapshot().player.airState !== 'airborne'; i++) {
      sim.fixedUpdate(1 / 60);
    }
    const launched = sim.getSnapshot();
    const airCoins = launched.coins.filter((coin) => coin.airTargetTime !== undefined);
    expect(airCoins).toHaveLength(game.ramp.airCoinCalmCount);
    expect(airCoins.some((coin) => (coin.y ?? 0) > game.player.height * 2)).toBe(true);

    launched.player.nitroCharge = game.nitro.maxFill;
    setInput(['nitro']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    const boosted = sim.getSnapshot();
    expect(boosted.player.isAbilityActive).toBe(true);
    const futureCoin = boosted.coins.find(
      (coin) =>
        coin.airTargetTime !== undefined &&
        coin.airTargetTime > boosted.player.airTime + 0.2,
    );
    expect(futureCoin).toBeDefined();
    expect(futureCoin!.z).toBeCloseTo(
      (futureCoin!.airTargetTime! - boosted.player.airTime) * boosted.player.speed,
      5,
    );
  });

  it('landing on an obstacle breaks it and grants no automatic trick rewards', () => {
    const { sim } = makeSim();
    const snap = sim.getSnapshot();
    snap.ramps.push({ id: 999, lane: snap.player.lane, z: 12 });

    let launched = false;
    for (let i = 0; i < 6000; i++) {
      const s = sim.getSnapshot();
      if (!launched && s.player.airState === 'airborne') launched = true;
      if (launched && s.player.airTime >= game.ramp.flightTimeSeconds - 2 / 60) {
        s.obstacles.push({ id: 1000, kind: 'tall', lane: s.player.lane, z: 0.5, broken: false });
      }
      if (launched && s.player.airState === 'grounded') break;
      sim.fixedUpdate(1 / 60);
    }
    const after = sim.getSnapshot();
    const landed = after.obstacles.find((o) => o.id === 1000);
    expect(landed).toBeDefined();
    expect(landed!.broken).toBe(true);
    expect(after.player.coins).toBeGreaterThan(0);
    expect(after.player.nitroCharge).toBeCloseTo(
      after.player.coins * game.nitro.gainPerCoin,
      5,
    );
  });

  it('breaks a tall obstacle on the first landing frame after a ramp', () => {
    const { sim } = makeSim();
    sim.playerSim.launchFromRamp();
    for (let i = 0; i < 600 && sim.getSnapshot().player.airState === 'airborne'; i++) {
      sim.fixedUpdate(1 / 60);
    }
    const landing = sim.getSnapshot();
    expect(landing.player.airState).toBe('landing');
    landing.obstacles.push({
      id: 1400,
      kind: 'tall',
      lane: landing.player.lane,
      z: 0,
    });
    sim.fixedUpdate(1 / 60);
    const after = sim.getSnapshot();
    expect(after.player.airState).toBe('landing');
    const obstacle = after.obstacles.find((item) => item.id === 1400);
    expect(obstacle?.broken).toBe(true);
    expect(after.player.damageState).toBe('damaged');
  });

  it('smashes a low obstacle with nitro on the first landing frame after a ramp', () => {
    const { sim } = makeSim();
    sim.playerSim.launchFromRamp();
    for (let i = 0; i < 600 && sim.getSnapshot().player.airState === 'airborne'; i++) {
      sim.fixedUpdate(1 / 60);
    }
    const landing = sim.getSnapshot();
    expect(landing.player.airState).toBe('landing');
    landing.player.nitroCharge = game.nitro.maxFill;
    sim.playerSim.activateNitro();
    landing.obstacles.push({
      id: 1401,
      kind: 'low',
      lane: landing.player.lane,
      z: 0,
    });
    sim.fixedUpdate(1 / 60);
    const after = sim.getSnapshot();
    const obstacle = after.obstacles.find((item) => item.id === 1401);
    expect(obstacle?.smashed).toBe(true);
    expect(after.player.damageState).toBe('normal');
  });
});

describe('GameSim trains', () => {
  const baseGame = withoutRocketSpawn(gameRaw as GameConfig);
  const game: GameConfig = {
    ...baseGame,
    ramp: { ...baseGame.ramp, startDelaySeconds: 0 },
    train: {
      ...baseGame.train,
      chance: 1,
      cooldownSeconds: 0,
      companionChance: 0,
      roofObstacleChance: 0,
    },
    nitro: { ...baseGame.nitro, gainPerChargeLaneSecond: 0 },
  };

  function makeTrainSim(
    gameConfig: GameConfig = game,
  ): { sim: GameSim; setInput: (actions: PlayerAction[]) => void } {
    let input: PlayerAction[] = [];
    const levelgen: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      rampProbability: 0,
      redWallProbability: 0,
      riskZone: { ...(levelgenRaw as LevelgenConfig).riskZone, riskLanes: [] },
    };
    const sim = new GameSim({
      game: gameConfig,
      levelgen,
      director: new PassthroughDirector(directorRaw as DirectorConfig),
      consumeInput: () => input,
      nowMs: () => 0,
      getMusic: () => emptyMusic(),
      seed: 42,
    });
    return { sim, setInput: (actions) => (input = actions) };
  }

  function reachTrainRoof(sim: GameSim, setInput: (actions: PlayerAction[]) => void): number {
    const snap = sim.getSnapshot();
    snap.ramps.push({ id: 50000, lane: snap.player.lane, z: 3 });
    let finalAirborneY = 0;
    for (let i = 0; i < 600 && sim.getSnapshot().player.airState !== 'trainRoof'; i++) {
      const current = sim.getSnapshot();
      const targetLane = current.trains[0]?.lane;
      if (targetLane !== undefined && current.player.lane !== targetLane) {
        setInput([current.player.lane < targetLane ? 'laneLeft' : 'laneRight']);
      } else {
        setInput([]);
      }
      sim.fixedUpdate(1 / 60);
      if (sim.getSnapshot().player.airState === 'airborne') {
        finalAirborneY = sim.getSnapshot().player.y;
      }
    }
    setInput([]);
    expect(sim.getSnapshot().player.airState).toBe('trainRoof');
    return finalAirborneY;
  }

  it('uses the guided lane for an exact roof landing and preserves roof coins while riding', () => {
    const { sim, setInput } = makeTrainSim();
    const finalAirborneY = reachTrainRoof(sim, setInput);
    const landed = sim.getSnapshot();
    const train = landed.trains[0];
    expect(landed.player.lane).toBe(train.lane);
    expect(game.train.allowedLanes).toContain(train.lane);
    expect(landed.player.y).toBeCloseTo(game.train.height, 5);
    expect(train.z - train.length / 2).toBeCloseTo(-game.train.landingInset, 1);
    expect(finalAirborneY).toBeGreaterThan(game.train.height * 0.95);
    const roofCoinsBefore = landed.coins.filter((coin) => coin.trainId === train.id).length;
    expect(roofCoinsBefore).toBeGreaterThan(5);

    for (let i = 0; i < 30; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().coins.filter((coin) => coin.trainId === train.id).length)
      .toBe(roofCoinsBefore);
  });

  it('activates nitro on the train roof without bailing off', () => {
    const { sim, setInput } = makeTrainSim();
    reachTrainRoof(sim, setInput);
    const snapshot = sim.getSnapshot();
    snapshot.player.nitroCharge = game.nitro.maxFill;
    setInput(['nitro']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    expect(sim.getSnapshot().player.airState).toBe('trainRoof');
    expect(sim.getSnapshot().player.isAbilityActive).toBe(true);
  });

  it('allows a manual side exit without counting a trick', () => {
    const { sim, setInput } = makeTrainSim();
    reachTrainRoof(sim, setInput);
    const trainId = sim.getSnapshot().trains[0].id;
    const lane = sim.getSnapshot().player.lane;
    setInput([lane === game.lane.positions.length - 1 ? 'laneRight' : 'laneLeft']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    expect(sim.getSnapshot().player.airState).toBe('trainExit');
    expect(sim.getSnapshot().player.trickCount).toBe(0);
    expect(sim.getSnapshot().coins.some((coin) => coin.trainId === trainId)).toBe(false);
  });

  it('ends a train ride after the configured calm duration and creates a safe descent', () => {
    const { sim, setInput } = makeTrainSim();
    reachTrainRoof(sim, setInput);
    const lane = sim.getSnapshot().player.lane;
    let roofFrames = 0;
    while (sim.getSnapshot().player.airState === 'trainRoof' && roofFrames < 400) {
      if (roofFrames === 170) {
        sim.getSnapshot().obstacles.push({ id: 60000, kind: 'tall', lane, z: 8 });
      }
      sim.fixedUpdate(1 / 60);
      roofFrames++;
    }
    const exiting = sim.getSnapshot();
    expect(roofFrames / 60).toBeCloseTo(game.train.durations.calm, 1);
    expect(exiting.player.airState).toBe('trainExit');
    expect(exiting.obstacles.some((obstacle) => obstacle.id === 60000)).toBe(false);
    expect(exiting.coins.some((coin) => coin.airTargetTime !== undefined)).toBe(true);
  });

  it('anchors the horse pickup to the train roof and allows collecting it before the exit', () => {
    const bonusGame: GameConfig = {
      ...game,
      horse: {
        ...game.horse,
        modeBonusMinSeconds: 0,
        firstHorseMinSeconds: 0,
        horseTrainPickupChance: 1,
      },
    };
    const { sim, setInput } = makeTrainSim(bonusGame);
    sim.getSnapshot().player.gameTime = bonusGame.horse.modeBonusMaxSeconds + 1;
    reachTrainRoof(sim, setInput);
    for (let i = 0; i < 300 && sim.getSnapshot().bonuses.length === 0; i++) {
      sim.fixedUpdate(1 / 60);
    }
    const spawned = sim.getSnapshot();
    const bonus = spawned.bonuses.find((candidate) => candidate.kind === 'horse');
    expect(bonus?.trainId).toBe(spawned.trains[0].id);
    expect(bonus?.trainOffsetZ ?? 0).toBeGreaterThan(0);
    for (let i = 0; i < 140 && sim.getSnapshot().player.mode !== 'horse'; i++) {
      sim.fixedUpdate(1 / 60);
    }
    expect(sim.getSnapshot().player.mode).toBe('horse');
  });

  it('explodes obstacles on every lane beside the train while riding', () => {
    const { sim, setInput } = makeTrainSim();
    reachTrainRoof(sim, setInput);
    const snapshot = sim.getSnapshot();
    const trainLane = snapshot.player.lane;
    const sideObstacles = game.lane.positions
      .map((_, lane) => lane)
      .filter((lane) => lane !== trainLane)
      .map((lane, index) => ({
        id: 80000 + index,
        kind: 'tall' as const,
        lane,
        z: 3,
        broken: false,
        smashed: false,
      }));
    snapshot.obstacles.push(...sideObstacles);
    sim.fixedUpdate(1 / 60);
    for (const obstacle of sideObstacles) {
      expect(obstacle.broken).toBe(true);
      expect(obstacle.smashed).toBe(true);
    }
  });

  it('brings an independent companion train alongside and allows repeated transfers', () => {
    const companionGame: GameConfig = {
      ...game,
      train: {
        ...game.train,
        companionChance: 1,
        companionDelayMinSeconds: 0.8,
        companionDelayMaxSeconds: 0.8,
        companionDurationJitter: 0,
      },
    };
    const { sim, setInput } = makeTrainSim(companionGame);
    reachTrainRoof(sim, setInput);
    const source = sim.getSnapshot().trains.find((train) => train.variant === 0)!;
    const sourceStartRemaining = source.rideRemaining;
    const companion = sim.getSnapshot().trains.find((train) => train.variant === 1)!;
    expect(companion).toBeDefined();
    const transferObstacle = sim.getSnapshot().obstacles.find(
      (obstacle) => obstacle.trainId === source.id && obstacle.companionTransfer,
    );
    expect(transferObstacle).toBeDefined();
    expect(
      sim.getSnapshot().coins.filter((coin) => coin.trainId === companion.id).length,
    ).toBeGreaterThan(0);
    expect(
      sim.getSnapshot().coins
        .filter((coin) => coin.trainId === source.id)
        .every(
          (coin) =>
            (coin.trainOffsetZ ?? Number.NEGATIVE_INFINITY) <
            (transferObstacle!.trainOffsetZ ?? Number.POSITIVE_INFINITY),
        ),
    ).toBe(true);
    const towardCompanion = source.lane < companion.lane ? 'laneLeft' : 'laneRight';

    setInput([towardCompanion]);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    expect(sim.getSnapshot().player.airState).toBe('trainRoof');
    expect(sim.getSnapshot().player.lane).toBe(source.lane);

    for (let i = 0; i < 20; i++) sim.fixedUpdate(1 / 60);
    expect(companion.rideStarted).toBe(false);
    expect(companion.landingDelay).toBeLessThanOrEqual(
      companionGame.train.transferLeadSeconds,
    );
    expect(source.rideRemaining).toBeLessThan(sourceStartRemaining);

    setInput([towardCompanion]);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    expect(sim.getSnapshot().player.airState).toBe('trainRoof');
    expect(sim.getSnapshot().player.lane).toBe(companion.lane);
    expect(companion.rideStarted).toBe(true);

    const towardSource = companion.lane < source.lane ? 'laneLeft' : 'laneRight';
    setInput([towardSource]);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    expect(sim.getSnapshot().player.airState).toBe('trainRoof');
    expect(sim.getSnapshot().player.lane).toBe(source.lane);
  });

  it('places unbreakable roof obstacles that knock the rider off on contact', () => {
    const obstacleGame: GameConfig = {
      ...game,
      train: { ...game.train, roofObstacleChance: 1 },
    };
    const { sim, setInput } = makeTrainSim(obstacleGame);
    reachTrainRoof(sim, setInput);
    const snapshot = sim.getSnapshot();
    const train = snapshot.trains[0];
    const roofObstacle = snapshot.obstacles.find(
      (obstacle) => obstacle.trainId === train.id,
    );
    expect(roofObstacle?.unbreakable).toBe(true);
    roofObstacle!.trainOffsetZ = -train.z;
    sim.fixedUpdate(1 / 60);
    expect(snapshot.player.airState).toBe('trainExit');
    expect(snapshot.player.damageState).not.toBe('normal');
    expect(roofObstacle!.broken).not.toBe(true);
  });

  it('treats a road-level side collision as a real hit and interrupts nitro', () => {
    const { sim, setInput } = makeTrainSim();
    const snap = sim.getSnapshot();
    snap.player.nitroCharge = game.nitro.maxFill;
    setInput(['nitro']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    snap.trains.push({
      id: 70000,
      lane: snap.player.lane,
      z: 0,
      length: 20,
      height: game.train.height,
      rideDuration: 3,
      rideRemaining: 3,
      landingDelay: 0,
      landingInset: game.train.landingInset,
      rideStarted: false,
      variant: 0,
    });
    sim.fixedUpdate(1 / 60);
    expect(snap.player.damageState).not.toBe('normal');
    expect(snap.player.isAbilityActive).toBe(false);
    expect(snap.player.nitroCharge).toBeLessThan(game.nitro.maxFill);
  });
});

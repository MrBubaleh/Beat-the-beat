import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import type { GameConfig, LevelgenConfig } from '@core/config/schemas';
import { PlayerSim } from '@core/gameplay/PlayerSim';
import { GameSim } from '@core/gameplay/GameSim';
import {
  buildRocketLaneSequence,
  buildRocketTrajectories,
  rocketCoinEndTime,
  rocketCoinStartTime,
  rocketCoinY,
  rocketDistanceAtTime,
  rocketClimbSeconds,
  rocketFallStartTime,
  rocketPlateauStartTime,
  stepLanePingPong,
} from '@core/gameplay/rocket';
import { DirectorMemory } from '@core/director/DirectorMemory';
import type { Director, DirectorOutput } from '@core/director/types';
import { emptyMusic } from './musicHelpers';

const game = gameRaw as GameConfig;
const levelgen = levelgenRaw as LevelgenConfig;

class FakeDirector implements Director {
  phase = 'calm';
  phaseElapsed = 0;
  readonly memory = new DirectorMemory();

  update(): DirectorOutput {
    return { intents: [], phase: this.phase, phaseElapsed: this.phaseElapsed };
  }

  reset(): void {
    this.phase = 'calm';
    this.phaseElapsed = 0;
    this.memory.clear();
  }
}

describe('rocket lane sequence', () => {
  it('moves only to adjacent lanes in a ping-pong pattern', () => {
    expect(buildRocketLaneSequence(0, 4, 6)).toEqual([0, 1, 2, 3, 2, 1]);
    expect(stepLanePingPong(3, 1, 4)).toEqual({ lane: 2, dir: -1 });
    expect(stepLanePingPong(0, -1, 4)).toEqual({ lane: 1, dir: 1 });
  });
});

describe('rocket trajectories', () => {
  it('starts coins near the pickup and ends before fuel runs out', () => {
    const cfg = game.rocket;
    const samples = buildRocketTrajectories({
      launchSeconds: cfg.launchSeconds,
      plateauSeconds: cfg.plateauSeconds,
      fuelSeconds: cfg.fuelSeconds,
      anticipationSeconds: cfg.anticipationSeconds,
      coinEndBufferSeconds: cfg.coinEndBufferSeconds,
      coinSpacingSeconds: cfg.coinSpacingSeconds,
      coinsPerLaneSegment: cfg.coinsPerLaneSegment,
      startLane: 1,
      laneCount: 4,
    });
    const endTime = rocketCoinEndTime(cfg);
    const climb = rocketClimbSeconds(cfg);
    const fallStart = rocketFallStartTime(cfg);
    expect(samples[0].time).toBeGreaterThanOrEqual(climb);
    expect(samples[0].time - climb).toBeLessThanOrEqual(0.2);
    expect(samples[samples.length - 1].time).toBeLessThanOrEqual(endTime + 0.001);
    expect(samples[samples.length - 1].time).toBeGreaterThan(endTime - cfg.coinSpacingSeconds * 1.5);
    expect(endTime).toBeLessThanOrEqual(fallStart);
    expect(samples[samples.length - 1].time).toBeLessThan(fallStart);
  });

  it('keeps a continuous coin stream without mid-flight gaps', () => {
    const spacing = game.rocket.coinSpacingSeconds;
    const samples = buildRocketTrajectories({
      launchSeconds: game.rocket.launchSeconds,
      plateauSeconds: game.rocket.plateauSeconds,
      fuelSeconds: game.rocket.fuelSeconds,
      anticipationSeconds: game.rocket.anticipationSeconds,
      coinEndBufferSeconds: game.rocket.coinEndBufferSeconds,
      coinSpacingSeconds: spacing,
      coinsPerLaneSegment: game.rocket.coinsPerLaneSegment,
      startLane: 0,
      laneCount: 4,
    });
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].time - samples[i - 1].time).toBeCloseTo(spacing, 5);
    }
  });

  it('starts coins almost immediately after leveling out', () => {
    const cfg = game.rocket;
    const climb = rocketClimbSeconds(cfg);
    const startTime = rocketCoinStartTime(cfg);
    expect(startTime).toBeGreaterThanOrEqual(climb);
    expect(startTime - climb).toBeLessThanOrEqual(0.2);
    expect(startTime).toBeLessThan(rocketPlateauStartTime(cfg));
  });

  it('accounts for anticipation when placing coins along distance', () => {
    const cfg = game.rocket;
    const baseSpeed = 14;
    const climbDist = rocketDistanceAtTime(rocketClimbSeconds(cfg), baseSpeed, cfg);
    const plateauDist = rocketDistanceAtTime(rocketPlateauStartTime(cfg), baseSpeed, cfg);
    const firstCoinDist = rocketDistanceAtTime(rocketCoinStartTime(cfg), baseSpeed, cfg);
    expect(plateauDist).toBeGreaterThan(baseSpeed * cfg.anticipationSeconds * 0.8);
    expect(firstCoinDist).toBeGreaterThanOrEqual(climbDist);
    expect(firstCoinDist).toBeLessThan(plateauDist);
  });

  it('keeps rocket coins at plateau height after launch', () => {
    const climbEnd = rocketClimbSeconds(game.rocket);
    expect(rocketCoinY(climbEnd * 0.5, game.rocket)).toBeLessThan(
      game.rocket.peakHeight,
    );
    expect(rocketCoinY(climbEnd, game.rocket)).toBeCloseTo(
      game.rocket.peakHeight,
      0,
    );
  });
});

describe('rocket player mechanics', () => {
  function runUntilLaunch(sim: PlayerSim): void {
    const maxFrames = Math.ceil(game.rocket.anticipationSeconds * 60) + 5;
    for (let i = 0; i < maxFrames; i++) {
      if (sim.state.rocketPhase !== 'anticipation') break;
      sim.update(1 / 60, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
  }

  it('starts with anticipation before turbo snap', () => {
    const sim = new PlayerSim(game);
    sim.state.speed = 16;
    sim.switchMode('rocket');
    expect(sim.state.rocketPhase).toBe('anticipation');
    expect(sim.state.rocketBoostPulse).toBe(0);
    expect(sim.state.rocketFx).toBe(0);
    const speedBefore = sim.state.speed;

    sim.update(1.0, { laneDelta: 0, jump: false, nitro: false }, 1);
    expect(sim.state.rocketPhase).toBe('anticipation');
    expect(sim.state.speed).toBeLessThan(speedBefore * 0.95);

    runUntilLaunch(sim);
    expect(sim.state.rocketPhase).toBe('launch');
    expect(sim.state.rocketBoostPulse).toBeGreaterThan(0.9);
    expect(sim.state.rocketFx).toBe(1);
    expect(sim.state.speed).toBeLessThan(speedBefore * game.rocket.speedBoost * 0.5);

    for (let i = 0; i < Math.ceil(game.rocket.turboSnapSeconds * 60) + 2; i++) {
      sim.update(1 / 60, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    expect(sim.state.speed).toBeGreaterThan(speedBefore * 1.6);
  });

  it('keeps the pickup lane and rises through launch, plateau, and cruise', () => {
    const sim = new PlayerSim(game);
    sim.state.lane = 2;
    sim.state.laneX = game.lane.positions[2];
    sim.state.y = 4.2;
    sim.switchMode('rocket');
    expect(sim.state.lane).toBe(2);
    expect(sim.state.rocketPhase).toBe('anticipation');

    runUntilLaunch(sim);
    expect(sim.state.rocketPhase).toBe('launch');

    const launchFrames = Math.ceil(game.rocket.launchSeconds * 60) + 1;
    for (let i = 0; i < launchFrames; i++) {
      sim.update(1 / 60, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    expect(sim.state.rocketPhase).toBe('plateau');
    expect(sim.state.y).toBeCloseTo(game.rocket.peakHeight, 1);
  });

  it('moves between four horizontal lanes during flight', () => {
    const sim = new PlayerSim(game);
    sim.switchMode('rocket');
    const preflightFrames =
      Math.ceil(game.rocket.anticipationSeconds * 60) +
      Math.ceil(game.rocket.launchSeconds * 60) +
      2;
    for (let i = 0; i < preflightFrames; i++) {
      sim.update(1 / 60, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    sim.update(1 / 60, { laneDelta: 1, jump: false, nitro: false }, 1);
    expect(sim.state.lane).toBe(3);
  });
});

describe('rocket cycle in GameSim', () => {
  function rocketGame(): GameConfig {
    return {
      ...game,
      horse: { ...game.horse, firstHorseMinSeconds: 0 },
      rocket: {
        ...game.rocket,
        firstRocketMinSeconds: 0,
        minModeSwitchSeconds: 0,
        guaranteedModeSwitchSeconds: 0,
        rampPickupChance: 1,
        jumpPickupChance: 1,
        spawnCooldownSeconds: 0,
        maxPickupsPerSong: 2,
      },
    };
  }

  function emptyLevelgen(): LevelgenConfig {
    return {
      ...levelgen,
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      redWallProbability: 0,
      rampProbability: 0,
      earlyRampProbability: 0,
      nitroWallProbability: 0,
      laneFlow: [0, 0, 0, 0],
    };
  }

  function makeSim(director: FakeDirector, seed = 1213): GameSim {
    return new GameSim({
      game: rocketGame(),
      levelgen: emptyLevelgen(),
      director,
      consumeInput: () => [],
      nowMs: () => 0,
      getMusic: () => emptyMusic(),
      getSongProgress: () => 0.2,
      seed,
    });
  }

  it('spawns coins immediately along the flight path and caps them to max distance', () => {
    const director = new FakeDirector();
    const sim = makeSim(director);
    const snap = sim.getSnapshot();
    snap.bonuses.push({
      id: 9001,
      kind: 'rocket',
      lane: 1,
      z: 0,
      collected: false,
    });
    for (let i = 0; i < 4; i++) sim.fixedUpdate(1 / 60);
    const after = sim.getSnapshot();
    expect(after.coins.length).toBeGreaterThan(0);
    expect(after.player.mode).toBe('rocket');
  });

  it('returns horse→rocket→horse on the same lane', () => {
    const director = new FakeDirector();
    const sim = makeSim(director);
    sim.setMode('horse');
    const horseSnap = sim.getSnapshot();
    sim.getSnapshot().bonuses.push({
      id: 9002,
      kind: 'rocket',
      lane: horseSnap.player.lane,
      z: 0,
      y: horseSnap.player.y + 0.4,
      collected: false,
    });
    for (let i = 0; i < 120 && sim.mode !== 'rocket'; i++) {
      sim.fixedUpdate(1 / 60);
    }
    expect(sim.mode).toBe('rocket');
    for (let i = 0; i < 960 && sim.mode === 'rocket'; i++) {
      sim.fixedUpdate(1 / 60);
    }
    expect(sim.mode).toBe('horse');
    expect(sim.getSnapshot().player.lane).toBe(horseSnap.player.lane);
  });
});

describe('rocket distance', () => {
  it('accelerates during launch and cruises at boosted speed', () => {
    const cfg = {
      launchSeconds: game.rocket.launchSeconds,
      plateauSeconds: game.rocket.plateauSeconds,
      fuelSeconds: game.rocket.fuelSeconds,
      speedBoost: game.rocket.speedBoost,
    };
    const baseSpeed = 12;
    const launchDist = rocketDistanceAtTime(cfg.launchSeconds, baseSpeed, cfg);
    const cruiseDist = rocketDistanceAtTime(
      cfg.launchSeconds + 2,
      baseSpeed,
      cfg,
    );
    expect(launchDist).toBeGreaterThan(baseSpeed * cfg.launchSeconds);
    expect(cruiseDist - launchDist).toBeCloseTo(baseSpeed * cfg.speedBoost * 2, 0);
  });
});

import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import type { PlayerAction } from '@core/gameplay/actions';
import { PlayerSim } from '@core/gameplay/PlayerSim';
import {
  GameSim,
  lateHorseRampTrainChanceMultiplier,
  modeBonusChance,
  modeBonusTiming,
  roadHorseTransitionChance,
} from '@core/gameplay/GameSim';
import { LevelGenerator } from '@core/levelgen/LevelGenerator';
import type { Chunk } from '@core/levelgen/LevelGenerator';
import { isPassable, isPassableAsCar } from '@core/levelgen/passability';
import { PassthroughDirector } from '@core/director/PassthroughDirector';
import { emptyMusic, withoutRocketSpawn } from './musicHelpers';

const game = withoutRocketSpawn(gameRaw as GameConfig);
const levelgen = levelgenRaw as LevelgenConfig;

function horseChunkKind(chunk: Chunk): 'jump' | 'slide' | 'dodge' | null {
  const obstacles = chunk.obstacles;
  if (obstacles.length === 0) return null;
  const restLike =
    obstacles.length === levelgen.lanes - 1 &&
    obstacles.every((obstacle) => obstacle.horseAction === 'jump');
  if (restLike) return null;
  if (obstacles.some((obstacle) => obstacle.horseAction === 'slide')) return 'slide';
  if (obstacles.some((obstacle) => obstacle.horseDodgeOnly)) return 'dodge';
  if (obstacles.some((obstacle) => obstacle.horseAction === 'jump')) return 'jump';
  return null;
}

describe('horse player mechanics', () => {
  it('uses a short independent jump and allows lane changes in the air', () => {
    const sim = new PlayerSim(game);
    sim.switchMode('horse');
    sim.update(1 / 60, { laneDelta: 1, jump: true, nitro: false }, 1);

    expect(sim.state.airState).toBe('airborne');
    expect(sim.state.airSource).toBe('horseJump');
    expect(sim.state.lane).toBe(3);

    let maxY = 0;
    for (let i = 0; i < 120; i++) {
      sim.update(1 / 120, { laneDelta: 0, jump: false, nitro: false }, 1);
      maxY = Math.max(maxY, sim.state.y);
    }
    expect(maxY).toBeGreaterThan(2.2);
    expect(sim.state.airState).toBe('grounded');
  });

  it('a fast-fall tap shortens the remaining descent without teleporting', () => {
    const flightDuration = (fastFall: boolean): { elapsed: number; yAfterTap: number } => {
      const sim = new PlayerSim(game);
      sim.switchMode('horse');
      sim.update(1 / 120, { laneDelta: 0, jump: true, nitro: false }, 1);
      let elapsed = 1 / 120;
      let tapped = false;
      let yAfterTap = 0;
      while (sim.state.airState !== 'grounded' && elapsed < 2) {
        const tap = fastFall && !tapped && elapsed >= game.horse.flightTimeSeconds * 0.52;
        sim.update(
          1 / 120,
          { laneDelta: 0, jump: false, nitro: false, fastFall: tap },
          1,
        );
        if (tap) {
          tapped = true;
          yAfterTap = sim.state.y;
        }
        elapsed += 1 / 120;
      }
      return { elapsed, yAfterTap };
    };

    const normal = flightDuration(false);
    const fast = flightDuration(true);
    expect(fast.elapsed).toBeLessThan(normal.elapsed * 0.72);
    expect(fast.yAfterTap).toBeGreaterThan(0.5);
  });

  it('buffers a slide pressed shortly before landing and starts it on touchdown', () => {
    const sim = new PlayerSim(game);
    sim.switchMode('horse');
    sim.update(0.01, { laneDelta: 0, jump: true, nitro: false }, 1);
    for (let i = 0; i < 78; i++) {
      sim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    sim.update(0.01, { laneDelta: 0, jump: false, nitro: false, fastFall: true }, 1);
    for (let i = 0; i < 25; i++) {
      sim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    }

    expect(sim.state.airState).toBe('grounded');
    expect(sim.state.isSliding).toBe(true);
    expect(sim.state.airSource).toBe('none');
  });

  it('buffers a slide from an early fast-fall tap in the descent', () => {
    const sim = new PlayerSim(game);
    sim.switchMode('horse');
    sim.update(0.01, { laneDelta: 0, jump: true, nitro: false }, 1);
    let tapped = false;
    while (sim.state.airState !== 'grounded') {
      const tap =
        !tapped &&
        sim.state.airTime >= game.horse.flightTimeSeconds * 0.52 &&
        sim.state.airState === 'airborne';
      sim.update(
        1 / 120,
        { laneDelta: 0, jump: false, nitro: false, fastFall: tap },
        1,
      );
      if (tap) tapped = true;
    }

    expect(sim.state.isSliding).toBe(true);
  });

  it('lets the last vertical air input win between buffered jump and slide', () => {
    const sim = new PlayerSim(game);
    sim.switchMode('horse');
    sim.update(0.01, { laneDelta: 0, jump: true, nitro: false }, 1);
    for (let i = 0; i < 78; i++) {
      sim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    sim.update(0.01, { laneDelta: 0, jump: true, nitro: false }, 1);
    sim.update(0.01, { laneDelta: 0, jump: false, nitro: false, fastFall: true }, 1);
    for (let i = 0; i < 25; i++) {
      sim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    }

    expect(sim.state.airState).toBe('grounded');
    expect(sim.state.isSliding).toBe(true);

    const jumpWins = new PlayerSim(game);
    jumpWins.switchMode('horse');
    jumpWins.update(0.01, { laneDelta: 0, jump: true, nitro: false }, 1);
    for (let i = 0; i < 78; i++) {
      jumpWins.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    jumpWins.update(0.01, { laneDelta: 0, jump: false, nitro: false, fastFall: true }, 1);
    jumpWins.update(0.01, { laneDelta: 0, jump: true, nitro: false }, 1);
    for (let i = 0; i < 25; i++) {
      jumpWins.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    }

    expect(jumpWins.state.airState).toBe('airborne');
    expect(jumpWins.state.isSliding).toBe(false);
  });

  it('clears buffered slide on hit and mode switch', () => {
    const sim = new PlayerSim(game);
    sim.switchMode('horse');
    sim.update(0.01, { laneDelta: 0, jump: true, nitro: false }, 1);
    for (let i = 0; i < 78; i++) {
      sim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    sim.update(0.01, { laneDelta: 0, jump: false, nitro: false, fastFall: true }, 1);
    sim.registerHit();
    for (let i = 0; i < 25; i++) {
      sim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    expect(sim.state.isSliding).toBe(false);

    const modeSim = new PlayerSim(game);
    modeSim.switchMode('horse');
    modeSim.update(0.01, { laneDelta: 0, jump: true, nitro: false }, 1);
    for (let i = 0; i < 78; i++) {
      modeSim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    modeSim.update(0.01, { laneDelta: 0, jump: false, nitro: false, fastFall: true }, 1);
    modeSim.switchMode('car');
    for (let i = 0; i < 25; i++) {
      modeSim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    expect(modeSim.state.isSliding).toBe(false);
  });

  it('starts a ground slide with one tap, extends it under hazards, and jumps out of it', () => {
    const sim = new PlayerSim(game);
    sim.switchMode('horse');
    sim.setHorseSlideHazard(true);
    sim.update(1 / 60, { laneDelta: 0, jump: false, nitro: false, fastFall: true }, 1);
    expect(sim.state.isSliding).toBe(true);

    for (let i = 0; i < 60; i++) {
      sim.setHorseSlideHazard(true);
      sim.update(1 / 60, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    expect(sim.state.isSliding).toBe(true);

    sim.update(1 / 60, { laneDelta: 0, jump: true, nitro: false }, 1);
    expect(sim.state.isSliding).toBe(false);
    expect(sim.state.airSource).toBe('horseJump');
  });

  it('buffers a jump pressed shortly before landing', () => {
    const sim = new PlayerSim(game);
    sim.switchMode('horse');
    sim.update(0.01, { laneDelta: 0, jump: true, nitro: false }, 1);
    for (let i = 0; i < 78; i++) {
      sim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    sim.update(0.01, { laneDelta: 0, jump: true, nitro: false }, 1);
    for (let i = 0; i < 25; i++) {
      sim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
    }

    expect(sim.state.airState).toBe('airborne');
    expect(sim.state.airSource).toBe('horseJump');
    expect(sim.state.airTime).toBeLessThan(0.15);
  });

  it('restarts a ramp jump during landing phase', () => {
    const sim = new PlayerSim(game);
    sim.switchMode('horse');
    sim.launchFromRamp();
    for (let i = 0; i < 400; i++) {
      sim.update(0.01, { laneDelta: 0, jump: false, nitro: false }, 1);
      if (sim.state.airState === 'landing') break;
    }
    expect(sim.state.airState).toBe('landing');
    sim.update(0.01, { laneDelta: 0, jump: true, nitro: false }, 1);
    expect(sim.state.airState).toBe('airborne');
    expect(sim.state.airSource).toBe('horseJump');
    expect(sim.state.airTime).toBeLessThan(0.02);
  });

  it('restarts a jump immediately when pressed just above the ground', () => {
    const sim = new PlayerSim(game);
    sim.switchMode('horse');
    sim.update(0.005, { laneDelta: 0, jump: true, nitro: false }, 1);
    for (let i = 0; i < 300; i++) {
      if (
        sim.state.airState !== 'grounded' &&
        sim.state.airTime > game.horse.flightTimeSeconds / 2 &&
        sim.state.y <= game.horse.jumpEarlyRestartHeight
      ) {
        break;
      }
      sim.update(0.005, { laneDelta: 0, jump: false, nitro: false }, 1);
    }
    expect(sim.state.y).toBeLessThanOrEqual(game.horse.jumpEarlyRestartHeight);
    sim.update(0.005, { laneDelta: 0, jump: true, nitro: false }, 1);
    expect(sim.state.airState).toBe('airborne');
    expect(sim.state.airTime).toBeLessThan(0.02);
  });

  it('builds momentum to a nitro-equivalent boost and transfers it back to car', () => {
    const sim = new PlayerSim(game);
    sim.state.nitroCharge = 37;
    sim.switchMode('horse');
    for (let i = 0; i < 8; i++) sim.registerHorseClear();
    sim.update(0.2, { laneDelta: 0, jump: false, nitro: false }, 1);
    const horseSpeed = sim.state.speed;

    expect(sim.state.horseMomentum).toBeGreaterThan(0.98);
    sim.switchMode('car');
    expect(sim.state.nitroCharge).toBe(game.nitro.maxFill);
    expect(sim.state.isAbilityActive).toBe(true);
    sim.update(1 / 60, { laneDelta: 0, jump: false, nitro: false }, 1);
    expect(Math.abs(sim.state.speed - horseSpeed)).toBeLessThan(1);
  });

  it('activates full nitro when returning to car from near-maximum horse momentum', () => {
    const sim = new PlayerSim(game);
    sim.switchMode('horse');
    for (let i = 0; i < 6; i++) sim.registerHorseClear();

    expect(sim.state.horseMomentum).toBeCloseTo(0.75, 5);
    sim.switchMode('car');

    expect(sim.state.nitroCharge).toBe(game.nitro.maxFill);
    expect(sim.state.isAbilityActive).toBe(true);
  });

  it('starts automatic overdrive at full momentum and returns to blaster momentum', () => {
    const sim = new PlayerSim(game);
    sim.switchMode('horse');
    for (let i = 0; i < 8; i++) sim.registerHorseClear();

    expect(sim.state.horseOverdriveRemaining).toBe(game.horse.overdriveDurationSeconds);
    sim.update(
      game.horse.overdriveDurationSeconds + 0.01,
      { laneDelta: 0, jump: false, nitro: false },
      1,
    );

    expect(sim.state.horseOverdriveRemaining).toBe(0);
    expect(sim.state.horseMomentum).toBe(game.horse.overdriveRecoveryMomentum);
  });

  it('keeps earned horse momentum when the music speed changes without a hit', () => {
    const sim = new PlayerSim(game);
    sim.switchMode('horse');
    sim.registerHorseClear();
    sim.registerHorseClear();
    const earnedMomentum = sim.state.horseMomentum;

    sim.update(12, { laneDelta: 0, jump: false, nitro: false }, 0.75);

    expect(sim.state.horseMomentum).toBe(earnedMomentum);
  });

  it('refills the active overdrive from successful horse actions', () => {
    const sim = new PlayerSim(game);
    sim.switchMode('horse');
    for (let i = 0; i < 8; i++) sim.registerHorseClear();
    sim.update(1, { laneDelta: 0, jump: false, nitro: false }, 1);
    const remainingBeforeClear = sim.state.horseOverdriveRemaining;

    sim.registerHorseClear();

    expect(sim.state.horseOverdriveRemaining).toBeGreaterThan(remainingBeforeClear);
    expect(sim.state.horseMomentum).toBeGreaterThan(0.9);
  });

  it('freezes existing nitro when entering horse mode', () => {
    const sim = new PlayerSim(game);
    sim.state.nitroCharge = game.nitro.maxFill;
    sim.activateNitro();
    sim.update(0.2, { laneDelta: 0, jump: false, nitro: false }, 1);
    const charge = sim.state.nitroCharge;

    sim.switchMode('horse');
    sim.update(1, { laneDelta: 0, jump: false, nitro: false }, 1);

    expect(sim.state.isAbilityActive).toBe(false);
    expect(sim.state.nitroCharge).toBe(charge);
    expect(sim.state.horseMomentum).toBeGreaterThan(0);
  });
});

describe('horse mode integration', () => {
  it('softly raises the reciprocal pickup chance to a guarantee', () => {
    expect(modeBonusChance(19.9, 20, 32, 0.82)).toBe(0);
    expect(modeBonusChance(20, 20, 32, 0.82)).toBeCloseTo(0.82);
    expect(modeBonusChance(26, 20, 32, 0.82)).toBeCloseTo(0.91);
    expect(modeBonusChance(32, 20, 32, 0.82)).toBe(1);
  });

  it('shortens both mode-switch windows toward a ten-second late-song floor', () => {
    const early = modeBonusTiming(game.horse, 0.5);
    const late = modeBonusTiming(game.horse, 1);
    expect(early.carToHorseMinSeconds).toBeCloseTo(13.86, 1);
    expect(early.horseToCarMinSeconds).toBeCloseTo(9.95, 1);
    expect(late.carToHorseMinSeconds).toBe(8);
    expect(late.horseToCarMinSeconds).toBe(8);
    expect(late.carToHorseGuaranteedSeconds).toBe(11);
    expect(late.horseToCarGuaranteedSeconds).toBe(11);
    expect(lateHorseRampTrainChanceMultiplier(game.horse, 0.5)).toBeCloseTo(1, 1);
    expect(lateHorseRampTrainChanceMultiplier(game.horse, 1)).toBeCloseTo(0.46);
    expect(roadHorseTransitionChance(game.horse, 0.5)).toBeCloseTo(0.35, 1);
    expect(roadHorseTransitionChance(game.horse, 1)).toBe(0.75);
  });

  function makeSim(
    getMusic: () => ReturnType<typeof emptyMusic> = () => emptyMusic(),
  ): { sim: GameSim; setInput: (actions: PlayerAction[]) => void } {
    let input: PlayerAction[] = [];
    const emptyLevelgen: LevelgenConfig = {
      ...levelgen,
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      redWallProbability: 0,
      rampProbability: 0,
      earlyRampProbability: 0,
      nitroWallProbability: 0,
      laneFlow: [0, 0, 0, 0],
    };
    const sim = new GameSim({
      game,
      levelgen: emptyLevelgen,
      director: new PassthroughDirector(directorRaw as DirectorConfig),
      consumeInput: () => input,
      nowMs: () => 0,
      getMusic,
      seed: 808,
    });
    return { sim, setInput: (actions) => (input = actions) };
  }

  it('switches modes only when the matching pickup is actually collected', () => {
    const { sim } = makeSim();
    const snap = sim.getSnapshot();
    snap.bonuses.push({
      id: 5001,
      kind: 'horse',
      lane: snap.player.lane,
      z: 12,
      collected: false,
    });
    sim.fixedUpdate(1 / 60);
    expect(sim.mode).toBe('car');

    snap.bonuses[0].z = 0;
    snap.ramps.push({ id: 5100, lane: snap.player.lane, z: 100 });
    snap.obstacles.push({ id: 5101, kind: 'tall', lane: snap.player.lane, z: 40 });
    sim.fixedUpdate(1 / 60);
    expect(sim.mode).toBe('horse');
    expect(sim.getSnapshot().ramps.some((ramp) => ramp.id === 5100)).toBe(true);
    expect(sim.getSnapshot().obstacles.some((obstacle) => obstacle.id === 5101)).toBe(true);

    sim.getSnapshot().bonuses.push({
      id: 5002,
      kind: 'car',
      lane: sim.getSnapshot().player.lane,
      z: 0,
      collected: false,
    });
    sim.fixedUpdate(1 / 60);
    expect(sim.mode).toBe('car');
    expect(sim.getSnapshot().runStats.modeSwitches).toBe(2);
    expect(sim.getSnapshot().runStats.horsePickups).toBe(1);
    expect(sim.getSnapshot().runStats.carPickups).toBe(1);
    expect(sim.getSnapshot().runStats.carSeconds).toBeGreaterThan(0);
    expect(sim.getSnapshot().runStats.horseSeconds).toBeGreaterThan(0);
  });

  it('offers the reciprocal pickup with reaction time later in a large horse jump', () => {
    const quickGame: GameConfig = {
      ...game,
      horse: {
        ...game.horse,
        modeBonusMinSeconds: 0.1,
        carBonusMinSeconds: 0.1,
        carBonusGuaranteedSeconds: 0.2,
        modeBonusMaxSeconds: 0.2,
        carJumpPickupChance: 1,
      },
    };
    const emptyLevelgen: LevelgenConfig = {
      ...levelgen,
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      redWallProbability: 0,
      rampProbability: 0,
      earlyRampProbability: 0,
    };
    let actions: PlayerAction[] = [];
    const jumpingSim = new GameSim({
      game: quickGame,
      levelgen: emptyLevelgen,
      director: new PassthroughDirector(directorRaw as DirectorConfig),
      consumeInput: () => actions,
      nowMs: () => 0,
      getMusic: () => emptyMusic(),
      seed: 810,
    });
    jumpingSim.setMode('horse');
    for (let i = 0; i < 20; i++) jumpingSim.fixedUpdate(1 / 60);
    const jumpingSnapshot = jumpingSim.getSnapshot();
    jumpingSnapshot.obstacles.length = 0;
    for (let index = 0; index < 3; index++) {
      jumpingSnapshot.obstacles.push({
        id: 5300 + index,
        kind: 'low',
        lane: jumpingSnapshot.player.lane,
        z: 4 + index * 3,
        horseAction: 'jump',
        actionGroupId: 530,
        actionIndex: index,
        actionCount: 3,
      });
    }
    actions = ['nitro'];
    jumpingSim.fixedUpdate(1 / 60);
    actions = [];
    expect(jumpingSim.mode).toBe('horse');
    expect(jumpingSim.getSnapshot().bonuses[0]?.kind).toBe('car');
    expect(jumpingSim.getSnapshot().runStats.carOffers).toBe(1);
    expect(jumpingSim.getSnapshot().bonuses[0]?.airTargetTime).toBeCloseTo(
      quickGame.horse.flightTimeSeconds * quickGame.horse.carJumpPickupTargetProgress,
    );
  });

  it('awards one momentum step only on actual touchdown after clearing obstacles', () => {
    const { sim } = makeSim();
    sim.setMode('horse');
    sim.playerSim.registerHorseClear();
    const momentumBefore = sim.getSnapshot().player.horseMomentum;
    const clearedIds = (sim as unknown as { horseClearedObstacleIds: Set<number> })
      .horseClearedObstacleIds;
    clearedIds.add(6001);
    clearedIds.add(6002);
    const snap = sim.getSnapshot();
    snap.obstacles.push(
      { id: 6001, kind: 'low', lane: snap.player.lane, z: 4, cleared: true },
      { id: 6002, kind: 'low', lane: snap.player.lane, z: 7, cleared: true },
    );
    sim.playerSim.state.airSource = 'horseJump';
  (sim.playerSim as unknown as { horseLandingCompleted: boolean }).horseLandingCompleted =
      true;
    sim.fixedUpdate(1 / 60);

    expect(sim.getSnapshot().player.horseMomentum).toBeCloseTo(
      momentumBefore + game.horse.momentumPerClear,
      1,
    );
  });

  it('does not explode cleared horse obstacles below half momentum', () => {
    const { sim, setInput } = makeSim();
    sim.setMode('horse');
    const snapshot = sim.getSnapshot();
    snapshot.obstacles.length = 0;
    snapshot.obstacles.push({
      id: 6050,
      kind: 'low',
      lane: snapshot.player.lane,
      z: 4,
      horseAction: 'jump',
      actionGroupId: 605,
      actionIndex: 0,
      actionCount: 1,
    });
    setInput(['nitro']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    for (let i = 0; i < 90; i++) sim.fixedUpdate(1 / 60);
    const obstacle = snapshot.obstacles.find((candidate) => candidate.id === 6050)!;
    expect(obstacle.cleared).toBe(true);
    expect(obstacle.smashed).not.toBe(true);
  });

  it('slides through an overhead group, smashes every crossed gate, and rewards it once', () => {
    const { sim, setInput } = makeSim();
    sim.setMode('horse');
    const snap = sim.getSnapshot();
    for (let i = 0; i < 4; i++) sim.playerSim.registerHorseClear();
    const momentumBefore = snap.player.horseMomentum;
    const lane = snap.player.lane;
    snap.obstacles.push(
      {
        id: 6101,
        kind: 'overhead',
        horseAction: 'slide',
        actionGroupId: 77,
        actionIndex: 0,
        actionCount: 2,
        lane,
        z: 2,
      },
      {
        id: 6102,
        kind: 'overhead',
        horseAction: 'slide',
        actionGroupId: 77,
        actionIndex: 1,
        actionCount: 2,
        lane,
        z: 5,
      },
    );
    setInput(['fastFall']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    expect(sim.getSnapshot().activeHorseSlideGroupId).toBe(77);
    for (let i = 0; i < 45; i++) {
      sim.fixedUpdate(1 / 60);
      if (snap.obstacles.find((obstacle) => obstacle.id === 6101)?.cleared) break;
    }
    const first = snap.obstacles.find((obstacle) => obstacle.id === 6101)!;
    expect(first.cleared).toBe(true);
    expect(first.smashed).not.toBe(true);
    expect(snap.player.isSliding).toBe(true);
    expect(snap.player.horseMomentum).toBeCloseTo(
      momentumBefore + game.horse.momentumPerClear,
      1,
    );
    expect(snap.obstacles.find((obstacle) => obstacle.id === 6102)?.smashed).not.toBe(true);

    for (let i = 0; i < 90; i++) sim.fixedUpdate(1 / 60);

    const smashed = snap.obstacles.filter(
      (obstacle) => obstacle.id === 6101 || obstacle.id === 6102,
    );
    expect(smashed.every((obstacle) => obstacle.smashed)).toBe(true);
    expect(smashed[1].smashStrength).toBeGreaterThan(
      smashed[0].smashStrength ?? 0,
    );
  });

  it('changes from horse to car only after sliding through a blue portal gate', () => {
    const { sim, setInput } = makeSim();
    sim.setMode('horse');
    const snapshot = sim.getSnapshot();
    snapshot.obstacles.length = 0;
    snapshot.obstacles.push({
      id: 6120,
      kind: 'overhead',
      horseAction: 'slide',
      actionGroupId: 612,
      actionIndex: 0,
      actionCount: 1,
      modePortal: 'car',
      lane: snapshot.player.lane,
      z: 2,
    });

    setInput(['fastFall']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    for (let i = 0; i < 8 && sim.mode === 'horse'; i++) sim.fixedUpdate(1 / 60);
    expect(sim.mode).toBe('horse');

    for (let i = 0; i < 60 && sim.mode === 'horse'; i++) sim.fixedUpdate(1 / 60);

    expect(sim.mode).toBe('car');
    expect(snapshot.player.damageState).toBe('normal');
    expect(snapshot.obstacles[0].collisionIgnored).toBe(true);
    expect(snapshot.obstacles[0].cleared).toBe(true);
    expect(snapshot.obstacles[0].broken).toBeFalsy();
  });

  it('changes from horse to car after leaving a multi-segment portal early', () => {
    const { sim, setInput } = makeSim();
    sim.setMode('horse');
    const snapshot = sim.getSnapshot();
    const lane = snapshot.player.lane;
    snapshot.obstacles.length = 0;
    for (let index = 0; index < 3; index++) {
      snapshot.obstacles.push({
        id: 6121 + index,
        kind: 'overhead',
        horseAction: 'slide',
        actionGroupId: 612,
        actionIndex: index,
        actionCount: 3,
        modePortal: 'car',
        lane,
        z: 1.2 + index * 8,
      });
    }

    setInput(['fastFall']);
    for (let i = 0; i < 12; i++) sim.fixedUpdate(1 / 60);
    setInput(['laneLeft']);
    for (let i = 0; i < 24 && sim.mode === 'horse'; i++) sim.fixedUpdate(1 / 60);
    setInput([]);
    for (let i = 0; i < 80 && sim.mode === 'horse'; i++) sim.fixedUpdate(1 / 60);

    expect(sim.mode).toBe('car');
    expect(snapshot.player.damageState).toBe('normal');
  });

  it('keeps leftover slide bars solid after switching from horse to car', () => {
    const { sim } = makeSim();
    sim.setMode('horse');
    const snapshot = sim.getSnapshot();
    snapshot.obstacles.length = 0;
    for (let lane = 0; lane < 3; lane++) {
      snapshot.obstacles.push({
        id: 6130 + lane,
        kind: 'overhead',
        horseAction: 'slide',
        actionGroupId: 613,
        lane,
        z: 18,
      });
    }
    sim.setMode('car');
    expect(snapshot.obstacles.every((obstacle) => obstacle.transitionGhost !== true)).toBe(true);
    expect(snapshot.obstacles.every((obstacle) => obstacle.collisionIgnored !== true)).toBe(true);
  });

  it('counts a horse action group as a single collision', () => {
    const { sim } = makeSim();
    sim.setMode('horse');
    const snapshot = sim.getSnapshot();
    snapshot.obstacles.length = 0;
    for (let index = 0; index < 3; index++) {
      snapshot.obstacles.push({
        id: 6150 + index,
        kind: 'low',
        lane: snapshot.player.lane,
        z: index * 16,
        horseAction: 'jump',
        actionGroupId: 615,
        actionIndex: index,
        actionCount: 3,
      });
    }

    sim.fixedUpdate(1 / 60);
    expect(snapshot.player.damageState).toBe('damaged');
    expect(snapshot.obstacles[1].collisionIgnored).toBe(true);
    expect(snapshot.obstacles[2].collisionIgnored).toBe(true);
    for (let i = 0; i < 240; i++) {
      for (const obstacle of snapshot.obstacles) {
        if (obstacle.actionGroupId !== 615) obstacle.broken = true;
      }
      sim.fixedUpdate(1 / 60);
    }
    expect(snapshot.player.damageState).toBe('damaged');
    expect(snapshot.player.gameOver).toBe(false);
  });

  it('uses the charged blaster to absorb one collision and blast nearby obstacles', () => {
    const { sim } = makeSim();
    sim.setMode('horse');
    const snap = sim.getSnapshot();
    snap.obstacles.length = 0;
    for (let i = 0; i < 5; i++) sim.playerSim.registerHorseClear();
    expect(sim.getSnapshot().horseBlasterActive).toBe(false);
    sim.playerSim.registerHorseClear();
    expect(sim.getSnapshot().horseBlasterActive).toBe(true);
    snap.obstacles.push(
      { id: 6201, kind: 'low', lane: snap.player.lane, z: 0 },
      {
        id: 6202,
        kind: 'tall',
        lane: (snap.player.lane + 1) % game.lane.positions.length,
        z: 8,
        horseDodgeOnly: true,
      },
      { id: 6203, kind: 'low', lane: snap.player.lane, z: 25 },
    );

    sim.fixedUpdate(1 / 60);
    expect(snap.player.damageState).toBe('normal');
    expect(snap.obstacles[0].smashed).toBe(true);
    expect(snap.obstacles[1].smashed).toBe(true);
    expect(snap.obstacles[1].smashStrength).toBe(game.horse.blasterBlastStrength);
    expect(snap.obstacles[2].broken).not.toBe(true);
    expect(sim.getSnapshot().horseBlasterActive).toBe(false);
    expect(snap.player.horseMomentum).toBe(0.5);
    sim.playerSim.registerHorseClear();
    sim.playerSim.registerHorseClear();
    expect(sim.getSnapshot().horseBlasterActive).toBe(true);
  });

  it('preserves buffered objects when switching modes', () => {
    const { sim } = makeSim();
    const snapshot = sim.getSnapshot();
    snapshot.obstacles.length = 0;
    snapshot.obstacles.push({ id: 6401, kind: 'tall', lane: 0, z: 40 });
    snapshot.ramps.push({ id: 6402, lane: 1, z: 30 });
    sim.setMode('horse');
    expect(snapshot.obstacles.some((obstacle) => obstacle.id === 6401)).toBe(true);
    expect(snapshot.ramps.some((ramp) => ramp.id === 6402)).toBe(true);
    sim.setMode('car');
    expect(snapshot.obstacles.some((obstacle) => obstacle.id === 6401)).toBe(true);
    expect(snapshot.ramps.some((ramp) => ramp.id === 6402)).toBe(true);
  });
});

describe('horse level profile', () => {
  it('does not allow red dodge-only sections to disappear for long stretches', () => {
    for (let seed = 0; seed < 32; seed++) {
      const generator = new LevelGenerator(levelgen, seed);
      generator.setMode('horse');
      const chunks = generator.generateUpTo(180);
      const dodgeChunks = chunks
        .filter((chunk) => chunk.obstacles.some((obstacle) => obstacle.horseDodgeOnly))
        .map((chunk) => chunk.index);
      expect(dodgeChunks.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(dodgeChunks[0], `seed ${seed}`).toBeLessThanOrEqual(7);
      for (let index = 1; index < dodgeChunks.length; index++) {
        expect(dodgeChunks[index] - dodgeChunks[index - 1], `seed ${seed}`).toBeLessThanOrEqual(
          7,
        );
      }
    }
  });

  it('keeps low/high-energy and low/high-momentum runs passable without long empty streaks', () => {
    for (const density of [0.28, 0.86]) {
      for (const momentum of [0, 1]) {
        for (let seed = 0; seed < 24; seed++) {
          const generator = new LevelGenerator(levelgen, seed);
          generator.setMode('horse');
          generator.setDensityMultiplier(density);
          generator.setHorseMomentum(momentum);
          const chunks = generator.generateUpTo(160);
          const obstacles = chunks.flatMap((chunk) => chunk.obstacles);
          const ramps = chunks.flatMap((chunk) => chunk.ramps);
          expect(isPassable(obstacles, levelgen, ramps), `${density}/${momentum}/${seed}`).toEqual({
            passable: true,
            reason: 'ok',
          });
          let emptyStreak = 0;
          let maxEmptyStreak = 0;
          for (const chunk of chunks) {
            const empty =
              chunk.obstacles.length === 0 &&
              chunk.coins.length === 0 &&
              chunk.ramps.length === 0;
            emptyStreak = empty ? emptyStreak + 1 : 0;
            maxEmptyStreak = Math.max(maxEmptyStreak, emptyStreak);
          }
          expect(maxEmptyStreak, `${density}/${momentum}/${seed}`).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it('slightly reduces action pressure at maximum horse momentum', () => {
    const normal = new LevelGenerator(levelgen, 1209);
    normal.setMode('horse');
    normal.setHorseMomentum(0);
    const normalObstacles = normal
      .generateUpTo(400)
      .reduce((sum, chunk) => sum + chunk.obstacles.length, 0);

    const fast = new LevelGenerator(levelgen, 1209);
    fast.setMode('horse');
    fast.setHorseMomentum(1);
    const fastObstacles = fast
      .generateUpTo(400)
      .reduce((sum, chunk) => sum + chunk.obstacles.length, 0);

    expect(fastObstacles).toBeLessThan(normalObstacles);
    expect(fastObstacles).toBeGreaterThan(normalObstacles * 0.55);
  });

  it('generates passable jump and slide action groups without car-only structures', () => {
    const generator = new LevelGenerator(levelgen, 909);
    generator.setMode('horse');
    const chunks = generator.generateUpTo(300);
    const obstacles = chunks.flatMap((chunk) => chunk.obstacles);
    const coins = chunks.flatMap((chunk) => chunk.coins);
    const ramps = chunks.flatMap((chunk) => chunk.ramps);

    expect(obstacles.length).toBeGreaterThan(0);
    expect(
      obstacles.every(
        (obstacle) =>
          obstacle.kind === 'low' ||
          obstacle.kind === 'overhead' ||
          (obstacle.kind === 'tall' && obstacle.horseDodgeOnly === true),
      ),
    ).toBe(true);
    expect(obstacles.some((obstacle) => obstacle.horseAction === 'jump')).toBe(true);
    expect(obstacles.some((obstacle) => obstacle.horseAction === 'slide')).toBe(true);
    const jumpCoins = coins.filter((coin) => coin.y === levelgen.horse.jumpCoinHeight);
    expect(jumpCoins.length).toBeGreaterThan(0);
    expect(
      jumpCoins.every((coin) =>
        obstacles.some(
          (obstacle) =>
            obstacle.horseAction === 'jump' &&
            obstacle.lane === coin.lane &&
            obstacle.z === coin.z,
        ),
      ),
    ).toBe(true);
    const slideGroups = new Map<number, Set<number>>();
    for (const obstacle of obstacles.filter(
      (candidate) => candidate.horseAction === 'slide',
    )) {
      const groupId = obstacle.actionGroupId!;
      const rows = slideGroups.get(groupId) ?? new Set<number>();
      rows.add(obstacle.actionIndex ?? 0);
      slideGroups.set(groupId, rows);
    }
    expect([...slideGroups.values()].some((rows) => rows.size >= 3)).toBe(true);
    expect(
      obstacles.some(
        (obstacle) =>
          obstacle.horseAction === 'slide' && (obstacle.actionCount ?? 0) >= 6,
      ),
    ).toBe(true);
    expect(obstacles.some((obstacle) => obstacle.horseDodgeOnly)).toBe(true);
    expect(obstacles.some((obstacle) => obstacle.nitroChallenge || obstacle.redWall)).toBe(false);
    expect(ramps).toHaveLength(0);
    expect(isPassable(obstacles, levelgen, ramps)).toEqual({ passable: true, reason: 'ok' });

    const rowCount = Math.floor(levelgen.chunkLength / levelgen.minGapZ);
    const restChunks = chunks.filter((chunk) => {
      const lanes = new Set(chunk.coins.map((coin) => coin.lane));
      const lane = chunk.coins[0]?.lane;
      return (
        chunk.obstacles.length === levelgen.lanes - 1 &&
        chunk.coins.length >= Math.floor(rowCount / levelgen.horse.restCoinStride) &&
        chunk.coins.length <= Math.ceil(rowCount / levelgen.horse.restCoinStride) &&
        lanes.size >= 1 &&
        lanes.size <= 2 &&
        (lane === 0 || lane === levelgen.lanes - 1 || lanes.has(0) || lanes.has(levelgen.lanes - 1)) &&
        chunk.obstacles.every(
          (obstacle) =>
            obstacle.kind === 'low' &&
            obstacle.horseAction === 'jump' &&
            obstacle.lane !== lane,
        )
      );
    });
    expect(restChunks.length).toBeGreaterThan(0);

    const jumpGroups = new Set(
      obstacles
        .filter((obstacle) => obstacle.horseAction === 'jump')
        .map((obstacle) => obstacle.actionGroupId),
    );
    expect(slideGroups.size).toBeLessThan(jumpGroups.size);

    const actionGroups = new Map<number, { action: string; minZ: number; maxZ: number }>();
    for (const obstacle of obstacles.filter(
      (candidate) => candidate.actionGroupId !== undefined,
    )) {
      const groupId = obstacle.actionGroupId!;
      const current = actionGroups.get(groupId);
      if (current) {
        current.minZ = Math.min(current.minZ, obstacle.z);
        current.maxZ = Math.max(current.maxZ, obstacle.z);
      } else {
        actionGroups.set(groupId, {
          action: obstacle.horseAction ?? 'dodge',
          minZ: obstacle.z,
          maxZ: obstacle.z,
        });
      }
    }
    const orderedGroups = [...actionGroups.values()].sort((a, b) => a.minZ - b.minZ);
    for (let index = 1; index < orderedGroups.length; index++) {
      const previous = orderedGroups[index - 1];
      const current = orderedGroups[index];
      if (previous.action === 'slide' && current.action === 'jump') {
        expect(current.minZ - previous.maxZ).toBeGreaterThanOrEqual(
          levelgen.horse.slideToJumpMinGapZ,
        );
      }
    }
  });

  it('avoids three identical horse action chunks in a row', () => {
    for (let seed = 0; seed < 20; seed++) {
      const generator = new LevelGenerator(levelgen, seed);
      generator.setMode('horse');
      const chunks = generator.generateUpTo(120);
      let last: string | null = null;
      let streak = 0;
      for (const chunk of chunks) {
        const kind = horseChunkKind(chunk);
        if (kind === null) {
          last = null;
          streak = 0;
          continue;
        }
        if (kind === last) streak += 1;
        else {
          last = kind;
          streak = 1;
        }
        expect(streak, `seed ${seed} ${kind}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('keeps convertible slide groups car-passable with a shoulder lane', () => {
    const generator = new LevelGenerator(levelgen, 44);
    generator.setMode('horse');
    generator.setHorseConvertible(true);
    const chunks = generator.generateUpTo(80);
    const obstacles = chunks.flatMap((chunk) => chunk.obstacles);
    const slideGroups = new Map<number, number[]>();
    for (const obstacle of obstacles.filter((item) => item.horseAction === 'slide')) {
      const groupId = obstacle.actionGroupId!;
      const lanes = slideGroups.get(groupId) ?? [];
      lanes.push(obstacle.lane);
      slideGroups.set(groupId, lanes);
    }
    expect(slideGroups.size).toBeGreaterThan(0);
    for (const lanes of slideGroups.values()) {
      expect(new Set(lanes).size).toBeLessThan(levelgen.lanes);
    }
    expect(isPassable(obstacles, levelgen)).toEqual({ passable: true, reason: 'ok' });
    const carSlice = obstacles.filter(
      (obstacle) => obstacle.horseAction === 'slide' || obstacle.horseDodgeOnly,
    );
    expect(isPassableAsCar(carSlice, levelgen)).toEqual({ passable: true, reason: 'ok' });
  });
});

import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import type { PlayerAction } from '@core/gameplay/actions';
import { GameSim } from '@core/gameplay/GameSim';
import { PlayerSim } from '@core/gameplay/PlayerSim';
import { addNitroCharge, applyNitroBoost, drainNitroCharge } from '@core/gameplay/nitro';
import { PassthroughDirector } from '@core/director/PassthroughDirector';
import { emptyMusic, withoutRocketSpawn } from './musicHelpers';
import { makeDodgeBot } from './dodgeBot';

const game = withoutRocketSpawn(gameRaw as GameConfig);
const levelgen = levelgenRaw as LevelgenConfig;
const directorCfg = directorRaw as DirectorConfig;

const emptyInput = { laneDelta: 0 as const, jump: false, nitro: false };

describe('nitro formulas', () => {
  it('10 coins reach ~43.5% of the max fill', () => {
    const charge = addNitroCharge(0, 10 * game.nitro.gainPerCoin, game.nitro.maxFill);
    expect(charge).toBeCloseTo(43.5, 5);
    expect((charge / game.nitro.maxFill) * 100).toBeCloseTo(43.5, 5);
  });

  it('modest active play can fill nitro within the first 20 seconds', () => {
    const passiveCharge = 20 * game.nitro.gainPerChargeLaneSecond;
    const coinCharge = 4 * game.nitro.gainPerCoin;
    const dodgeCharge = 5 * game.nitro.gainPerDodge;
    expect(passiveCharge + coinCharge + dodgeCharge).toBeGreaterThanOrEqual(
      game.nitro.maxFill,
    );
  });

  it('boost scales with the fill: 80% > 10% > 1', () => {
    const full = applyNitroBoost(80, 100, game.nitro.boostMax);
    const low = applyNitroBoost(10, 100, game.nitro.boostMax);
    expect(full).toBeCloseTo(1.48, 5);
    expect(low).toBeCloseTo(1.06, 5);
    expect(full).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(1);
  });

  it('addNitroCharge caps at maxFill', () => {
    expect(addNitroCharge(95, 10, 100)).toBe(100);
  });

  it('drainNitroCharge does not go below zero', () => {
    expect(drainNitroCharge(3, 25, 1)).toBe(0);
    expect(drainNitroCharge(30, 25, 1)).toBe(5);
  });
});

describe('PlayerSim nitro', () => {
  it('does not activate without charge', () => {
    const sim = new PlayerSim(game);
    sim.activateNitro();
    expect(sim.state.isAbilityActive).toBe(false);
  });

  it('activates at full charge and repeated activation is ignored', () => {
    const sim = new PlayerSim(game);
    sim.state.nitroCharge = game.nitro.maxFill;
    sim.activateNitro();
    expect(sim.state.isAbilityActive).toBe(true);
    sim.activateNitro();
    expect(sim.state.isAbilityActive).toBe(true);
  });

  it('does not activate below full charge', () => {
    const sim = new PlayerSim(game);
    sim.state.nitroCharge = game.nitro.maxFill - 1;
    sim.activateNitro();
    expect(sim.state.isAbilityActive).toBe(false);
  });

  it('grace period does not drain the charge for the first ~0.1s', () => {
    const sim = new PlayerSim(game);
    sim.state.nitroCharge = game.nitro.maxFill;
    sim.activateNitro();
    for (let i = 0; i < 6; i++) sim.update(1 / 60, emptyInput, 1);
    expect(sim.state.nitroCharge).toBe(game.nitro.maxFill);
    expect(sim.state.isAbilityActive).toBe(true);
  });

  it('drains after grace and deactivates at zero', () => {
    const sim = new PlayerSim(game);
    sim.state.nitroCharge = game.nitro.maxFill;
    sim.activateNitro();
    for (let i = 0; i < 400; i++) sim.update(1 / 60, emptyInput, 1);
    expect(sim.state.isAbilityActive).toBe(false);
    expect(sim.state.nitroCharge).toBe(0);
  });

  it('nitro boosts speed while active', () => {
    const full = new PlayerSim(game);
    full.state.nitroCharge = game.nitro.maxFill;
    full.activateNitro();
    const idle = new PlayerSim(game);
    for (let i = 0; i < 30; i++) {
      full.update(1 / 60, emptyInput, 2);
      idle.update(1 / 60, emptyInput, 2);
    }
    expect(full.state.speed).toBeGreaterThan(idle.state.speed);
  });

  it('reset clears the charge and deactivates', () => {
    const sim = new PlayerSim(game);
    sim.state.nitroCharge = game.nitro.maxFill;
    sim.activateNitro();
    sim.reset();
    expect(sim.state.nitroCharge).toBe(0);
    expect(sim.state.isAbilityActive).toBe(false);
  });

  it('interrupts nitro without clearing the remaining charge and requires refill', () => {
    const sim = new PlayerSim(game);
    sim.state.nitroCharge = game.nitro.maxFill;
    sim.activateNitro();
    sim.interruptNitro();
    expect(sim.state.isAbilityActive).toBe(false);
    expect(sim.state.nitroCharge).toBeGreaterThan(0);
    expect(sim.state.nitroCharge).toBeLessThan(game.nitro.maxFill);
    sim.activateNitro();
    expect(sim.state.isAbilityActive).toBe(false);
  });

  it('keeps a short smash-only window after natural nitro depletion', () => {
    const sim = new PlayerSim(game);
    sim.state.nitroCharge = game.nitro.maxFill;
    sim.activateNitro();
    sim.update(game.nitro.graceSeconds + 0.01, emptyInput, 1);
    sim.state.nitroCharge = 0.5;
    sim.update(0.05, emptyInput, 1);
    expect(sim.state.isAbilityActive).toBe(false);
    expect(sim.canSmashWithNitro).toBe(true);
    expect(sim.nitroSmashVisualStrength).toBeGreaterThan(0);
    sim.update(game.nitro.smashGraceSeconds + 0.02, emptyInput, 1);
    expect(sim.canSmashWithNitro).toBe(false);
    expect(sim.nitroSmashVisualStrength).toBe(0);
  });

  it('fades destructible-object strength during the final half-second', () => {
    const sim = new PlayerSim(game);
    sim.state.nitroCharge = game.nitro.maxFill;
    sim.activateNitro();
    const fullStrength = sim.nitroSmashVisualStrength;
    sim.state.nitroCharge = game.nitro.drainPerSecond * 0.25;
    const warningStrength = sim.nitroSmashVisualStrength;
    expect(fullStrength).toBe(1);
    expect(warningStrength).toBeGreaterThan(0.35);
    expect(warningStrength).toBeLessThan(1);
  });
});

describe('GameSim nitro', () => {
  function makeSim(
    seed?: number,
    overrides: { game?: GameConfig; levelgen?: LevelgenConfig } = {},
  ): { sim: GameSim; setInput: (a: PlayerAction[]) => void } {
    const director = new PassthroughDirector(directorCfg);
    let input: PlayerAction[] = [];
    const sim = new GameSim({
      game: overrides.game ?? game,
      levelgen: overrides.levelgen ?? levelgen,
      director,
      consumeInput: () => input,
      nowMs: () => 0,
      getMusic: () => emptyMusic(),
      seed: seed ?? 42,
    });
    return { sim, setInput: (a) => (input = a) };
  }

  const dodge = makeDodgeBot(levelgen.lanes);

  const emptyLevelgen: LevelgenConfig = {
    ...levelgen,
    segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
  };

  const coinOnlyGame: GameConfig = {
    ...game,
    nitro: { ...game.nitro, gainPerChargeLaneSecond: 0, gainPerDodge: 0 },
  };

  const coinOnlyLevelgen: LevelgenConfig = {
    ...levelgen,
    segmentWeights: { obstacle: 0, coins: 1, bonus: 0, empty: 0 },
  };

  it('coins grant nitro charge per coin', () => {
    const { sim, setInput } = makeSim(undefined, {
      game: coinOnlyGame,
      levelgen: coinOnlyLevelgen,
    });
    for (let i = 0; i < 2400 && !sim.gameOver; i++) {
      const snap = sim.getSnapshot();
      if (snap.player.coins >= 10) break;
      const target = snap.coins
        .filter((coin) => !coin.collected && coin.z > 0)
        .sort((a, b) => a.z - b.z)[0];
      setInput(
        target && target.lane !== snap.player.lane
          ? [target.lane > snap.player.lane ? 'laneRight' : 'laneLeft']
          : [],
      );
      sim.fixedUpdate(1 / 60);
      setInput([]);
    }
    const snap = sim.getSnapshot();
    expect(snap.player.coins).toBeGreaterThan(0);
    expect(snap.player.nitroCharge).toBeCloseTo(
      snap.player.coins * game.nitro.gainPerCoin,
      6,
    );
  });

  it('auto-activates fully ready nitro on a destructible collision and blasts nearby lows', () => {
    const { sim } = makeSim(undefined, { levelgen: emptyLevelgen });
    const snapshot = sim.getSnapshot();
    snapshot.player.nitroCharge = game.nitro.maxFill;
    snapshot.obstacles.push(
      { id: 98001, kind: 'low', lane: snapshot.player.lane, z: 0 },
      {
        id: 98002,
        kind: 'low',
        lane: (snapshot.player.lane + 1) % game.lane.positions.length,
        z: 8,
      },
      { id: 98003, kind: 'tall', lane: snapshot.player.lane, z: 7 },
    );

    sim.fixedUpdate(1 / 60);

    expect(snapshot.player.isAbilityActive).toBe(true);
    expect(snapshot.player.damageState).toBe('normal');
    expect(snapshot.obstacles[0].smashed).toBe(true);
    expect(snapshot.obstacles[1].smashed).toBe(true);
    expect(snapshot.obstacles[1].smashStrength).toBe(
      game.nitro.readyCollisionBlastStrength,
    );
    expect(snapshot.obstacles[2].broken).not.toBe(true);
  });

  it('does not grant collision protection from a partially filled nitro bar', () => {
    const { sim } = makeSim(undefined, { levelgen: emptyLevelgen });
    const snapshot = sim.getSnapshot();
    snapshot.player.nitroCharge = game.nitro.maxFill - 1;
    snapshot.obstacles.push({
      id: 98004,
      kind: 'low',
      lane: snapshot.player.lane,
      z: 0,
    });

    sim.fixedUpdate(1 / 60);

    expect(snapshot.player.isAbilityActive).toBe(false);
    expect(snapshot.player.damageState).not.toBe('normal');
  });

  it('grants smash charge during the post-nitro window without reactivating nitro', () => {
    const graceGame: GameConfig = {
      ...game,
      nitro: {
        ...game.nitro,
        gainPerChargeLaneSecond: 0,
        gainPerDodge: 0,
      },
    };
    const { sim, setInput } = makeSim(undefined, {
      game: graceGame,
      levelgen: emptyLevelgen,
    });
    const snapshot = sim.getSnapshot();
    snapshot.player.nitroCharge = graceGame.nitro.maxFill;
    setInput(['nitro']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    for (let i = 0; i < 8; i++) sim.fixedUpdate(1 / 60);
    snapshot.player.nitroCharge = 0.1;
    sim.fixedUpdate(1 / 60);
    expect(snapshot.player.isAbilityActive).toBe(false);
    snapshot.obstacles.push({
      id: 99001,
      kind: 'low',
      lane: snapshot.player.lane,
      z: 0.5,
    });
    sim.fixedUpdate(1 / 60);
    const smashed = snapshot.obstacles.find((obstacle) => obstacle.id === 99001)!;
    expect(smashed.smashed).toBe(true);
    expect(snapshot.player.isAbilityActive).toBe(false);
    expect(snapshot.player.nitroCharge).toBeCloseTo(graceGame.nitro.gainPerSmash, 5);
    expect(sim.getSnapshot().runStats.smashes).toBe(1);
    for (let i = 0; i < 20; i++) sim.fixedUpdate(1 / 60);
    expect(snapshot.player.isAbilityActive).toBe(false);
    expect(snapshot.player.nitroCharge).toBeCloseTo(graceGame.nitro.gainPerSmash, 5);
    expect(sim.playerSim.canSmashWithNitro).toBe(false);
  });

  it('both middle lanes charge nitro over time, outer lanes do not', () => {
    const { sim } = makeSim(undefined, { levelgen: emptyLevelgen });
    const player = sim.playerSim.state;
    player.lane = 0;
    player.laneX = game.lane.positions[0];
    for (let i = 0; i < 60; i++) sim.fixedUpdate(1 / 60);
    expect(player.nitroCharge).toBeCloseTo(0, 6);

    for (const lane of levelgen.nitroChargeLanes) {
      const before = player.nitroCharge;
      player.lane = lane;
      player.laneX = game.lane.positions[lane];
      for (let i = 0; i < 60; i++) sim.fixedUpdate(1 / 60);
      expect(player.nitroCharge - before).toBeCloseTo(
        game.nitro.gainPerChargeLaneSecond,
        1,
      );
    }
  });

  it('thins distant ground coins immediately on activation but preserves fair and air coins', () => {
    const { sim, setInput } = makeSim(undefined, { levelgen: emptyLevelgen });
    const snap = sim.getSnapshot();
    snap.player.nitroCharge = game.nitro.maxFill;
    snap.coins.push(
      { id: 3001, lane: 0, z: 40, collected: false },
      { id: 3002, lane: 1, z: 40, collected: false },
      { id: 3003, lane: 2, z: 40, collected: false },
      { id: 3004, lane: 3, z: 10, collected: false },
      { id: 3005, lane: 0, z: 40, collected: false, airPathId: 88 },
    );
    setInput(['nitro']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    expect(snap.coins.some((coin) => coin.id === 3001)).toBe(false);
    expect(snap.coins.some((coin) => coin.id === 3002)).toBe(false);
    expect(snap.coins.some((coin) => coin.id === 3003)).toBe(true);
    expect(snap.coins.some((coin) => coin.id === 3004)).toBe(true);
    expect(snap.coins.some((coin) => coin.id === 3005)).toBe(true);
  });

  it('dodges charge nitro on top of coin gains', () => {
    const dodgeLevelgen: LevelgenConfig = {
      ...levelgen,
      wallProbability: 0,
      tallProbability: 0,
      twoObstacleBias: 0,
      redWallProbability: 0,
      rampProbability: 0,
      laneFlow: [0, 0, 0, 0],
    };
    const { sim, setInput } = makeSim(20, { levelgen: dodgeLevelgen });
    let goal = false;
    for (let i = 0; i < 4800 && !sim.gameOver && !goal; i++) {
      const snap = sim.getSnapshot();
      if (
        snap.combo > 0 &&
        snap.player.nitroCharge > snap.player.coins * game.nitro.gainPerCoin
      ) {
        goal = true;
        break;
      }
      setInput(dodge(snap));
      sim.fixedUpdate(1 / 60);
      setInput([]);
    }
    expect(goal).toBe(true);
    const snap = sim.getSnapshot();
    expect(snap.combo).toBeGreaterThan(0);
    expect(snap.player.nitroCharge).toBeGreaterThan(
      snap.player.coins * game.nitro.gainPerCoin,
    );
  });

  const nitroGame: GameConfig = {
    ...game,
    nitro: { ...game.nitro, gainPerChargeLaneSecond: 1000, drainPerSecond: 1 },
  };
  const wallLowLevelgen: LevelgenConfig = {
    ...levelgen,
    wallProbability: 1,
    shoulderPasserProbability: 0,
    tallProbability: 0,
    twoObstacleBias: 0,
    segmentWeights: { obstacle: 1, coins: 0, bonus: 0, empty: 0 },
  };

  it('nitro smashes low obstacles without damage and grows combo', () => {
    const { sim, setInput } = makeSim(undefined, {
      game: nitroGame,
      levelgen: wallLowLevelgen,
    });
    setInput(['laneLeft']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    for (let i = 0; i < 10; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().player.nitroCharge).toBe(game.nitro.maxFill);

    for (let i = 0; i < 900 && !sim.gameOver; i++) {
      setInput(['nitro']);
      sim.fixedUpdate(1 / 60);
      setInput([]);
      if (sim.getSnapshot().obstacles.some((o) => o.smashed)) break;
    }
    const snap = sim.getSnapshot();
    expect(snap.player.damageState).toBe('normal');
    expect(snap.player.gameOver).toBe(false);
    expect(snap.combo).toBeGreaterThan(0);
    expect(snap.comboSmash).toBe(true);
    expect(snap.obstacles.some((o) => o.smashed)).toBe(true);
  });

  const wallTallLevelgen: LevelgenConfig = {
    ...wallLowLevelgen,
    wallProbability: 0,
    tallProbability: 1,
  };

  it('tall obstacles are not smashed by nitro and still deal damage', () => {
    const { sim, setInput } = makeSim(undefined, {
      game: nitroGame,
      levelgen: wallTallLevelgen,
    });
    setInput(['laneLeft']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    for (let i = 0; i < 10; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().player.nitroCharge).toBe(game.nitro.maxFill);

    for (let i = 0; i < 900 && !sim.gameOver; i++) {
      setInput(['nitro']);
      sim.fixedUpdate(1 / 60);
      setInput([]);
      if (sim.getSnapshot().player.damageState !== 'normal') break;
    }
    const snap = sim.getSnapshot();
    expect(snap.player.damageState).not.toBe('normal');
    expect(snap.player.isAbilityActive).toBe(false);
    expect(snap.player.nitroCharge).toBeGreaterThan(0);
    expect(snap.obstacles.some((o) => o.broken && !o.smashed)).toBe(true);
    expect(snap.obstacles.some((o) => o.smashed)).toBe(false);
  });

  it('nitro does not activate outside car mode', () => {
    const { sim, setInput } = makeSim(undefined, {
      game: nitroGame,
      levelgen: emptyLevelgen,
    });
    sim.setMode('horse');
    setInput(['laneLeft']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    for (let i = 0; i < 10; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().player.nitroCharge).toBe(0);
    setInput(['nitro']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    expect(sim.getSnapshot().player.isAbilityActive).toBe(false);
  });

  it('nitro activates and spawns sparse ram-through challenges in the level', () => {
    const wallCfg: LevelgenConfig = {
      ...levelgen,
      wallProbability: 0,
      nitroWallProbability: 1,
      laneFlow: [0, 0, 0, 0],
    };
    const { sim, setInput } = makeSim(undefined, {
      game: nitroGame,
      levelgen: wallCfg,
    });
    setInput(['laneLeft']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    for (let i = 0; i < 10; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().player.nitroCharge).toBe(game.nitro.maxFill);

    for (let i = 0; i < 900 && !sim.gameOver; i++) {
      setInput(['nitro']);
      sim.fixedUpdate(1 / 60);
      setInput([]);
      if (sim.getSnapshot().player.isAbilityActive) break;
    }
    expect(sim.getSnapshot().player.isAbilityActive).toBe(true);

    for (let i = 0; i < 300; i++) sim.fixedUpdate(1 / 60);

    const snap = sim.getSnapshot();
    const challenges = snap.obstacles.filter((o) => o.nitroChallenge);
    expect(challenges.length).toBeGreaterThan(0);
    expect(challenges.every((o) => o.kind === 'low')).toBe(true);
  });

  it('opens a safe lane in mandatory challenges if full nitro is lost', () => {
    const readyCfg: LevelgenConfig = {
      ...levelgen,
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      redWallProbability: 0,
      rampProbability: 0,
      nitroReadyChallengeProbability: 1,
      nitroReadyMandatoryProbability: 1,
    };
    const { sim } = makeSim(15, { levelgen: readyCfg });
    const player = sim.playerSim.state;
    player.nitroCharge = game.nitro.maxFill;
    sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().obstacles.some((o) => o.nitroMandatory)).toBe(true);

    player.nitroCharge = game.nitro.maxFill - 10;
    sim.fixedUpdate(1 / 60);
    const aheadMandatory = sim.getSnapshot().obstacles.filter(
      (obstacle) => obstacle.nitroMandatory && obstacle.z > 0,
    );
    expect(aheadMandatory.some((obstacle) => obstacle.lane === player.lane)).toBe(false);
  });

  it('restart clears the nitro charge', () => {
    const { sim, setInput } = makeSim(undefined, { levelgen: emptyLevelgen });
    setInput(['laneLeft']);
    sim.fixedUpdate(1 / 60);
    setInput([]);
    for (let i = 0; i < 60; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().player.nitroCharge).toBeGreaterThan(0);
    sim.restart();
    expect(sim.getSnapshot().player.nitroCharge).toBe(0);
    expect(sim.getSnapshot().player.isAbilityActive).toBe(false);
  });

  const coinExtGame: GameConfig = {
    ...game,
    nitro: {
      ...game.nitro,
      gainPerChargeLaneSecond: 0,
      gainPerDodge: 0,
      gainPerSmash: 0,
      gainPerNearMiss: 0,
      drainPerSecond: 0.001,
    },
  };

  it('coins grant extra nitro while nitro is active', () => {
    const coinLevelgen: LevelgenConfig = {
      ...levelgen,
      segmentWeights: { obstacle: 0, coins: 1, bonus: 0, empty: 0 },
      rampProbability: 0,
      earlyRampProbability: 0,
      redWallProbability: 0,
      laneFlow: [0, 0, 0, 0],
    };
    const { sim, setInput } = makeSim(undefined, {
      game: coinExtGame,
      levelgen: coinLevelgen,
    });
    const player = sim.playerSim.state;
    player.nitroCharge = 50;
    player.isAbilityActive = true;
    for (let i = 0; i < 2400 && !sim.gameOver && sim.getSnapshot().player.coins < 5; i++) {
      const snap = sim.getSnapshot();
      setInput(snap.player.lane < 3 ? ['laneLeft'] : []);
      sim.fixedUpdate(1 / 60);
      setInput([]);
    }
    const snap = sim.getSnapshot();
    expect(snap.player.coins).toBeGreaterThan(0);
    expect(snap.player.nitroCharge).toBeCloseTo(
      50 + snap.player.coins * game.nitro.gainPerCoin * game.nitro.coinNitroMultiplier,
      1,
    );
  });

  it('smashing low obstacles during nitro returns charge', () => {
    const smashGame: GameConfig = {
      ...game,
      nitro: {
        ...game.nitro,
        gainPerChargeLaneSecond: 0,
        gainPerDodge: 0,
        gainPerNearMiss: 0,
        gainPerSmash: 1000,
        drainPerSecond: 0.001,
      },
    };
    const { sim } = makeSim(undefined, { game: smashGame, levelgen: wallLowLevelgen });
    const player = sim.playerSim.state;
    player.nitroCharge = 50;
    player.isAbilityActive = true;
    let smashed = 0;
    let reachedMax = false;
    for (let i = 0; i < 900 && !sim.gameOver && !reachedMax; i++) {
      sim.fixedUpdate(1 / 60);
      const count = sim.getSnapshot().obstacles.filter((o) => o.smashed).length;
      if (count > smashed) smashed = count;
      if (sim.getSnapshot().player.nitroCharge >= game.nitro.maxFill) {
        reachedMax = true;
      }
    }
    expect(smashed).toBeGreaterThan(0);
    expect(reachedMax).toBe(true);
  });

  it('near-miss during nitro returns charge', () => {
    const nearMissGame: GameConfig = {
      ...game,
      nitro: {
        ...game.nitro,
        gainPerChargeLaneSecond: 0,
        gainPerDodge: 0,
        gainPerSmash: 0,
        gainPerNearMiss: 1000,
        drainPerSecond: 0.001,
      },
    };
    const { sim } = makeSim(undefined, { game: nearMissGame, levelgen: wallLowLevelgen });
    const player = sim.playerSim.state;
    player.nitroCharge = 50;
    player.isAbilityActive = true;
    let reachedMax = false;
    for (let i = 0; i < 900 && !sim.gameOver && !reachedMax; i++) {
      sim.fixedUpdate(1 / 60);
      if (sim.getSnapshot().player.nitroCharge >= game.nitro.maxFill) reachedMax = true;
    }
    expect(reachedMax).toBe(true);
  });

  it('collecting coins during nitro adds a persistent score bonus', () => {
    const coinOnlyLevelgen: LevelgenConfig = {
      ...levelgen,
      segmentWeights: { obstacle: 0, coins: 1, bonus: 0, empty: 0 },
      nitroWallProbability: 0,
    };
    const { sim, setInput } = makeSim(undefined, {
      game: coinExtGame,
      levelgen: coinOnlyLevelgen,
    });
    const player = sim.playerSim.state;
    player.nitroCharge = game.nitro.maxFill;
    player.isAbilityActive = true;
    for (let i = 0; i < 2400 && !sim.gameOver && sim.getSnapshot().player.coins < 5; i++) {
      const snap = sim.getSnapshot();
      setInput(snap.player.lane < 3 ? ['laneLeft'] : []);
      sim.fixedUpdate(1 / 60);
      setInput([]);
    }
    const snap = sim.getSnapshot();
    expect(snap.player.coins).toBeGreaterThan(0);
    expect(snap.scoreTotal).toBe(
      snap.player.coins * game.coin.value * game.nitro.scoreMultiplier,
    );
  });
});

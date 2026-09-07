import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import { LevelGenerator } from '@core/levelgen/LevelGenerator';
import { GameSim } from '@core/gameplay/GameSim';
import { PassthroughDirector } from '@core/director/PassthroughDirector';
import { resolveLevelgenPreset } from '@core/config/levelgenPresets';
import { findComfortableCarRoute } from '@core/levelgen/passability';
import { emptyMusic, withoutRocketSpawn } from './musicHelpers';

describe('opening traffic', () => {
  it('resets track timing and traffic history to the same opening as a fresh generator', () => {
    const config = levelgenRaw as LevelgenConfig;
    const fresh = new LevelGenerator(config, 912);
    fresh.setDestroyCarMode(true, gameRaw.destroy);
    const reused = new LevelGenerator(config, 912);
    reused.setDestroyCarMode(true, gameRaw.destroy);
    reused.setTrafficSpawnContext(400, 40, 25, true);
    reused.setNitroActive(true);
    reused.setDestroyNitroTraffic(600, 420);
    reused.generateUpTo(8);
    reused.setTrackTiming(99, 100, 25);
    reused.reset(912);
    expect(reused.generateUpTo(3)).toEqual(fresh.generateUpTo(3));
  });

  it('keeps opening fill inside the generated horizon and disabled at the track end', () => {
    const config = { ...levelgenRaw, segmentsAhead: 1 } as LevelgenConfig;
    const generator = new LevelGenerator(config, 23);
    generator.setDestroyCarMode(true, gameRaw.destroy);
    generator.setTrafficSpawnContext(0, 0, gameRaw.speeds.base, false);
    generator.generateUpTo(1);
    const added = generator.fillOpeningContent([], [], [], config.contentStartZ);
    expect(added.obstacles.length).toBeGreaterThan(0);
    expect(added.obstacles.every(o => o.z < config.contentStartZ + config.chunkLength * 2)).toBe(true);
    generator.setTrackTiming(99, 100, gameRaw.speeds.base);
    expect(generator.fillOpeningContent([], [], [], config.contentStartZ)).toEqual({ obstacles: [], coins: [] });
  });

  it.each([0, 10, 15, 20, 30])('scales only the pickup kick at %s seconds, preserving charge and the speed cap', (time) => {
    const gain = (scale: number) => {
      const game = withoutRocketSpawn(gameRaw as GameConfig);
      game.destroy = { ...game.destroy, earlyGreenSmashSpeedScale: scale };
      const sim = new GameSim({
        game, levelgen: levelgenRaw as LevelgenConfig, seed: 42, gameplayRules: 'destroy',
        director: new PassthroughDirector(directorRaw as DirectorConfig),
        consumeInput: () => [], nowMs: () => 0, getMusic: emptyMusic,
      });
      sim.fixedUpdate(0);
      const snapshot = sim.getSnapshot();
      snapshot.player.gameTime = time;
      snapshot.obstacles.length = 0;
      snapshot.ramps.length = 0;
      sim.fixedUpdate(0);
      const speed = snapshot.player.speed;
      snapshot.obstacles.push({ id: -801, kind: 'micro', lane: snapshot.player.lane, z: 0.5 });
      sim.fixedUpdate(0);
      const charge = snapshot.player.nitroCharge;
      sim.fixedUpdate(0);
      return { kick: snapshot.player.speed / speed - 1, charge, speed: snapshot.player.speed };
    };
    const regular = gain(1);
    const opening = gain(2);
    const full = gameRaw.destroy.earlyGreenSmashFullSeconds;
    const fade = gameRaw.destroy.earlyGreenSmashFadeSeconds;
    const expected =
      time <= full ? 2 : time >= full + fade ? 1 : 1 + (1 - (time - full) / fade);
    expect(opening.kick / regular.kick).toBeCloseTo(expected);
    expect(opening.charge).toBe(regular.charge);
    expect(opening.speed).toBeLessThanOrEqual(gameRaw.speeds.max);
  });

  it.each(['mega-traffic', 'grok-traffic', 'ultimate-traffic'] as const)(
    'has nearby content and a comfortable starting route in %s', (preset) => {
      const failures: string[] = [];
      const game = withoutRocketSpawn(gameRaw as GameConfig);
      const levelgen = resolveLevelgenPreset(preset, levelgenRaw as LevelgenConfig);
      for (let seed = 1; seed <= 64; seed++) {
        const sim = new GameSim({
          game, levelgen, seed, gameplayRules: 'destroy',
          director: new PassthroughDirector(directorRaw as DirectorConfig),
          consumeInput: () => [], nowMs: () => 0, getMusic: emptyMusic,
        });
        sim.fixedUpdate(0);
        const { player, obstacles, ramps } = sim.getSnapshot();
        const firstZ = Math.min(...obstacles.map(o => o.z));
        if (firstZ > levelgen.contentStartZ + levelgen.minGapZ * 2) failures.push(seed + ': empty ' + firstZ);
        for (let z = 20; z < 90; z += 10) {
          if (!obstacles.some(o => o.z >= z && o.z <= z + 24) && !ramps.some(r => r.z >= z && r.z <= z + 24)) {
            failures.push(seed + ': empty section at ' + z);
          }
        }
        for (const speed of [game.speeds.base, 12, 16, 22, game.speeds.max]) {
          if (!findComfortableCarRoute(obstacles, levelgen, ramps, {
            playerSpeed: speed, startLanes: [player.lane],
          }).passable) failures.push(seed + ': blocked at ' + speed);
        }
      }
      expect(failures).toEqual([]);
    },
  );
});

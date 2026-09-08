import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import type { PlayerAction } from '@core/gameplay/actions';
import { GameSim } from '@core/gameplay/GameSim';
import { LevelGenerator } from '@core/levelgen/LevelGenerator';
import {
  horseLeftoverGuideHorizonZ,
  horseToCarTransitionChunks,
  planHorseToCarGuides,
} from '@core/levelgen/modeTransition';
import type { ObstacleEntity } from '@core/levelgen/types';
import { PassthroughDirector } from '@core/director/PassthroughDirector';
import { emptyMusic, withoutRocketSpawn } from './musicHelpers';

const game = withoutRocketSpawn(gameRaw as GameConfig);
const levelgen = levelgenRaw as LevelgenConfig;
const lanes = levelgen.lanes;

function slideGroup(
  groupId: number,
  lanesBlocked: number[],
  z: number,
): ObstacleEntity[] {
  return lanesBlocked.map((lane, index) => ({
    id: 7000 + groupId * 10 + index,
    kind: 'overhead' as const,
    lane,
    z,
    horseAction: 'slide' as const,
    actionGroupId: groupId,
  }));
}

describe('horse → car transition fairness', () => {
  it('guides through the free lane of leftover slide groups', () => {
    const obstacles = slideGroup(11, [0, 1, 2], 10);
    const guides = planHorseToCarGuides(obstacles, lanes, 200);
    expect(guides).toHaveLength(3);
    expect(guides.every((guide) => guide.lane === 3)).toBe(true);
    expect(guides.map((guide) => guide.z)).toEqual([10, 10, 10]);
  });

  it('skips full-row groups with no free passage and broken leftovers', () => {
    const fullRow: ObstacleEntity[] = [0, 1, 2, 3].map((lane) => ({
      id: 7100 + lane,
      kind: 'overhead',
      lane,
      z: 12,
      horseAction: 'slide',
      actionGroupId: 12,
    }));
    const broken = slideGroup(13, [0, 1], 12).map((obstacle) => ({
      ...obstacle,
      broken: true,
    }));
    expect(planHorseToCarGuides([...fullRow, ...broken], lanes, 200)).toEqual([]);
  });

  it('ignores leftovers beyond the reaction horizon', () => {
    const obstacles = slideGroup(14, [0, 1, 2], 10);
    expect(planHorseToCarGuides(obstacles, lanes, 5)).toEqual([]);
    const horizon = horseLeftoverGuideHorizonZ(28, levelgen.fairness);
    expect(horizon).toBeGreaterThan(10);
    expect(planHorseToCarGuides(obstacles, lanes, horizon)).toHaveLength(3);
  });

  it('generates sparse certified car chunks right after the transition', () => {
    for (const seed of [7, 42, 1337]) {
      const generator = new LevelGenerator(levelgen, seed);
      generator.setMode('horse');
      generator.generateUpTo(2);
      generator.setMode('car');
      expect(generator.horseToCarTransitionActive).toBe(false);
      generator.beginHorseToCarTransition();
      expect(generator.horseToCarTransitionActive).toBe(true);
      for (let step = 0; step < horseToCarTransitionChunks(); step++) {
        const chunk = generator.generateChunk(100 + step);
        expect(chunk.obstacles.some((o) => o.kind === 'tall')).toBe(false);
        expect(chunk.obstacles.some((o) => o.redWall)).toBe(false);
        expect(
          chunk.obstacles.some((o) => o.nitroChallenge || o.nitroMandatory),
        ).toBe(false);
        expect(chunk.ramps).toEqual([]);
      }
      expect(generator.horseToCarTransitionActive).toBe(false);
    }
  });

  it.each([0, 1, 3])(
    'keeps published obstacles and marks guides on lane %i',
    (entryLane) => {
      for (const speed of [14, 28]) {
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
          getMusic: () => emptyMusic(),
          seed: 4242,
        });
        sim.setMode('horse');
        sim.playerSim.state.lane = entryLane;
        sim.playerSim.state.speed = speed;
        const before = slideGroup(21, [0, 1, 2], 6);
        const snapshot = sim.getSnapshot();
        snapshot.obstacles.push(...before);
        const obstacleCount = snapshot.obstacles.length;
        sim.setMode('car');
        expect(sim.mode).toBe('car');
        // Ничего опубликованного не удалено и не переставлено.
        const after = sim.getSnapshot();
        expect(after.obstacles).toHaveLength(obstacleCount);
        for (const obstacle of before) {
          const kept = after.obstacles.find((o) => o.id === obstacle.id);
          expect(kept).toBeDefined();
          expect(kept!.z).toBe(obstacle.z);
          expect(kept!.lane).toBe(obstacle.lane);
          expect(kept!.broken).toBeFalsy();
        }
        // Проезд подсвечен направляющими в свободной полосе.
        const guides = after.coins.filter((coin) => coin.routeKind === 'safeGuide');
        expect(guides.length).toBeGreaterThan(0);
        expect(guides.every((coin) => coin.lane === 3)).toBe(true);
      }
    },
  );

  it('gives a short grace after an air-bonus return to car', () => {
    let input: PlayerAction[] = [];
    const emptyLevelgen: LevelgenConfig = {
      ...levelgen,
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      redWallProbability: 0,
      rampProbability: 0,
      earlyRampProbability: 0,
      laneFlow: [0, 0, 0, 0],
    };
    const sim = new GameSim({
      game,
      levelgen: emptyLevelgen,
      director: new PassthroughDirector(directorRaw as DirectorConfig),
      consumeInput: () => input,
      nowMs: () => 0,
      getMusic: () => emptyMusic(),
      seed: 5150,
    });
    sim.setMode('horse');
    const snapshot = sim.getSnapshot();
    const lane = snapshot.player.lane;
    snapshot.obstacles.push({ id: 9001, kind: 'tall', lane, z: 0.4 });
    sim.setMode('car');
    sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().player.damageState).toBe('normal');
    expect(
      sim.getSnapshot().obstacles.some((obstacle) => obstacle.id === 9001),
    ).toBe(true);
  });
});

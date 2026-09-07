import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import type { GameConfig, LevelgenConfig } from '@core/config/schemas';
import { LevelGenerator } from '@core/levelgen/LevelGenerator';
import { findComfortableCarRoute, isReadableMicroPlacement } from '@core/levelgen/passability';
import { carTrafficScrollSpeed } from '@core/levelgen/trafficMotion';
import { startLane } from '@core/levelgen/startLane';
import type { ObstacleEntity } from '@core/levelgen/types';

const config = levelgenRaw as LevelgenConfig;
const game = gameRaw as GameConfig;

function corridorRow(
  idStart: number,
  z: number,
  freeLane: number,
): ObstacleEntity[] {
  return Array.from({ length: config.lanes }, (_, lane) => lane)
    .filter((lane) => lane !== freeLane)
    .map((lane, index) => ({
      id: idStart + index,
      kind: 'tall' as const,
      lane,
      z,
    }));
}

function microClusters(obstacles: ObstacleEntity[]): ObstacleEntity[][] {
  const micros = obstacles
    .filter((obstacle) => obstacle.kind === 'micro')
    .sort((a, b) => a.lane - b.lane || a.z - b.z || a.id - b.id);
  const clusters: ObstacleEntity[][] = [];
  for (const micro of micros) {
    const last = clusters.at(-1);
    const tail = last?.at(-1);
    if (
      last &&
      tail &&
      tail.lane === micro.lane &&
      micro.z - tail.z <= config.minGapZ * 0.55
    ) {
      last.push(micro);
    } else {
      clusters.push([micro]);
    }
  }
  return clusters;
}

describe('comfortable car fairness', () => {
  it('counts fast edge traffic as a real hazard at its collision arrival time', () => {
    const speed = game.speeds.base;
    const obstacles: ObstacleEntity[] = Array.from({ length: config.lanes }, (_, lane) => ({
      id: lane + 1, kind: 'low', lane, z: 0, zExtent: 3,
      shoulderPasser: lane === config.lanes - 1,
    }));
    for (const obstacle of obstacles) {
      obstacle.z = carTrafficScrollSpeed(speed, obstacle.lane, config, obstacle);
    }
    expect(findComfortableCarRoute(obstacles, config, [], {
      playerSpeed: speed,
    }).passable).toBe(false);
    expect(carTrafficScrollSpeed(speed, 0, config, { shoulderPasser: true })).toBe(0.5);
  });

  it('rejects a formally adjacent weave that is faster than lane switching', () => {
    const flatFlow: LevelgenConfig = { ...config, laneFlow: [0, 0, 0, 0] };
    const obstacles = [
      ...corridorRow(1, 0, 1),
      ...corridorRow(10, config.minGapZ, 2),
    ];
    const result = findComfortableCarRoute(obstacles, flatFlow, [], {
      playerSpeed: flatFlow.fairness.referenceSpeed,
      startLanes: [1],
    });
    expect(result.passable).toBe(false);
  });

  it('accepts the same weave with the agreed reaction interval', () => {
    const flatFlow: LevelgenConfig = { ...config, laneFlow: [0, 0, 0, 0] };
    const obstacles = [
      ...corridorRow(1, 0, 1),
      ...corridorRow(10, config.minGapZ * 2, 2),
      ...corridorRow(20, config.minGapZ * 4, 1),
    ];
    const result = findComfortableCarRoute(obstacles, flatFlow, [], {
      playerSpeed: flatFlow.fairness.referenceSpeed,
      startLanes: [1],
    });
    expect(result.passable).toBe(true);
    expect(result.route.at(-1)?.lane).toBe(1);
  });

  it('detects lanes that close at the same encounter time despite different z', () => {
    const encounterSeconds = 0.4;
    const obstacles: ObstacleEntity[] = config.laneFlow.map((flow, lane) => ({
      id: lane + 1,
      kind: 'tall',
      lane,
      z: (config.fairness.referenceSpeed + flow) * encounterSeconds,
    }));
    const result = findComfortableCarRoute(obstacles, config, [], {
      playerSpeed: config.fairness.referenceSpeed,
      startLanes: [startLane(config)],
    });
    expect(result.passable).toBe(false);
  });

  it('repairs a cross-chunk temporal closure with the smallest road-hazard removal', () => {
    const encounterSeconds = 0.8;
    const obstacles: ObstacleEntity[] = config.laneFlow.map((flow, lane) => ({
      id: lane + 1,
      kind: 'tall',
      lane,
      z: (config.fairness.referenceSpeed + flow) * encounterSeconds,
    }));
    const generator = new LevelGenerator(config, 1);
    const result = generator.repairCarHorizon(
      obstacles,
      [],
      startLane(config),
    );
    expect(result.passable).toBe(true);
    expect(obstacles.length).toBe(3);
  });

  it('repairs only staged obstacles and never removes published traffic', () => {
    const flatFlow: LevelgenConfig = { ...config, laneFlow: [0, 0, 0, 0] };
    const published = [0, 1, 2].map((lane) => ({
      id: lane + 1,
      kind: 'tall' as const,
      lane,
      z: 28,
    }));
    const staged: ObstacleEntity = { id: 4, kind: 'tall', lane: 3, z: 28 };
    const horizon = [...published, staged];
    const generator = new LevelGenerator(flatFlow, 1);
    const result = generator.repairCarHorizon(horizon, [], 0, {
      obstacleIds: new Set([staged.id]),
      rampIds: new Set(),
    });

    expect(result.passable).toBe(true);
    expect(horizon.map((obstacle) => obstacle.id)).toEqual([1, 2, 3]);
  });

  it('keeps a published micro route from becoming a staged dead end', () => {
    const flatFlow: LevelgenConfig = { ...config, laneFlow: [0, 0, 0, 0] };
    const micro: ObstacleEntity[] = [
      { id: 1, kind: 'micro', lane: 0, z: 20, routeGuide: true },
      { id: 2, kind: 'micro', lane: 0, z: 21.2, routeGuide: true },
    ];
    const staged = [0, 1, 2].map((lane) => ({
      id: 10 + lane,
      kind: 'tall' as const,
      lane,
      z: 28,
    }));
    const horizon = [...micro, ...staged];
    const generator = new LevelGenerator(flatFlow, 1);
    generator.repairCarHorizon(horizon, [], 3, {
      obstacleIds: new Set(staged.map((obstacle) => obstacle.id)),
      rampIds: new Set(),
    });

    expect(horizon.filter((obstacle) => obstacle.kind === 'micro')).toEqual(micro);
    expect(horizon.filter((obstacle) => obstacle.kind === 'tall').length)
      .toBeLessThan(staged.length);
    const continuation = findComfortableCarRoute(
      horizon.filter((obstacle) => obstacle.z >= 20),
      flatFlow,
      [],
      {
        playerDistance: 20,
        playerSpeed: flatFlow.fairness.referenceSpeed,
        startLanes: [0],
      },
    );
    expect(continuation.passable).toBe(true);
  });

  it('preserves the incoming lane through a full conditional nitro row', () => {
    const flatFlow: LevelgenConfig = { ...config, laneFlow: [0, 0, 0, 0] };
    const challenge = Array.from({ length: config.lanes }, (_, lane) => ({
      id: 20 + lane,
      kind: 'low' as const,
      lane,
      z: config.minGapZ,
      nitroChallenge: true,
      nitroMandatory: true,
      challengeId: 9,
    }));
    const obstacles = [
      ...challenge,
      ...corridorRow(40, config.minGapZ * 2, 3),
    ];
    const result = findComfortableCarRoute(obstacles, flatFlow, [], {
      playerSpeed: flatFlow.fairness.referenceSpeed,
      startLanes: [0],
    });
    expect(result.passable).toBe(false);
  });

  it('certifies generated chunks from their actual chained entry lane', () => {
    for (let seed = 0; seed < 12; seed++) {
      const generator = new LevelGenerator(config, seed);
      let entryLane = startLane(config);
      for (const chunk of generator.generateUpTo(80)) {
        const chunkStartZ = config.contentStartZ + chunk.index * config.chunkLength;
        const result = findComfortableCarRoute(
          chunk.obstacles,
          config,
          chunk.ramps,
          {
            playerDistance: chunkStartZ,
            playerSpeed: config.fairness.referenceSpeed,
            startLanes: [entryLane],
          },
        );
        expect(result.passable, `seed ${seed}, chunk ${chunk.index}`).toBe(true);
        entryLane = result.route.at(-1)?.lane ?? entryLane;
      }
    }
  });

  it('uses most micro clusters as route guides without inflating count', () => {
    const guided = new LevelGenerator(config, 20260830);
    guided.setDestroyCarMode(true, game.destroy);
    const unguidedConfig: LevelgenConfig = {
      ...config,
      fairness: { ...config.fairness, routeGuideShare: 0 },
    };
    const unguided = new LevelGenerator(unguidedConfig, 20260830);
    unguided.setDestroyCarMode(true, game.destroy);
    const guidedObstacles = guided.generateUpTo(180).flatMap((chunk) => chunk.obstacles);
    const unguidedObstacles = unguided.generateUpTo(180).flatMap((chunk) => chunk.obstacles);
    const clusters = microClusters(
      guidedObstacles.filter((obstacle) => obstacle.rampGuideId === undefined),
    );
    const guidedClusters = clusters.filter((cluster) =>
      cluster.some((micro) => micro.routeGuide),
    );
    const guidedCount = guidedObstacles.filter((obstacle) => obstacle.kind === 'micro').length;
    const unguidedCount = unguidedObstacles.filter((obstacle) => obstacle.kind === 'micro').length;
    expect(clusters.length).toBeGreaterThan(100);
    expect(guidedClusters.length / clusters.length).toBeGreaterThanOrEqual(0.62);
    expect(guidedClusters.length / clusters.length).toBeLessThanOrEqual(0.92);
    expect(guidedCount).toBe(unguidedCount);
  });

  it('keeps generated micro clusters escapable while publishing staged chunks', () => {
    const flatFlow: LevelgenConfig = { ...config, laneFlow: [0, 0, 0, 0] };
    for (let seed = 0; seed < 4; seed++) {
      const generator = new LevelGenerator(flatFlow, seed);
      generator.setDestroyCarMode(true, game.destroy);
      let publishedObstacles: ObstacleEntity[] = [];
      let publishedRamps: Array<{ id: number; lane: number; z: number; gateId?: number }> = [];
      let entryLane = 1;
      for (let step = 0; step < 14; step++) {
        if (step > 0) {
          for (const obstacle of publishedObstacles) obstacle.z -= config.chunkLength;
          for (const ramp of publishedRamps) ramp.z -= config.chunkLength;
        }
        publishedObstacles = publishedObstacles.filter(
          (obstacle) => obstacle.z >= -config.chunkLength * config.segmentsBehind,
        );
        publishedRamps = publishedRamps.filter(
          (ramp) => ramp.z >= -config.chunkLength * config.segmentsBehind,
        );
        const distance = step * config.chunkLength;
        const target = step + config.segmentsAhead;
        const chunks = generator.generateUpTo(target);
        const stagedObstacles = chunks.flatMap((chunk) => chunk.obstacles);
        const stagedRamps = chunks.flatMap((chunk) => chunk.ramps);
        for (const obstacle of stagedObstacles) obstacle.z -= distance;
        for (const ramp of stagedRamps) ramp.z -= distance;
        const immutableIds = new Set(
          publishedObstacles.map((obstacle) => obstacle.id),
        );
        const horizonObstacles = [...publishedObstacles, ...stagedObstacles];
        const horizonRamps = [...publishedRamps, ...stagedRamps];
        const result = generator.repairCarHorizon(horizonObstacles, horizonRamps, entryLane, {
          obstacleIds: new Set(stagedObstacles.map((obstacle) => obstacle.id)),
          rampIds: new Set(stagedRamps.map((ramp) => ramp.id)),
        });
        if (result.passable) {
          entryLane = [...result.route]
            .reverse()
            .find((point) => point.z <= config.chunkLength)?.lane ?? entryLane;
        }
        expect(
          [...immutableIds].every((id) =>
            horizonObstacles.some((obstacle) => obstacle.id === id),
          ),
          `published IDs changed at seed ${seed}, step ${step}`,
        ).toBe(true);
        for (const cluster of microClusters(
          horizonObstacles.filter((obstacle) => obstacle.z >= config.contentStartZ),
        )) {
          const centerZ = cluster.reduce((sum, micro) => sum + micro.z, 0) /
            cluster.length;
          const continuation = findComfortableCarRoute(
            horizonObstacles.filter((obstacle) =>
              obstacle.z + Math.max(0, obstacle.zExtent ?? 0) / 2 >= centerZ,
            ),
            flatFlow,
            horizonRamps.filter((ramp) => ramp.z >= centerZ),
            {
              playerDistance: centerZ,
              playerSpeed: flatFlow.fairness.referenceSpeed,
              startLanes: [cluster[0].lane],
            },
          );
          expect(
            continuation.passable,
            `micro dead end at seed ${seed}, step ${step}, z ${centerZ}`,
          ).toBe(true);
          if (cluster.every((micro) => !immutableIds.has(micro.id))) {
            expect(
              cluster.every((micro) =>
                isReadableMicroPlacement(
                  horizonObstacles,
                  horizonRamps,
                  flatFlow,
                  micro.lane,
                  micro.z,
                  new Set(cluster),
                )
              ),
              `micro lead/escape at seed ${seed}, step ${step}, z ${centerZ}`,
            ).toBe(true);
          }
        }
        publishedObstacles = horizonObstacles;
        publishedRamps = horizonRamps;
      }
    }
  });

  it('keeps mandatory ramp micro guides attached to their ramp', () => {
    const generator = new LevelGenerator(config, 314159);
    generator.setDestroyCarMode(true, game.destroy);
    const chunks = generator.generateUpTo(240);
    const ramps = chunks.flatMap((chunk) => chunk.ramps).filter((ramp) =>
      ramp.gateId !== undefined,
    );
    const guides = chunks.flatMap((chunk) => chunk.obstacles).filter((obstacle) =>
      obstacle.kind === 'micro' && obstacle.routeGuide && obstacle.rampGuideId !== undefined,
    );
    expect(ramps.length).toBeGreaterThan(0);
    for (const ramp of ramps) {
      const attached = guides.filter((guide) => guide.rampGuideId === ramp.id);
      expect(attached.length, `ramp ${ramp.id}`).toBeGreaterThanOrEqual(
        config.fairness.mandatoryRampGuideClusters * 2,
      );
      expect(attached.every((guide) => guide.rampOffsetZ! < 0)).toBe(true);
    }
  });

  it('keeps generated destroy micros off blocking hazards and red-wall traps', () => {
    for (let seed = 0; seed < 6; seed++) {
      const generator = new LevelGenerator(config, seed);
      generator.setDestroyCarMode(true, game.destroy);
      const chunks = generator.generateUpTo(90);
      for (const chunk of chunks) {
        const clusters = microClusters(chunk.obstacles);
        for (const cluster of clusters) {
          for (const micro of cluster) {
            expect(
              isReadableMicroPlacement(
                chunk.obstacles,
                chunk.ramps,
                config,
                micro.lane,
                micro.z,
                new Set(cluster),
              ),
              `lead/escape seed ${seed} chunk ${chunk.index} micro ${micro.id}`,
            ).toBe(true);
            const continuation = findComfortableCarRoute(
              chunk.obstacles.filter((obstacle) =>
                obstacle.z + Math.max(0, obstacle.zExtent ?? 0) / 2 >= micro.z,
              ),
              config,
              chunk.ramps.filter((ramp) => ramp.z >= micro.z),
              {
                playerDistance: micro.z,
                playerSpeed: config.fairness.referenceSpeed,
                startLanes: [micro.lane],
              },
            );
            expect(
              continuation.passable,
              `dead-end seed ${seed} chunk ${chunk.index} micro ${micro.id}`,
            ).toBe(true);
          }
        }
      }
    }
  });
});

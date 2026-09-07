import { describe, expect, it } from 'vitest';
import levelgenRaw from '../../configs/levelgen.default.json';
import type { LevelgenConfig } from '@core/config/schemas';
import {
  isPassableAsCar,
  isPassableAsCarTemporal,
  isReadableMicroPlacement,
  laneBlockingLeadClear,
  occupiedRowsForObstacle,
  occupiedRowsWithCounterflowLinger,
} from '@core/levelgen/passability';
import { compactGroundObstacles } from '@core/levelgen/obstacleCompaction';
import type { ObstacleEntity } from '@core/levelgen/types';

const config = levelgenRaw as LevelgenConfig;

describe('isPassable zExtent occupancy', () => {
  it('counts compacted tall trucks on every row center inside the body', () => {
    const merged: ObstacleEntity = {
      id: 1,
      kind: 'tall',
      lane: 1,
      z: 2,
      zExtent: 5.712,
    };
    expect(occupiedRowsForObstacle(merged, 4).sort((a, b) => a - b)).toEqual([0, 1]);
    expect(occupiedRowsForObstacle({ id: 2, kind: 'tall', lane: 1, z: 0 }, 4)).toEqual([0]);
  });

  it('detects a return-to-lane dead-end that a single-row stamp would miss', () => {
    const obstacles: ObstacleEntity[] = [
      { id: 1, kind: 'tall', lane: 1, z: 2, zExtent: 5.712 },
      { id: 2, kind: 'tall', lane: 0, z: 0 },
      { id: 3, kind: 'tall', lane: 2, z: 0 },
      { id: 4, kind: 'tall', lane: 3, z: 0 },
    ];
    expect(isPassableAsCar(obstacles, config)).toEqual({
      passable: false,
      reason: 'tall-block',
    });
  });

  it('keeps a compacted same-lane pair passable when a side lane stays open', () => {
    const obstacles: ObstacleEntity[] = [
      { id: 1, kind: 'tall', lane: 0, z: 0 },
      { id: 2, kind: 'tall', lane: 0, z: 4 },
      { id: 3, kind: 'tall', lane: 2, z: 4 },
    ];
    compactGroundObstacles(obstacles, 4, {
      lowDepth: 2.32,
      tallDepth: 5.1,
      maxChainTall: 2,
      maxChainLow: 2,
    });
    const merged = obstacles.find((o) => o.zExtent !== undefined);
    expect(merged).toBeDefined();
    expect(isPassableAsCar(obstacles, config)).toEqual({
      passable: true,
      reason: 'ok',
    });
  });

  it('extends counterflow lane occupancy toward the player for temporal fairness', () => {
    const rows = occupiedRowsWithCounterflowLinger(
      { id: 1, kind: 'tall', lane: 1, z: 8 },
      4,
      config.laneFlow,
      config.multiLaneFlowFactor,
      config.counterflowPassabilityLingerSeconds,
    );
    expect(rows).toContain(1);

    const withoutLinger = isPassableAsCar(
      [
        { id: 1, kind: 'tall', lane: 1, z: 8 },
        { id: 2, kind: 'tall', lane: 2, z: 4 },
        { id: 3, kind: 'tall', lane: 0, z: 4 },
        { id: 4, kind: 'tall', lane: 3, z: 4 },
        { id: 5, kind: 'tall', lane: 0, z: 0 },
        { id: 6, kind: 'tall', lane: 3, z: 0 },
      ],
      { ...config, counterflowPassabilityLingerSeconds: 0 },
    );
    expect(withoutLinger.passable).toBe(true);

    const withLinger = isPassableAsCarTemporal(
      [
        { id: 1, kind: 'tall', lane: 1, z: 8 },
        { id: 2, kind: 'tall', lane: 2, z: 4 },
        { id: 3, kind: 'tall', lane: 0, z: 4 },
        { id: 4, kind: 'tall', lane: 3, z: 4 },
        { id: 5, kind: 'tall', lane: 0, z: 0 },
        { id: 6, kind: 'tall', lane: 3, z: 0 },
      ],
      config,
    );
    expect(withLinger.passable).toBe(false);
  });
});

describe('readable destroy micro placement', () => {
  const minLeadZ = config.minGapZ * config.fairness.microLeadMinGapZScale;

  it('rejects a same-lane blocking tall closer than the lead gap', () => {
    const tall: ObstacleEntity = { id: 1, kind: 'tall', lane: 1, z: 24 };
    expect(laneBlockingLeadClear([tall], 1, 24 - config.minGapZ, minLeadZ)).toBe(
      false,
    );
    expect(
      laneBlockingLeadClear([tall], 1, 24 - minLeadZ + 0.01, minLeadZ),
    ).toBe(false);
    expect(laneBlockingLeadClear([tall], 1, 24 - minLeadZ, minLeadZ)).toBe(true);
  });

  it('allows micro on the ramp lane or an adjacent escape before a red wall', () => {
    const wallZ = 40;
    const wall = [0, 1, 2, 3].map((lane) => ({
      id: lane + 1,
      kind: 'tall' as const,
      lane,
      z: wallZ,
      redWall: true,
      gateId: 7,
    }));
    const rampZ = wallZ - config.rampLeadRows * config.minGapZ;
    const ramps = [{ id: 20, lane: 2, z: rampZ, gateId: 7 }];
    const approachZ = rampZ - config.minGapZ;
    expect(isReadableMicroPlacement(wall, ramps, config, 2, approachZ)).toBe(true);
    expect(isReadableMicroPlacement(wall, ramps, config, 1, approachZ)).toBe(true);
    expect(isReadableMicroPlacement(wall, ramps, config, 0, approachZ)).toBe(false);
  });
});

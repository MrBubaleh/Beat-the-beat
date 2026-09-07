import { describe, expect, it } from 'vitest';
import levelgenRaw from '../../configs/levelgen.default.json';
import type { LevelgenConfig } from '@core/config/schemas';
import { LevelGenerator } from '@core/levelgen/LevelGenerator';
import { isPassable } from '@core/levelgen/passability';
import type { ObstacleEntity, RampEntity } from '@core/levelgen/types';

function collect(chunks: ReturnType<LevelGenerator['generateUpTo']>): {
  obstacles: ObstacleEntity[];
  ramps: RampEntity[];
} {
  const obstacles: ObstacleEntity[] = [];
  const ramps: RampEntity[] = [];
  for (const chunk of chunks) {
    obstacles.push(...chunk.obstacles);
    ramps.push(...chunk.ramps);
  }
  return { obstacles, ramps };
}

describe('LevelGenerator', () => {
  const config = levelgenRaw as LevelgenConfig;

  it('is deterministic for the same seed', () => {
    const a = new LevelGenerator(config, 42);
    a.setDensityMultiplier(0.4);
    const b = new LevelGenerator(config, 42);
    b.setDensityMultiplier(0.4);
    const chunksA = a.generateUpTo(30);
    const chunksB = b.generateUpTo(30);
    expect(chunksA.map((c) => JSON.stringify(c.obstacles))).toEqual(
      chunksB.map((c) => JSON.stringify(c.obstacles)),
    );
    expect(chunksA.map((c) => JSON.stringify(c.coins))).toEqual(
      chunksB.map((c) => JSON.stringify(c.coins)),
    );
  });

  it('can place free ramps from the first row and respects their minimum gap', () => {
    const earlyRampConfig: LevelgenConfig = {
      ...config,
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      rampProbability: 0,
      earlyRampProbability: 1,
      earlyRampRows: 7,
      rampMinGapRows: 3,
      redWallProbability: 0,
    };
    const generator = new LevelGenerator(earlyRampConfig, 42);
    const ramps = generator.generateChunk(0).ramps.sort((a, b) => a.z - b.z);
    expect(ramps[0].z).toBe(earlyRampConfig.contentStartZ);
    for (let i = 1; i < ramps.length; i++) {
      expect(ramps[i].z - ramps[i - 1].z).toBeGreaterThanOrEqual(
        earlyRampConfig.rampMinGapRows * earlyRampConfig.minGapZ,
      );
    }
  });

  it('generates linked red-wall ramps more often than standalone ramps', () => {
    const generator = new LevelGenerator(config, 2026);
    const ramps = generator.generateUpTo(1000).flatMap((chunk) => chunk.ramps);
    const linked = ramps.filter((ramp) => ramp.gateId !== undefined).length;
    const standalone = ramps.filter((ramp) => ramp.gateId === undefined).length;
    expect(linked).toBeGreaterThan(standalone);
  });

  it('keeps base difficulty separate from musical density and coin frequency', () => {
    const generator = new LevelGenerator(config, 42);
    generator.setMusicDensityIntent(0.1);
    const calmDensity = generator.effectiveDensity;
    generator.setMusicDensityIntent(0.9);
    const peakDensity = generator.effectiveDensity;
    expect(calmDensity).toBeLessThan(config.baseDensity);
    expect(peakDensity).toBeGreaterThan(config.baseDensity);

    generator.setCoinFrequencyIntent(0.2);
    const sparseCoins = generator.effectiveCoinFrequency;
    generator.setCoinFrequencyIntent(0.8);
    expect(generator.effectiveCoinFrequency).toBeGreaterThan(sparseCoins);
  });

  it('materially changes generated coin count from the coin-frequency intent', () => {
    const sparse = new LevelGenerator(config, 77);
    sparse.setCoinFrequencyIntent(0.2);
    const sparseCount = sparse
      .generateUpTo(500)
      .reduce((sum, chunk) => sum + chunk.coins.length, 0);
    const rich = new LevelGenerator(config, 77);
    rich.setCoinFrequencyIntent(0.8);
    const richCount = rich
      .generateUpTo(500)
      .reduce((sum, chunk) => sum + chunk.coins.length, 0);
    expect(richCount).toBeGreaterThan(sparseCount * 1.5);
  });

  it('generates substantially fewer coins while nitro is active', () => {
    const isolatedConfig: LevelgenConfig = {
      ...config,
      nitroWallProbability: 0,
      redWallProbability: 0,
      rampProbability: 0,
      earlyRampProbability: 0,
    };
    const normal = new LevelGenerator(isolatedConfig, 91);
    const normalCoins = normal
      .generateUpTo(500)
      .reduce((sum, chunk) => sum + chunk.coins.length, 0);
    const nitro = new LevelGenerator(isolatedConfig, 91);
    nitro.setNitroActive(true);
    const nitroCoins = nitro
      .generateUpTo(500)
      .reduce((sum, chunk) => sum + chunk.coins.length, 0);
    expect(nitroCoins).toBeLessThan(normalCoins * 0.55);
  });

  it('keeps the normal tall-obstacle share near the configured red-object bias', () => {
    const obstacleConfig: LevelgenConfig = {
      ...config,
      segmentWeights: { obstacle: 1, coins: 0, bonus: 0, empty: 0 },
      nitroWallProbability: 0,
      redWallProbability: 0,
      rampProbability: 0,
      earlyRampProbability: 0,
    };
    const generator = new LevelGenerator(obstacleConfig, 55);
    generator.setDensityMultiplier(0.8);
    const obstacles = generator
      .generateUpTo(500)
      .flatMap((chunk) => chunk.obstacles);
    const tallShare = obstacles.filter((obstacle) => obstacle.kind === 'tall').length /
      obstacles.length;
    expect(tallShare).toBeGreaterThan(0.29);
    expect(tallShare).toBeLessThan(0.41);
  });

  it('keeps every z-row passable and obstacles min-gapped over 1100 chunks', () => {
    const generator = new LevelGenerator(config, 1234);
    generator.setDensityMultiplier(0.4);
    const chunks = generator.generateUpTo(1100);
    expect(chunks.length).toBe(1101);

    const allObstacles: ObstacleEntity[] = [];
    for (const chunk of chunks) {
      allObstacles.push(...chunk.obstacles);
    }

    const byRow = new Map<number, ObstacleEntity[]>();
    for (const obstacle of allObstacles) {
      const row = Math.round(obstacle.z / config.minGapZ);
      const list = byRow.get(row) ?? [];
      list.push(obstacle);
      byRow.set(row, list);
    }

    for (const rowObstacles of byRow.values()) {
      if (rowObstacles.length < config.lanes) continue;
      const allLow = rowObstacles.every((o) => o.kind === 'low');
      const allRedWall = rowObstacles.every((o) => o.kind === 'tall' && o.redWall === true);
      expect(allLow || allRedWall).toBe(true);
    }

    for (let lane = 0; lane < config.lanes; lane++) {
      const laneObstacles = allObstacles
        .filter((o) => o.lane === lane)
        .sort((x, y) => x.z - y.z);
      for (let i = 1; i < laneObstacles.length; i++) {
        expect(laneObstacles[i].z - laneObstacles[i - 1].z).toBeGreaterThanOrEqual(
          config.minGapZ,
        );
      }
    }
  });

  it('never produces a dead-end (reachable lane set stays non-empty)', () => {
    const generator = new LevelGenerator(config, 7);
    generator.setDensityMultiplier(0.4);
    const chunks = generator.generateUpTo(1100);

    const { obstacles, ramps } = collect(chunks);
    expect(isPassable(obstacles, config, ramps)).toEqual({
      passable: true,
      reason: 'ok',
    });
  });

  it('isPassable holds across many seeds and chunks', () => {
    for (let seed = 0; seed < 40; seed++) {
      const generator = new LevelGenerator(config, seed);
      generator.setDensityMultiplier(0.4);
      const chunks = generator.generateUpTo(300);
      const { obstacles, ramps } = collect(chunks);
      expect(isPassable(obstacles, config, ramps), `seed ${seed}`).toEqual({
        passable: true,
        reason: 'ok',
      });
    }
  });

  it('never places walls closer than minWallGapRows', () => {
    const generator = new LevelGenerator(config, 99);
    generator.setDensityMultiplier(0.9);
    const chunks = generator.generateUpTo(1100);

    const allObstacles: ObstacleEntity[] = [];
    for (const chunk of chunks) {
      allObstacles.push(...chunk.obstacles);
    }

    const byRow = new Map<number, ObstacleEntity[]>();
    for (const obstacle of allObstacles) {
      const row = Math.round(obstacle.z / config.minGapZ);
      const list = byRow.get(row) ?? [];
      list.push(obstacle);
      byRow.set(row, list);
    }

    const wallRows = [...byRow.entries()]
      .filter(([, list]) => list.length >= config.lanes)
      .map(([row]) => row)
      .sort((a, b) => a - b);
    for (let i = 1; i < wallRows.length; i++) {
      expect(wallRows[i] - wallRows[i - 1]).toBeGreaterThanOrEqual(config.minWallGapRows);
    }
  });

  it('produces red walls and gives each one a linked ramp within rampLeadRows before it', () => {
    const generator = new LevelGenerator(config, 1234);
    generator.setDensityMultiplier(0.4);
    const chunks = generator.generateUpTo(1100);
    const { obstacles, ramps } = collect(chunks);

    const byRow = new Map<number, ObstacleEntity[]>();
    for (const obstacle of obstacles) {
      const row = Math.round(obstacle.z / config.minGapZ);
      const list = byRow.get(row) ?? [];
      list.push(obstacle);
      byRow.set(row, list);
    }
    const rampsByRow = new Map<number, RampEntity[]>();
    for (const ramp of ramps) {
      const row = Math.round(ramp.z / config.minGapZ);
      const list = rampsByRow.get(row) ?? [];
      list.push(ramp);
      rampsByRow.set(row, list);
    }

    const redWallRows = [...byRow.entries()].filter(
      ([, list]) =>
        list.length >= config.lanes && list.every((o) => o.kind === 'tall' && o.redWall),
    );
    expect(redWallRows.length).toBeGreaterThan(0);

    for (const [row, wall] of redWallRows) {
      const gateIds = new Set(wall.map((o) => o.gateId));
      expect(gateIds.size).toBe(1);
      const rampRows = Array.from({ length: config.rampLeadRows }, (_, i) => row - 1 - i);
      expect(
        rampRows.some((r) =>
          (rampsByRow.get(r) ?? []).some((ramp) => gateIds.has(ramp.gateId)),
        ),
        `red wall at row ${row} needs a ramp`,
      ).toBe(true);
    }
  });

  it('every ramp sits on a row with no obstacle on the same lane', () => {
    const generator = new LevelGenerator(config, 1234);
    generator.setDensityMultiplier(0.4);
    const chunks = generator.generateUpTo(1100);
    const { obstacles, ramps } = collect(chunks);

    const byRowLane = new Map<string, ObstacleEntity[]>();
    for (const obstacle of obstacles) {
      const row = Math.round(obstacle.z / config.minGapZ);
      const key = `${row}:${obstacle.lane}`;
      const list = byRowLane.get(key) ?? [];
      list.push(obstacle);
      byRowLane.set(key, list);
    }

    for (const ramp of ramps) {
      const row = Math.round(ramp.z / config.minGapZ);
      const key = `${row}:${ramp.lane}`;
      expect(byRowLane.get(key) ?? [], `ramp at row ${row} lane ${ramp.lane}`).toEqual([]);
    }
  });

  it('a red wall is impassable without a preceding ramp and passable with one', () => {
    const lanes = Array.from({ length: config.lanes }, (_, i) => i);
    const wallRow = config.rampLeadRows;
    const wall: ObstacleEntity[] = lanes.map((lane) => ({
      id: lane + 1,
      kind: 'tall',
      lane,
      z: wallRow * config.minGapZ,
      redWall: true,
    }));

    expect(isPassable(wall, config)).toEqual({ passable: false, reason: 'tall-block' });

    const ramp: RampEntity = {
      id: 100,
      lane: 1,
      z: (wallRow - 1) * config.minGapZ,
    };
    expect(isPassable(wall, config, [ramp])).toEqual({ passable: true, reason: 'ok' });
  });

  it('places more sparse challenge obstacles while nitro is active', () => {
    const nitroCfg = { ...config, nitroWallProbability: 1 };
    const on = new LevelGenerator(nitroCfg, 42);
    on.setDensityMultiplier(0.4);
    on.setNitroActive(true);
    const off = new LevelGenerator(nitroCfg, 42);
    off.setDensityMultiplier(0.4);

    const countChallenges = (g: LevelGenerator): number =>
      g.generateUpTo(200).reduce(
        (sum, chunk) => sum + chunk.obstacles.filter((o) => o.nitroChallenge).length,
        0,
      );

    expect(countChallenges(on)).toBeGreaterThan(countChallenges(off));
  });

  it('occasionally creates full smashable rows while nitro is active', () => {
    const activeCfg = {
      ...config,
      nitroWallProbability: 1,
      nitroActiveFullRowProbability: 1,
      nitroChallengeCooldownRows: 1,
      redWallProbability: 0,
      rampProbability: 0,
    };
    const generator = new LevelGenerator(activeCfg, 18);
    generator.setNitroActive(true);
    const chunks = generator.generateUpTo(50);
    const byChallenge = new Map<number, ObstacleEntity[]>();
    for (const obstacle of chunks.flatMap((chunk) => chunk.obstacles)) {
      if (obstacle.challengeId === undefined) continue;
      const list = byChallenge.get(obstacle.challengeId) ?? [];
      list.push(obstacle);
      byChallenge.set(obstacle.challengeId, list);
    }
    expect(
      [...byChallenge.values()].some(
        (row) =>
          row.length === config.lanes &&
          row.every((obstacle) => obstacle.kind === 'low'),
      ),
    ).toBe(true);
  });

  it('keeps grand full-row smashes frequent but not constant during nitro', () => {
    const generator = new LevelGenerator(config, 20260814);
    generator.setNitroActive(true);
    const byChallenge = new Map<number, ObstacleEntity[]>();
    for (const obstacle of generator.generateUpTo(600).flatMap((chunk) => chunk.obstacles)) {
      if (obstacle.challengeId === undefined) continue;
      const row = byChallenge.get(obstacle.challengeId) ?? [];
      row.push(obstacle);
      byChallenge.set(obstacle.challengeId, row);
    }

    const rows = [...byChallenge.values()];
    const fullRows = rows.filter(
      (row) => row.length === config.lanes && row.every((obstacle) => obstacle.kind === 'low'),
    );
    const fullRowShare = fullRows.length / rows.length;

    expect(rows.length).toBeGreaterThan(100);
    expect(fullRowShare).toBeGreaterThan(0.35);
    expect(fullRowShare).toBeLessThan(0.52);
  });

  it('occasionally creates avoidable challenges when nitro is full', () => {
    const readyCfg = {
      ...config,
      nitroReadyChallengeProbability: 1,
      nitroReadyMandatoryProbability: 0,
    };
    const generator = new LevelGenerator(readyCfg, 77);
    generator.setNitroReady(true);
    const chunks = generator.generateUpTo(100);
    const challengeRows = new Map<number, ObstacleEntity[]>();
    for (const chunk of chunks) {
      for (const obstacle of chunk.obstacles.filter((o) => o.nitroChallenge)) {
        const row = Math.round(obstacle.z / config.minGapZ);
        const list = challengeRows.get(row) ?? [];
        list.push(obstacle);
        challengeRows.set(row, list);
      }
    }
    expect(challengeRows.size).toBeGreaterThan(0);
    for (const row of challengeRows.values()) {
      expect(row.length).toBeGreaterThanOrEqual(2);
      expect(row.length).toBeLessThan(config.lanes);
    }
  });

  it('keeps mandatory ready-nitro challenges marked and passable across seeds', () => {
    const readyCfg = {
      ...config,
      nitroReadyChallengeProbability: 0.7,
      nitroReadyMandatoryProbability: 0.5,
    };
    for (let seed = 0; seed < 20; seed++) {
      const generator = new LevelGenerator(readyCfg, seed);
      generator.setNitroReady(true);
      const chunks = generator.generateUpTo(200);
      const { obstacles, ramps } = collect(chunks);
      const mandatory = obstacles.filter((obstacle) => obstacle.nitroMandatory);
      expect(mandatory.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(mandatory.every((obstacle) => obstacle.nitroChallenge)).toBe(true);
      expect(isPassable(obstacles, readyCfg, ramps), `seed ${seed}`).toEqual({
        passable: true,
        reason: 'ok',
      });
    }
  });

  it('nitro walls keep every row passable across many seeds', () => {
    for (let seed = 0; seed < 20; seed++) {
      const generator = new LevelGenerator(config, seed);
      generator.setDensityMultiplier(0.4);
      generator.setNitroActive(true);
      const chunks = generator.generateUpTo(300);
      const { obstacles, ramps } = collect(chunks);
      expect(isPassable(obstacles, config, ramps), `seed ${seed}`).toEqual({
        passable: true,
        reason: 'ok',
      });
    }
  });

  it('nitro walls still respect minWallGapRows', () => {
    const generator = new LevelGenerator(config, 99);
    generator.setDensityMultiplier(0.9);
    generator.setNitroActive(true);
    const chunks = generator.generateUpTo(1100);

    const allObstacles: ObstacleEntity[] = [];
    for (const chunk of chunks) allObstacles.push(...chunk.obstacles);

    const byRow = new Map<number, ObstacleEntity[]>();
    for (const obstacle of allObstacles) {
      const row = Math.round(obstacle.z / config.minGapZ);
      const list = byRow.get(row) ?? [];
      list.push(obstacle);
      byRow.set(row, list);
    }

    const wallRows = [...byRow.entries()]
      .filter(([, list]) => list.length >= config.lanes)
      .map(([row]) => row)
      .sort((a, b) => a - b);
    for (let i = 1; i < wallRows.length; i++) {
      expect(wallRows[i] - wallRows[i - 1]).toBeGreaterThanOrEqual(config.minWallGapRows);
    }
  });

  it('produces more dodges than forced jumps', () => {
    const generator = new LevelGenerator(config, 2024);
    generator.setDensityMultiplier(0.4);
    const chunks = generator.generateUpTo(500);

    const allObstacles: ObstacleEntity[] = [];
    for (const chunk of chunks) allObstacles.push(...chunk.obstacles);

    const byRow = new Map<number, ObstacleEntity[]>();
    for (const obstacle of allObstacles) {
      const row = Math.round(obstacle.z / config.minGapZ);
      const list = byRow.get(row) ?? [];
      list.push(obstacle);
      byRow.set(row, list);
    }

    let jumps = 0;
    let dodges = 0;
    for (const list of byRow.values()) {
      if (list.length >= config.lanes) jumps++;
      else if (list.length > 0) dodges++;
    }
    expect(jumps).toBeGreaterThan(0);
    expect(jumps).toBeLessThan(dodges);
  });

  it('obstacle density scales with the density multiplier', () => {
    const sparse = new LevelGenerator(config, 5);
    sparse.setDensityMultiplier(0.1);
    const dense = new LevelGenerator(config, 5);
    dense.setDensityMultiplier(0.9);
    const count = (g: LevelGenerator): number =>
      g.generateUpTo(40).reduce((sum, c) => sum + c.obstacles.length, 0);
    expect(count(dense)).toBeGreaterThan(count(sparse));
  });

  it('biases obstacles and coins toward the risk lanes', () => {
    const generator = new LevelGenerator(config, 2024);
    generator.setDensityMultiplier(0.4);
    const chunks = generator.generateUpTo(2000);

    const obstaclesByLane = new Array<number>(config.lanes).fill(0);
    const coinsByLane = new Array<number>(config.lanes).fill(0);
    for (const chunk of chunks) {
      for (const o of chunk.obstacles) obstaclesByLane[o.lane]++;
      for (const c of chunk.coins) coinsByLane[c.lane]++;
    }

    const allLanes = Array.from({ length: config.lanes }, (_, i) => i);
    const riskLanes = config.riskZone.riskLanes;
    const safeLanes = allLanes.filter((lane) => !riskLanes.includes(lane));
    const perLaneAverage = (lanes: number[]): number =>
      lanes.reduce((sum, lane) => sum + obstaclesByLane[lane], 0) / lanes.length;
    const perLaneCoinAverage = (lanes: number[]): number =>
      lanes.reduce((sum, lane) => sum + coinsByLane[lane], 0) / lanes.length;

    const riskObstacles = perLaneAverage(riskLanes);
    const safeObstacles = perLaneAverage(safeLanes);
    const riskCoins = perLaneCoinAverage(riskLanes);
    const safeCoins = perLaneCoinAverage(safeLanes);

    expect(riskObstacles).toBeGreaterThan(safeObstacles * 1.15);
    // Certified safeGuide routes now take precedence over the old global coin bias;
    // riskChoice coins must still make the risk lane materially more rewarding.
    expect(riskCoins).toBeGreaterThan(safeCoins * 1.3);
    expect(safeLanes.length).toBeGreaterThan(0);
  });

  it('adds more early obstacles to the oncoming lane and shoulders', () => {
    const isolated: LevelgenConfig = {
      ...config,
      segmentWeights: { obstacle: 1, coins: 0, bonus: 0, empty: 0 },
      wallProbability: 0,
      redWallProbability: 0,
      nitroWallProbability: 0,
      rampProbability: 0,
      earlyRampProbability: 0,
    };
    const withoutEarly: LevelgenConfig = {
      ...isolated,
      earlyTraffic: { ...isolated.earlyTraffic, rows: 0 },
    };
    let boostedTargetCount = 0;
    let normalTargetCount = 0;
    let boostedTotal = 0;
    let normalTotal = 0;
    for (let seed = 0; seed < 100; seed++) {
      const boosted = new LevelGenerator(isolated, seed)
        .generateUpTo(3)
        .flatMap((chunk) => chunk.obstacles);
      const normal = new LevelGenerator(withoutEarly, seed)
        .generateUpTo(3)
        .flatMap((chunk) => chunk.obstacles);
      boostedTargetCount += boosted.filter((obstacle) =>
        isolated.earlyTraffic.lanes.includes(obstacle.lane)).length;
      normalTargetCount += normal.filter((obstacle) =>
        isolated.earlyTraffic.lanes.includes(obstacle.lane)).length;
      boostedTotal += boosted.length;
      normalTotal += normal.length;
    }
    expect(boostedTargetCount).toBeGreaterThan(normalTargetCount * 1.1);
    expect(boostedTotal).toBeGreaterThan(normalTotal * 1.05);
  });

  it('never spawns more than two consecutive tall rows in one lane before compaction', () => {
    const generator = new LevelGenerator(config, 4242);
    generator.setDensityMultiplier(0.75);
    const minGapZ = config.minGapZ;
    for (const chunk of generator.generateUpTo(60)) {
      const byLane = new Map<number, number[]>();
      for (const obstacle of chunk.obstacles) {
        if (
          obstacle.kind !== 'tall' ||
          obstacle.redWall ||
          obstacle.nitroChallenge ||
          obstacle.trainId !== undefined
        ) {
          continue;
        }
        const row = Math.round(obstacle.z / minGapZ);
        const rows = byLane.get(obstacle.lane) ?? [];
        rows.push(row);
        byLane.set(obstacle.lane, rows);
      }
      for (const rows of byLane.values()) {
        rows.sort((a, b) => a - b);
        let streak = 1;
        for (let i = 1; i < rows.length; i++) {
          if (rows[i] === rows[i - 1] + 1) {
            streak += 1;
            expect(streak).toBeLessThanOrEqual(2);
          } else {
            streak = 1;
          }
        }
      }
    }
  });

  it('does not place ground coins inside the same lane and row as an obstacle', () => {
    const generator = new LevelGenerator(config, 11);
    generator.setDensityMultiplier(0.8);
    const zTol = config.minGapZ * 0.5;
    const jumpY = config.horse.jumpCoinHeight;
    for (const chunk of generator.generateUpTo(40)) {
      for (const coin of chunk.coins) {
        if ((coin.y ?? config.coinHeight) >= jumpY - 0.2) continue;
        expect(
          chunk.obstacles.some(
            (obstacle) =>
              obstacle.lane === coin.lane && Math.abs(obstacle.z - coin.z) < zTol,
          ),
        ).toBe(false);
      }
    }
  });
});

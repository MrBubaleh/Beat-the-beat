import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import { GameSim } from '@core/gameplay/GameSim';
import { buildIntroHook, introHookVariant } from '@core/gameplay/levelIntroHook';
import { PassthroughDirector } from '@core/director/PassthroughDirector';
import { emptyMusic } from './musicHelpers';

const game = gameRaw as GameConfig;
const levelgen = levelgenRaw as LevelgenConfig;

function hook(seed: number, destroy = false) {
  return buildIntroHook({
    startLane: 1,
    lanes: 4,
    speed: 12,
    goDistance: 20,
    seed,
    destroy,
    coinHeight: 0.6,
    laneFlow: [0, 0, 0, 0],
  });
}

function makeSimWithFlows(seed: number): GameSim {
  const flowsLevelgen: LevelgenConfig = {
    ...levelgen,
    segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
    redWallProbability: 0,
    rampProbability: 0,
    earlyRampProbability: 0,
    nitroWallProbability: 0,
  };
  return new GameSim({
    game,
    levelgen: flowsLevelgen,
    director: new PassthroughDirector(directorRaw as DirectorConfig),
    consumeInput: () => [],
    nowMs: () => 0,
    getMusic: () => emptyMusic(),
    seed,
  });
}

describe('level intro hook', () => {
  it('walks the tempo buckets: track, choice, obstacle, combo, reward', () => {
    const { coins, obstacles } = hook(7);
    // Приезд с учётом потока (в тесте нулевой): то же самое время для всех.
    const arrival = (z: number): number => (z - 20) / 12;
    const coinTimes = coins.map((c) => arrival(c.z)).sort((a, b) => a - b);
    // Дорожка 0.5–2.5 с в стартовой полосе.
    expect(coinTimes.filter((t) => t >= 0.5 && t <= 2.5).length).toBeGreaterThanOrEqual(5);
    expect(coins.filter((c) => arrival(c.z) <= 2.6).every((c) => c.lane === 1)).toBe(true);
    // Выбор полосы 4.9–6.9 с — уже не стартовая (зазор под высокие скорости).
    const choice = coins.filter((c) => {
      const t = arrival(c.z);
      return t >= 4.9 && t <= 6.9;
    });
    expect(choice.length).toBeGreaterThanOrEqual(4);
    expect(choice.every((c) => c.lane !== 1)).toBe(true);
    // Одно препятствие около 8.3 с, уворот в 11 с, награда 12+ с.
    const hazards = obstacles.filter((o) => o.kind === 'low');
    expect(hazards.length).toBe(2);
    expect(hazards.every((o) => o.musicTarget?.role === 'dodge')).toBe(true);
    const reward = coins.filter((c) => arrival(c.z) > 12);
    expect(reward.length).toBeGreaterThanOrEqual(4);
  });

  it('varies the shape by seed and stays deterministic', () => {
    const lanesOf = (seed: number): string =>
      hook(seed).coins.map((c) => c.lane).join(',');
    expect(lanesOf(7)).toBe(lanesOf(7));
    const variants = new Set([1, 2, 3, 4, 5].map((s) => introHookVariant(s)));
    expect(variants.size).toBeGreaterThan(1);
    expect(lanesOf(1)).not.toBe(lanesOf(2));
  });

  it('spawns smashable micros instead of coins in destroy', () => {
    const content = hook(7, true);
    expect(content.coins).toHaveLength(0);
    expect(content.obstacles.filter((o) => o.kind === 'micro').length).toBeGreaterThanOrEqual(8);
    expect(content.obstacles.filter((o) => o.kind === 'low').length).toBe(2);
  });

  it('certifies with real lane flows (no cross-lane row merges)', () => {
    // Та же сертификация, что в GameSim: маршрут + конверт + окно выбора.
    // Проходим через beginLevelIntro с боевым конфигом levelgen.
    const sim = makeSimWithFlows(99);
    sim.beginLevelIntro();
    const snap = sim.getSnapshot();
    expect(snap.obstacles.filter((o) => o.kind === 'low' && o.id < 0).length).toBe(2);
    expect(snap.coins.filter((c) => c.id < -40000).length).toBeGreaterThanOrEqual(10);
  });
});

describe('intro hook in GameSim', () => {
  function makeSim(seed: number): GameSim {
    const emptyLevelgen: LevelgenConfig = {
      ...levelgen,
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      redWallProbability: 0,
      rampProbability: 0,
      earlyRampProbability: 0,
      nitroWallProbability: 0,
      laneFlow: [0, 0, 0, 0],
    };
    return new GameSim({
      game,
      levelgen: emptyLevelgen,
      director: new PassthroughDirector(directorRaw as DirectorConfig),
      consumeInput: () => [],
      nowMs: () => 0,
      getMusic: () => emptyMusic(),
      seed,
    });
  }

  it('publishes a certified hook on beginLevelIntro', () => {
    const sim = makeSim(99);
    sim.beginLevelIntro();
    const snap = sim.getSnapshot();
    // 2 крючка (id<0) + 1 legacy-интро obstacle от не-ритм пути.
    expect(snap.obstacles.filter((o) => o.kind === 'low' && o.id < 0).length).toBe(2);
    expect(snap.coins.length).toBeGreaterThanOrEqual(10);
    expect(
      [...snap.coins, ...snap.obstacles.filter((o) => o.id < 0)].every(
        (e) => e.musicTarget?.confidence === 1,
      ),
    ).toBe(true);
  });

  it('is deterministic per seed and varies across seeds', () => {
    const a = makeSim(11);
    a.beginLevelIntro();
    const b = makeSim(11);
    b.beginLevelIntro();
    const key = (sim: GameSim): string =>
      sim.getSnapshot().coins.map((c) => `${c.lane}:${c.z.toFixed(2)}`).join(',');
    expect(key(a)).toBe(key(b));
    const c = makeSim(12);
    c.beginLevelIntro();
    expect(key(c)).not.toBe(key(a));
  });

  it('pre-generates the world during countdown in rhythm mode (no pop-in at GO)', () => {
    const rhythmLevelgen: LevelgenConfig = {
      ...levelgen,
      laneFlow: [0, 0, 0, 0],
    };
    const sim = new GameSim({
      game,
      levelgen: rhythmLevelgen,
      director: new PassthroughDirector(directorRaw as DirectorConfig),
      consumeInput: () => [],
      nowMs: () => 0,
      getMusic: () => emptyMusic(),
      musicPlanningEnabled: true,
      seed: 2024,
    });
    sim.beginLevelIntro();
    // Середина отсчёта, прогноза ещё нет: крючок рядом едет навстречу,
    // чанки предгенерируются (дальнее сертифицированное доезжает само).
    for (let frame = 0; frame < 100; frame++) sim.fixedUpdate(1 / 60);
    expect(sim.isLevelIntroActive()).toBe(true);
    const before = sim.getSnapshot();
    const nearHook = before.coins.filter((c) => c.z > 0 && c.z < 60);
    expect(nearHook.length).toBeGreaterThan(0);
    expect(before.obstacles.filter((o) => o.id < 0).length).toBe(2);
    // GO: ничего не появляется из воздуха — всё уже было опубликовано.
    const idsBefore = new Set(before.obstacles.map((o) => o.id));
    for (let frame = 0; frame < 120; frame++) sim.fixedUpdate(1 / 60);
    expect(sim.isLevelIntroActive()).toBe(false);
    const after = sim.getSnapshot();
    const popped = after.obstacles.filter((o) => o.z > 0 && o.z < 12 && !idsBefore.has(o.id));
    expect(popped).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import type { PlayerAction } from '@core/gameplay/actions';
import { GameSim } from '@core/gameplay/GameSim';
import { planRocketLanding } from '@core/gameplay/rocketLanding';
import type { RocketLandingRequest } from '@core/gameplay/rocketLanding';
import type { ObstacleEntity } from '@core/levelgen/types';
import { PassthroughDirector } from '@core/director/PassthroughDirector';
import { emptyMusic, withoutRocketSpawn } from './musicHelpers';

const game = withoutRocketSpawn(gameRaw as GameConfig);
const levelgen = levelgenRaw as LevelgenConfig;

function request(
  obstacles: ObstacleEntity[],
  lane: number,
  baseDistance = 300,
  returnSpeed = 28,
): RocketLandingRequest {
  return {
    baseDistance,
    returnSpeed,
    cruiseBoost: game.rocket.speedBoost,
    lane,
    obstacles,
    ramps: [],
    config: levelgen,
    game,
  };
}

function tallRow(ids: number, z: number, lanes: number[]): ObstacleEntity[] {
  return lanes.map((lane, index) => ({
    id: ids + index,
    kind: 'tall' as const,
    lane,
    z,
  }));
}

describe('rocket landing planner', () => {
  it('keeps the base timing when the landing window is free', () => {
    const plan = planRocketLanding(request([], 1));
    expect(plan).toEqual({ adjustSeconds: 0, landingLane: 1, fallback: false });
  });

  it('extends the flight to the nearest certified window', () => {
    // Базовая точка и ближние кандидаты заняты во всех полосах.
    const obstacles: ObstacleEntity[] = [];
    for (let z = 280; z <= 340; z += 4) {
      obstacles.push(...tallRow(1000 + z, z, [0, 1, 2, 3]));
    }
    const plan = planRocketLanding(request(obstacles, 1));
    expect(plan.fallback).toBe(false);
    expect(plan.adjustSeconds).toBeGreaterThan(0);
    expect(plan.adjustSeconds).toBeLessThanOrEqual(
      game.rocket.landingAdjustMaxSeconds + 1e-9,
    );
  });

  it('falls back to a bounded extension when no window exists', () => {
    const obstacles: ObstacleEntity[] = [];
    for (let z = 200; z <= 700; z += 4) {
      obstacles.push(...tallRow(2000 + z, z, [0, 1, 2, 3]));
    }
    const plan = planRocketLanding(request(obstacles, 1));
    expect(plan.fallback).toBe(true);
    expect(plan.adjustSeconds).toBe(game.rocket.landingAdjustMaxSeconds);
  });

  it.each([0, 1, 2, 3])(
    'stays within bounds for lane %i at several speeds',
    (lane) => {
      for (const speed of [14, 28, 40]) {
        const obstacles: ObstacleEntity[] = [];
        for (let z = 240; z <= 420; z += 8) {
          obstacles.push(...tallRow(3000 + z, z, [0, 1, 2, 3]));
        }
        const plan = planRocketLanding(request(obstacles, lane, 300, speed));
        expect(Math.abs(plan.adjustSeconds)).toBeLessThanOrEqual(
          game.rocket.landingAdjustMaxSeconds + 1e-9,
        );
        expect(plan.landingLane).toBeGreaterThanOrEqual(0);
        expect(plan.landingLane).toBeLessThan(levelgen.lanes);
      }
    },
  );
});

describe('rocket landing in GameSim', () => {
  function makeSim(): {
    sim: GameSim;
    setInput: (actions: PlayerAction[]) => void;
  } {
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
      seed: 777,
    });
    return { sim, setInput: (actions) => (input = actions) };
  }

  function pickUpRocket(sim: GameSim): void {
    const snapshot = sim.getSnapshot();
    snapshot.bonuses.push({
      id: 6001,
      kind: 'rocket',
      lane: snapshot.player.lane,
      z: 0,
      collected: false,
    });
    sim.fixedUpdate(1 / 60);
    expect(sim.mode).toBe('rocket');
  }

  it('never deletes visible obstacles for the landing', () => {
    const { sim } = makeSim();
    const snapshot = sim.getSnapshot();
    snapshot.obstacles.push(
      { id: 6101, kind: 'tall', lane: 0, z: 30 },
      { id: 6102, kind: 'low', lane: 2, z: 60 },
      { id: 6103, kind: 'tall', lane: 1, z: 120 },
    );
    const ids = snapshot.obstacles.map((o) => o.id);
    pickUpRocket(sim);
    // Поправка в пределах конфига, управление у игрока (полосы меняются).
    expect(Math.abs(sim.lastRocketLandingAdjustSeconds)).toBeLessThanOrEqual(
      game.rocket.landingAdjustMaxSeconds + 1e-9,
    );
    sim.playerSim.state.lane = 2;
    sim.fixedUpdate(1 / 60);
    expect(sim.playerSim.state.lane).toBe(2);
    for (const id of ids) {
      expect(
        sim.getSnapshot().obstacles.some((o) => o.id === id),
        `obstacle ${id} must survive the flight`,
      ).toBe(true);
    }
  });

  it('lands on a visible obstacle with grace instead of deleting it', () => {
    const { sim } = makeSim();
    pickUpRocket(sim);
    // Укорачиваем круиз, чтобы быстро дойти до падения.
    sim.playerSim.state.rocketFuel = 0.05;
    const lane = sim.getSnapshot().player.lane;
    // Препятствие прямо в точке касания после падения держится до конца.
    for (let i = 0; i < 600 && sim.mode === 'rocket'; i++) {
      sim.fixedUpdate(1 / 60);
      if (sim.playerSim.state.rocketPhase === 'fall') {
        const snap = sim.getSnapshot();
        if (!snap.obstacles.some((o) => o.id === 6201)) {
          snap.obstacles.push({ id: 6201, kind: 'tall', lane, z: 0.4 });
        }
      }
    }
    expect(sim.mode).toBe('car');
    expect(
      sim.getSnapshot().obstacles.some((o) => o.id === 6201),
    ).toBe(true);
    expect(sim.getSnapshot().player.damageState).toBe('normal');
  });
});

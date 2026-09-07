import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import {
  clampPresentationOffset,
  collectDodgeEvents,
  createDodgePresentationState,
  createTurnMomentumState,
  pushDodgeImpulses,
  resetTurnMomentum,
  resolvePresentationScale,
  sampleDodgeOffset,
  turnBankScale,
  turnJellyScale,
  turnPullbackZ,
  updateDodgeLaneEscape,
  updateTurnMomentum,
} from '@core/camera/cameraPresentation';
import type { ObstacleEntity } from '@core/levelgen/types';
import { GameSim } from '@core/gameplay/GameSim';
import { PassthroughDirector } from '@core/director/PassthroughDirector';
import { emptyMusic } from './musicHelpers';

const camera = (gameRaw as GameConfig).camera;

function obstacle(
  partial: Pick<ObstacleEntity, 'id' | 'kind' | 'lane' | 'z'> & Partial<ObstacleEntity>,
): ObstacleEntity {
  return partial;
}

describe('turn momentum', () => {
  it('builds on a same-side combo and decays after the window', () => {
    const state = createTurnMomentumState();
    expect(updateTurnMomentum(state, 2, 0.016, camera)).toBe(0);
    expect(updateTurnMomentum(state, 3, 0.016, camera)).toBe(0);
    const combo = updateTurnMomentum(state, 4, 0.016, camera);
    expect(combo).toBeCloseTo(0.55, 5);
    const held = updateTurnMomentum(state, 4, 0.2, camera);
    expect(held).toBeCloseTo(0.55, 5);
    let momentum = held;
    for (let i = 0; i < 50; i++) {
      momentum = updateTurnMomentum(state, 4, 0.016, camera);
    }
    expect(momentum).toBeLessThan(0.55);
    for (let i = 0; i < 120; i++) {
      momentum = updateTurnMomentum(state, 4, 0.016, camera);
    }
    expect(momentum).toBeLessThan(0.02);
  });

  it('does not keep accumulating after an opposite turn', () => {
    const state = createTurnMomentumState();
    updateTurnMomentum(state, 2, 0.016, camera);
    updateTurnMomentum(state, 3, 0.016, camera);
    expect(updateTurnMomentum(state, 4, 0.016, camera)).toBeCloseTo(0.55, 5);
    const reversed = updateTurnMomentum(state, 3, 0.016, camera);
    expect(reversed).toBeLessThan(0.55);
    expect(reversed).toBeGreaterThan(0.4);
  });

  it('resets on pause / game over', () => {
    const state = createTurnMomentumState();
    updateTurnMomentum(state, 1, 0.016, camera);
    updateTurnMomentum(state, 2, 0.016, camera);
    updateTurnMomentum(state, 3, 0.016, camera);
    resetTurnMomentum(state);
    expect(state.momentum).toBe(0);
    expect(updateTurnMomentum(state, 3, 0.016, camera)).toBe(0);
  });
});

describe('presentation scales', () => {
  it('keeps car at full strength and weakens horse / FPS pullback', () => {
    expect(resolvePresentationScale('car', 1, camera)).toEqual({
      effect: 1,
      pullback: 1,
    });
    const horseChase = resolvePresentationScale('horse', 0, camera);
    expect(horseChase.effect).toBeCloseTo(0.45);
    expect(horseChase.pullback).toBeCloseTo(0.45);
    const horseFps = resolvePresentationScale('horse', 1, camera);
    expect(horseFps.effect).toBeCloseTo(0.25);
    expect(horseFps.pullback).toBeCloseTo(0.1);
    expect(turnJellyScale(1, 1, camera)).toBeCloseTo(1.55);
    expect(turnBankScale(1, 1, camera)).toBeCloseTo(1.35);
    expect(turnPullbackZ(1, 1, camera)).toBeCloseTo(0.42);
    expect(turnPullbackZ(1, horseFps.pullback, camera)).toBeCloseTo(0.042);
  });

  it('clamps stacked presentation offsets', () => {
    const clamped = clampPresentationOffset({ x: 2, y: -2, z: 3 }, camera);
    expect(clamped.x).toBe(camera.presentationClampX);
    expect(clamped.y).toBe(-camera.presentationClampY);
    expect(clamped.z).toBe(camera.presentationClampZ);
  });
});

describe('dodge events', () => {
  const nearMissZ = -0.5;
  const minSpeed = 16;

  function collect(
    player: { lane: number; laneX: number; speed: number },
    obstacles: ObstacleEntity[],
    extras: {
      tracked?: Set<number>;
      hitIds?: Set<number>;
      escapedIds?: Set<number>;
    } = {},
  ) {
    return collectDodgeEvents(player, obstacles, {
      tracked: extras.tracked ?? new Set(),
      hitIds: extras.hitIds ?? new Set(),
      escapedIds: extras.escapedIds ?? new Set(),
      nearMissZ,
      minSpeed,
    });
  }

  it('emits only after leaving the obstacle lane, not for a nearby pass', () => {
    const sharedLaneIds = new Set<number>();
    const escapedIds = new Set<number>();
    const threat = obstacle({ id: 1, kind: 'tall', lane: 2, z: 8 });
    updateDodgeLaneEscape({ lane: 1 }, [threat], {
      sharedLaneIds,
      escapedIds,
      hitIds: new Set(),
      nearMissZ,
    });
    expect(escapedIds.size).toBe(0);
    expect(
      collect({ lane: 1, laneX: 0, speed: 18 }, [{ ...threat, z: -0.6 }], {
        escapedIds,
      }),
    ).toHaveLength(0);

    updateDodgeLaneEscape({ lane: 2 }, [{ ...threat, z: 6 }], {
      sharedLaneIds,
      escapedIds,
      hitIds: new Set(),
      nearMissZ,
    });
    updateDodgeLaneEscape({ lane: 1 }, [{ ...threat, z: 4 }], {
      sharedLaneIds,
      escapedIds,
      hitIds: new Set(),
      nearMissZ,
    });
    const events = collect(
      { lane: 1, laneX: 0, speed: 18 },
      [{ ...threat, z: -0.6 }],
      { escapedIds },
    );
    expect(events).toHaveLength(1);
    expect(events[0].threatSide).toBe(1);
  });

  it('skips low speed, hits and micros', () => {
    const escapedIds = new Set([1, 2, 3]);
    expect(
      collect(
        { lane: 1, laneX: 0, speed: 12 },
        [obstacle({ id: 1, kind: 'tall', lane: 2, z: -0.6 })],
        { escapedIds },
      ),
    ).toHaveLength(0);
    expect(
      collect(
        { lane: 1, laneX: 0, speed: 18 },
        [
          obstacle({ id: 2, kind: 'tall', lane: 0, z: -0.6 }),
          obstacle({ id: 3, kind: 'micro', lane: 2, z: -0.6 }),
        ],
        { escapedIds, hitIds: new Set([2]) },
      ),
    ).toHaveLength(0);
  });

  it('does not emit twice for the same object', () => {
    const tracked = new Set<number>();
    const escapedIds = new Set([9]);
    const threat = obstacle({ id: 9, kind: 'tall', lane: 2, z: -0.6 });
    expect(
      collect({ lane: 1, laneX: 0, speed: 18 }, [threat], { tracked, escapedIds }),
    ).toHaveLength(1);
    expect(
      collect({ lane: 1, laneX: 0, speed: 18 }, [threat], { tracked, escapedIds }),
    ).toHaveLength(0);
  });

  it('holds the dodge offset then returns', () => {
    const state = createDodgePresentationState();
    pushDodgeImpulses(state, [{ x: 0, y: 0, z: -0.6, threatSide: 1 }]);
    const peak = sampleDodgeOffset(state, camera.dodgeInSeconds, camera, 1);
    expect(peak.x).toBeLessThan(0);
    expect(peak.y).toBeLessThan(0);
    expect(peak.z).toBeGreaterThan(0);
    expect(Math.abs(peak.x)).toBeCloseTo(camera.dodgeLateralX, 2);
    const held = sampleDodgeOffset(state, camera.dodgeHoldSeconds, camera, 1);
    expect(Math.abs(held.x)).toBeCloseTo(camera.dodgeLateralX, 2);
    let offset = held;
    for (let i = 0; i < 40; i++) {
      offset = sampleDodgeOffset(state, 0.02, camera, 1);
    }
    expect(Math.abs(offset.x)).toBeLessThan(0.02);
    expect(state.impulses).toHaveLength(0);
  });
});

describe('GameSim dodgeFx', () => {
  function makeSim(gameOverride?: GameConfig): GameSim {
    const emptyLevelgen: LevelgenConfig = {
      ...(levelgenRaw as LevelgenConfig),
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      redWallProbability: 0,
      rampProbability: 0,
      earlyRampProbability: 0,
      nitroWallProbability: 0,
      laneFlow: [0, 0, 0, 0],
    };
    return new GameSim({
      game: gameOverride ?? (gameRaw as GameConfig),
      levelgen: emptyLevelgen,
      director: new PassthroughDirector(directorRaw as DirectorConfig),
      consumeInput: () => [],
      nowMs: () => 0,
      getMusic: () => emptyMusic(),
      seed: 44,
    });
  }

  const alwaysOnGame: GameConfig = {
    ...(gameRaw as GameConfig),
    camera: { ...(gameRaw as GameConfig).camera, dodgeMinSpeed: 0 },
  };
  const neverOnGame: GameConfig = {
    ...(gameRaw as GameConfig),
    camera: { ...(gameRaw as GameConfig).camera, dodgeMinSpeed: 99 },
  };

  it('emits dodgeFx after leaving a tall lane, not for a neighbor pass', () => {
    const sim = makeSim(alwaysOnGame);
    const snap = sim.getSnapshot();
    const otherLane =
      snap.player.lane < gameRaw.lane.positions.length - 1
        ? snap.player.lane + 1
        : snap.player.lane - 1;
    snap.obstacles.push({
      id: 77001,
      kind: 'tall',
      lane: otherLane,
      z: -0.6,
    });
    sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().dodgeFx).toHaveLength(0);

    const shared = sim.getSnapshot();
    shared.obstacles.push({
      id: 77011,
      kind: 'tall',
      lane: shared.player.lane,
      z: 20,
    });
    sim.fixedUpdate(1 / 60);
    const afterShare = sim.getSnapshot();
    const startLane = afterShare.player.lane;
    afterShare.player.lane = otherLane;
    afterShare.player.laneX = gameRaw.lane.positions[otherLane];
    const threat = afterShare.obstacles.find((item) => item.id === 77011);
    if (threat) threat.z = -0.6;
    sim.fixedUpdate(1 / 60);
    const after = sim.getSnapshot();
    expect(after.dodgeFx).toHaveLength(1);
    expect(after.dodgeFx[0].threatSide).toBe(Math.sign(startLane - otherLane));
    expect(after.nearMissFx).toHaveLength(0);
    sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().dodgeFx).toHaveLength(0);
  });

  it('does not emit dodgeFx for a lane escape below dodgeMinSpeed', () => {
    const sim = makeSim(neverOnGame);
    const snap = sim.getSnapshot();
    snap.obstacles.push({
      id: 77012,
      kind: 'tall',
      lane: snap.player.lane,
      z: 20,
    });
    sim.fixedUpdate(1 / 60);
    const afterShare = sim.getSnapshot();
    const otherLane =
      afterShare.player.lane < gameRaw.lane.positions.length - 1
        ? afterShare.player.lane + 1
        : afterShare.player.lane - 1;
    afterShare.player.lane = otherLane;
    afterShare.player.laneX = gameRaw.lane.positions[otherLane];
    const threat = afterShare.obstacles.find((item) => item.id === 77012);
    if (threat) threat.z = -0.6;
    sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().dodgeFx).toHaveLength(0);
  });

  it('emits dodgeFx for a horse lane escape', () => {
    const sim = makeSim(alwaysOnGame);
    const snap = sim.getSnapshot();
    snap.player.mode = 'horse';
    snap.obstacles.push({
      id: 77002,
      kind: 'tall',
      lane: snap.player.lane,
      z: 20,
    });
    sim.fixedUpdate(1 / 60);
    const afterShare = sim.getSnapshot();
    const otherLane =
      afterShare.player.lane < gameRaw.lane.positions.length - 1
        ? afterShare.player.lane + 1
        : afterShare.player.lane - 1;
    afterShare.player.mode = 'horse';
    afterShare.player.lane = otherLane;
    afterShare.player.laneX = gameRaw.lane.positions[otherLane];
    const threat = afterShare.obstacles.find((item) => item.id === 77002);
    if (threat) threat.z = -0.6;
    sim.fixedUpdate(1 / 60);
    const after = sim.getSnapshot();
    expect(after.player.mode).toBe('horse');
    expect(after.dodgeFx).toHaveLength(1);
  });
});

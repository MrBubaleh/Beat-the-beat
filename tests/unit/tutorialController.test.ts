import { describe, expect, it } from 'vitest';
import game from '../../configs/game.default.json';
import { configFallbacks } from '@core/config/fallbacks';
import { gameConfigSchema } from '@core/config/schemas';
import { TutorialController } from '@core/tutorial/TutorialController';
import type { TutorialSnapshot } from '@core/tutorial/TutorialController';
import type { ObstacleEntity } from '@core/levelgen/types';

const SLOW_MO_SCALE = game.tutorial.slowMoScale;
const SLOW_MO_MID_SCALE = 1 - 0.5 * (1 - SLOW_MO_SCALE);
const low = (id = 1, z = 30, lane = 1): ObstacleEntity => ({ id, kind: 'low', z, lane });
const jump = (id = 1, z = 30, lane = 1): ObstacleEntity => ({ ...low(id, z, lane), horseAction: 'jump' });
const slide = (id = 2, z = 40, lane = 1): ObstacleEntity => ({
  id, kind: 'overhead', z, lane, horseAction: 'slide',
});
function snapshot(mode: 'car' | 'horse' | 'rocket' = 'car', obstacles = [low()]): TutorialSnapshot {
  return {
    player: { mode, lane: 1, speed: 10, gameOver: false, isHit: false, isAbilityActive: false, airState: 'grounded', airSource: 'none' },
    obstacles,
    nitroReady: true,
    runStats: { nitroActivations: 0, horseJumpClears: 0, horseSlideClears: 0, hits: 0 },
  };
}
function slowFixture(mode: 'car' | 'horse' = 'car') {
  const controller = new TutorialController(game);
  const target = mode === 'car' ? low() : jump();
  const state = snapshot(mode, [target]);
  controller.update(state, 1 / 60);
  target.z = 8;
  expect(controller.update(state, 0.25).timeScale).toBeCloseTo(SLOW_MO_SCALE);
  return { controller, state, target };
}

describe('TutorialController target acquisition', () => {
  it('uses the exact design defaults in JSON and fallback and validates them', () => {
    expect(game.tutorial).toEqual(configFallbacks.game.tutorial);
    expect(gameConfigSchema.safeParse(game).success).toBe(true);
    expect(game.tutorial.slowMoScale).toBe(0.48);
  });

  it.each([
    { nitroArrowMinDistance: 45 },
    { horseArrowMinTimeToObstacle: 6 },
    { horseJumpArrowMinTimeToObstacle: 4 },
    { horseJumpArrowMinTimeToObstacle: 0.7 },
    { slowMoScale: 0 },
    { slowMoScale: 1.1 },
    { slowMoBlendSeconds: 0 },
    { audioMinPlaybackRate: 0.1 },
    { slowMoStartTimeToContact: 2.5 },
  ])('rejects invalid tutorial settings %j', (invalid) => {
    expect(gameConfigSchema.safeParse({ ...game, tutorial: { ...game.tutorial, ...invalid } }).success).toBe(false);
  });

  it('defaults to novice and picks the nearest low across lanes, ignoring micro and broken', () => {
    const controller = new TutorialController(game);
    const state = snapshot('car', [
      low(7, 38), { ...low(2, 25), kind: 'micro' }, { ...low(3, 26), broken: true },
      { ...low(4, 27), transitionGhost: true }, low(5, 30, 3), low(6, 35),
    ]);
    const intent = controller.update(state, 0.25);
    expect(controller.status).toBe('novice');
    expect(intent).toMatchObject({ active: true, stage: 'nitro', targetObstacleId: 5, timeScale: 1, arrowColor: 'green' });
    expect(intent.arrowPose?.x).toBeCloseTo(game.lane.positions[3]);
    expect(intent.arrowPose?.pitch).toBe(Math.PI / 2);
  });

  it.each([24.9, 40.1, -5])('does not acquire nitro targets outside the distance window: %s', (z) => {
    expect(new TutorialController(game).update(snapshot('car', [low(1, z)]), 1).active).toBe(false);
  });

  it.each([25, 40])('includes the nitro window boundary %s', (z) => {
    expect(new TutorialController(game).update(snapshot('car', [low(1, z)]), 0).active).toBe(true);
  });

  it('requires the simulation ready flag and an inactive ability', () => {
    const controller = new TutorialController(game);
    const state = snapshot();
    state.nitroReady = false;
    expect(controller.update(state, 1).active).toBe(false);
    state.nitroReady = true;
    state.player.isAbilityActive = true;
    expect(controller.update(state, 1).active).toBe(false);
  });

  it('retains a nitro target below the acquisition window and follows its position', () => {
    const controller = new TutorialController(game);
    const target = low();
    const state = snapshot('car', [target]);
    const initial = controller.update(state, 0);
    target.z = 20;
    target.xOffset = 0.3;
    const next = controller.update(state, 0.1);
    expect(next.targetObstacleId).toBe(1);
    expect(next.arrowPose!.z).toBeCloseTo(initial.arrowPose!.z - 10);
    expect(next.arrowPose!.x).toBeCloseTo(game.lane.positions[1] + 0.3);
    expect(next.timeScale).toBe(1);
  });

  it('selects horse actions by metadata and current lane, taking the nearest unfinished action', () => {
    const state = snapshot('horse', [jump(1, 24, 0), jump(2, 38), slide(3, 30), low(4, 25)]);
    const intent = new TutorialController(game).update(state, 1 / 60);
    expect(intent).toMatchObject({ stage: 'slide', targetObstacleId: 3, arrowColor: 'turquoise', timeScale: 1 });
    expect(intent.arrowPose?.pitch).toBe(Math.PI);
  });

  it.each([8, 70])('does not acquire horse targets too close or far: %s', (z) => {
    expect(new TutorialController(game).update(snapshot('horse', [jump(1, z)]), 1).active).toBe(false);
  });

  it('uses current speed and physical obstacle extent for horse contact time', () => {
    const state = snapshot('horse', [{ ...jump(), zExtent: 40 }]);
    expect(new TutorialController(game).update(state, 0).active).toBe(false);
    state.obstacles = [jump()];
    expect(new TutorialController(game).update(state, 0).active).toBe(true);
    state.player.speed = 30;
    expect(new TutorialController(game).update(state, 0).active).toBe(false);
    state.player.speed = 0;
    expect(new TutorialController(game).update(state, 0).active).toBe(false);
  });

  it('acquires a nearer jump target and waits before showing distant jump training', () => {
    const state = snapshot('horse', [jump(1, 45), jump(2, 18)]);
    const controller = new TutorialController(game);
    expect(controller.update(state, 0)).toMatchObject({ stage: 'jump', targetObstacleId: 2, timeScale: 1 });
    expect(new TutorialController(game).update(snapshot('horse', [jump(1, 45)]), 0).active).toBe(false);
    expect(new TutorialController(game).update(snapshot('horse', [slide(3, 45)]), 0).stage).toBe('slide');
  });

  it('retargets horse on lane change and releases slow-mo', () => {
    const { controller, state } = slowFixture('horse');
    state.player.lane = 2;
    state.obstacles = [...state.obstacles, slide(3, 30, 2)];
    const intent = controller.update(state, 0.25);
    expect(intent).toMatchObject({ targetObstacleId: 3, stage: 'slide', timeScale: 1 });
  });

  it('never treats horse dodge-only, ignored, or portal obstacles as tutorial actions', () => {
    const state = snapshot('horse', [
      { ...jump(), horseDodgeOnly: true },
      { ...slide(), collisionIgnored: true },
      { ...jump(3), modePortal: 'car' },
    ]);
    expect(new TutorialController(game).update(state, 0.5).active).toBe(false);
  });
});

describe('TutorialController progression', () => {
  it('counts any nitro activation even without a tutorial target', () => {
    const controller = new TutorialController(game);
    const state = snapshot('car', []);
    state.runStats.nitroActivations = 1;
    controller.update(state, 0);
    expect(controller.stages.nitroStageDone).toBe(true);
    state.obstacles = [low()];
    expect(controller.update(state, 1).active).toBe(false);
  });

  it.each(['jump', 'slide'] as const)('accepts %s first, even without a target; stages are independent', (first) => {
    const controller = new TutorialController(game);
    const state = snapshot('horse', []);
    state.runStats[first === 'jump' ? 'horseJumpClears' : 'horseSlideClears'] = 1;
    controller.update(state, 0);
    state.obstacles = [jump(), slide()];
    expect(controller.update(state, 0).stage).toBe(first === 'jump' ? 'slide' : 'jump');
    expect(controller.status).toBe('novice');
    state.runStats.horseJumpClears = state.runStats.horseSlideClears = 1;
    state.player.mode = 'car';
    state.runStats.nitroActivations = 1;
    expect(controller.update(state, 0)).toMatchObject({ active: false, timeScale: 1 });
    expect(controller.status).toBe('veteran');
    expect(controller.stages).toEqual({ nitroStageDone: false, jumpStageDone: false, slideStageDone: false });
  });

  it('does not complete a stage from pressing jump or slide without a clear', () => {
    const controller = new TutorialController(game);
    controller.update(snapshot('horse', [jump()]), 1);
    expect(controller.stages).toMatchObject({ jumpStageDone: false, slideStageDone: false });
  });

  it('resets all partial progress on a new run', () => {
    const controller = new TutorialController(game);
    const state = snapshot();
    state.runStats.nitroActivations = 1;
    controller.update(state, 1);
    controller.resetRun();
    expect(controller.status).toBe('novice');
    expect(controller.update(snapshot(), 0).stage).toBe('nitro');
    expect(controller.stages.nitroStageDone).toBe(false);
  });

  it('reset to novice mid-run baselines old counters rather than crediting them again', () => {
    const controller = new TutorialController(game, 'veteran');
    const state = snapshot();
    state.runStats = { nitroActivations: 3, horseJumpClears: 4, horseSlideClears: 2, hits: 1 };
    controller.resetRun('novice', state);
    controller.update(state, 0);
    expect(controller.status).toBe('novice');
    expect(controller.stages).toEqual({ nitroStageDone: false, jumpStageDone: false, slideStageDone: false });
    state.runStats.nitroActivations++;
    controller.update(state, 0);
    expect(controller.stages.nitroStageDone).toBe(true);
    expect(controller.status).toBe('novice');
  });

  it('veteran stays off after a new run', () => {
    const controller = new TutorialController(game, 'veteran');
    controller.resetRun();
    expect(controller.update(snapshot(), 5)).toMatchObject({ active: false, timeScale: 1 });
  });
});

describe('TutorialController slow-mo lifecycle', () => {
  it('starts only near contact and blends on real time', () => {
    const controller = new TutorialController(game);
    const target = low();
    const state = snapshot('car', [target]);
    expect(controller.update(state, 5).timeScale).toBe(1);
    target.z = 8;
    const middle = controller.update(state, 0.125);
    expect(middle.timeScale).toBeCloseTo(SLOW_MO_MID_SCALE);
    expect(controller.update(state, 0.125).timeScale).toBeCloseTo(SLOW_MO_SCALE);
  });

  it('releases on success while preserving the completed stage', () => {
    const { controller, state } = slowFixture();
    state.runStats.nitroActivations++;
    expect(controller.update(state, 0.125)).toMatchObject({ active: false });
    expect(controller.update(state, 0.125).timeScale).toBe(1);
    expect(controller.stages.nitroStageDone).toBe(true);
  });

  it.each(['counter', 'isHit'] as const)('releases on collision (%s) without completing the stage', (source) => {
    const { controller, state } = slowFixture();
    if (source === 'counter') state.runStats.hits++;
    else state.player.isHit = true;
    expect(controller.update(state, 0.25)).toMatchObject({ active: false, timeScale: 1 });
    expect(controller.stages.nitroStageDone).toBe(false);
    expect(controller.update(state, 0.25).active).toBe(false);
  });

  it('releases when target breaks or nitro readiness disappears', () => {
    for (const reason of ['broken', 'notReady']) {
      const { controller, state, target } = slowFixture();
      if (reason === 'broken') target.broken = true;
      else state.nitroReady = false;
      expect(controller.update(state, 0.25)).toMatchObject({ active: false, timeScale: 1 });
    }
  });

  it.each(['passed', 'despawned'] as const)('times out a %s target in real seconds and finds the next one', (reason) => {
    const { controller, state, target } = slowFixture();
    if (reason === 'passed') target.z = -10;
    else state.obstacles = [];
    state.obstacles = [...state.obstacles, low(2, 35)];
    expect(controller.update(state, 0.25)).toMatchObject({ active: false, timeScale: SLOW_MO_SCALE });
    expect(controller.update(state, 0.25).timeScale).toBeCloseTo(SLOW_MO_SCALE);
    expect(controller.update(state, 0.125).timeScale).toBeCloseTo(SLOW_MO_MID_SCALE);
    expect(controller.update(state, 0.125).timeScale).toBe(1);
    expect(controller.update(state, 0).targetObstacleId).toBe(2);
  });

  it('keeps a long obstacle until its rear passes the player', () => {
    const { controller, state, target } = slowFixture('horse');
    target.zExtent = 20;
    target.z = -2;
    expect(controller.update(state, 3)).toMatchObject({ active: true, timeScale: SLOW_MO_SCALE });
    target.z = -20;
    expect(controller.update(state, 3)).toMatchObject({ active: false, timeScale: 1 });
  });

  it('immediately suspends for rocket, retaining stages and resuming after return', () => {
    const { controller, state } = slowFixture('horse');
    state.runStats.horseSlideClears = 1;
    state.player.mode = 'rocket';
    expect(controller.update(state, 0)).toMatchObject({ active: false, timeScale: 1 });
    expect(controller.stages.slideStageDone).toBe(true);
    expect(controller.update(state, 10).active).toBe(false);
    state.player.mode = 'horse';
    state.obstacles = [jump(), slide()];
    controller.update(state, 0);
    expect(controller.update(state, 0).stage).toBe('jump');
  });

  it('immediately releases on car/horse mode change and game over', () => {
    const first = slowFixture();
    first.state.player.mode = 'horse';
    expect(first.controller.update(first.state, 0)).toMatchObject({ active: false, timeScale: 1 });
    const second = slowFixture();
    second.state.player.gameOver = true;
    expect(second.controller.update(second.state, 0)).toMatchObject({ active: false, timeScale: 1 });
  });

  it('suspend removes slow-mo without losing earned progress', () => {
    const { controller, state } = slowFixture('horse');
    state.runStats.horseSlideClears = 1;
    controller.update(state, 0);
    expect(controller.suspend()).toMatchObject({ active: false, timeScale: 1 });
    expect(controller.stages.slideStageDone).toBe(true);
  });

  it.each(['car', 'horse'] as const)('suspends %s tutorial throughout ramp flight and landing, then resumes', (mode) => {
    const { controller, state } = slowFixture(mode);
    state.runStats.horseSlideClears = 1;
    state.player.airSource = 'ramp';
    state.player.airState = 'airborne';
    expect(controller.update(state, 0)).toMatchObject({ active: false, timeScale: 1 });
    expect(controller.stages.slideStageDone).toBe(true);
    state.obstacles = [mode === 'car' ? low() : jump()];
    expect(controller.update(state, 1).active).toBe(false);
    state.player.airState = 'landing';
    expect(controller.update(state, 1)).toMatchObject({ active: false, timeScale: 1 });
    state.player.airState = 'grounded';
    expect(controller.update(state, 0).active).toBe(true);
  });

  it('keeps horse jump training active during its normal jump', () => {
    const { controller, state } = slowFixture('horse');
    state.player.airSource = 'horseJump';
    state.player.airState = 'airborne';
    expect(controller.update(state, 0)).toMatchObject({ active: true, timeScale: SLOW_MO_SCALE });
  });

  it('applies changed tutorial settings without reconstructing the controller', () => {
    const controller = new TutorialController(game);
    controller.setConfig({ ...game, tutorial: { ...game.tutorial, nitroArrowMinDistance: 15, slowMoScale: 0.5 } });
    const target = low(1, 20);
    const state = snapshot('car', [target]);
    expect(controller.update(state, 0).active).toBe(true);
    target.z = 8;
    expect(controller.update(state, 0.25).timeScale).toBe(0.5);
  });
});

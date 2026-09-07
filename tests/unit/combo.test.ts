import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import type { GameConfig } from '@core/config/schemas';
import type { ObstacleEntity } from '@core/levelgen/types';
import { ComboSystem, comboMultiplier } from '@core/gameplay/Combo';
import { createInitialPlayer } from '@core/gameplay/PlayerSim';
import { Score } from '@core/gameplay/Score';

const cfg = (gameRaw as GameConfig).combo;
const START_LANE = Math.floor(gameRaw.lane.positions.length / 2);

function player() {
  return createInitialPlayer(gameRaw.lane.positions);
}

function obs(id: number, lane: number, z: number, broken = false): ObstacleEntity {
  return { id, kind: 'low', lane, z, broken };
}

describe('comboMultiplier', () => {
  it('starts at 1 and steps up every multiplierStep', () => {
    expect(comboMultiplier(0, cfg)).toBe(1);
    expect(comboMultiplier(1, cfg)).toBe(1);
    expect(comboMultiplier(4, cfg)).toBe(1);
    expect(comboMultiplier(5, cfg)).toBe(2);
    expect(comboMultiplier(9, cfg)).toBe(2);
    expect(comboMultiplier(10, cfg)).toBe(3);
  });
});

describe('ComboSystem', () => {
  it('counts a dodge when an obstacle in the player lane passes behind unbroken', () => {
    const system = new ComboSystem();
    const p = player();
    const o = obs(1, START_LANE, 20);
    system.update(p, [o], cfg);
    expect(system.combo).toBe(0);
    o.z = -0.6;
    system.update(p, [o], cfg);
    expect(system.combo).toBe(1);
  });

  it('counts three sequential dodges as combo 3', () => {
    const system = new ComboSystem();
    const p = player();
    for (let id = 1; id <= 3; id++) {
      const o = obs(id, START_LANE, 20);
      system.update(p, [o], cfg);
      o.z = -0.6;
      system.update(p, [o], cfg);
      p.gameTime += cfg.chainWindowSeconds + 0.01;
    }
    expect(system.combo).toBe(3);
  });

  it('counts a close chain in one lane as a single dodge', () => {
    const system = new ComboSystem();
    const p = player();
    const obstacles = [obs(1, START_LANE, 20), obs(2, START_LANE, 24), obs(3, START_LANE, 28)];
    system.update(p, obstacles, cfg);
    for (const obstacle of obstacles) {
      obstacle.z = -0.6;
      system.update(p, obstacles, cfg);
      p.gameTime += cfg.chainWindowSeconds / 3;
    }
    expect(system.combo).toBe(1);
  });

  it('does not count an obstacle in another lane', () => {
    const system = new ComboSystem();
    const p = player();
    const otherLane = (START_LANE + 1) % gameRaw.lane.positions.length;
    const o = obs(1, otherLane, 20);
    system.update(p, [o], cfg);
    o.z = -0.6;
    system.update(p, [o], cfg);
    expect(system.combo).toBe(0);
  });

  it('does not count a broken obstacle', () => {
    const system = new ComboSystem();
    const p = player();
    const o = obs(1, START_LANE, 20);
    system.update(p, [o], cfg);
    o.z = -0.6;
    o.broken = true;
    system.update(p, [o], cfg);
    expect(system.combo).toBe(0);

    const alreadyBroken = obs(2, START_LANE, 20, true);
    system.update(p, [alreadyBroken], cfg);
    alreadyBroken.z = -0.6;
    system.update(p, [alreadyBroken], cfg);
    expect(system.combo).toBe(0);
  });

  it('onSmash increments combo by one', () => {
    const system = new ComboSystem();
    system.onSmash();
    system.onSmash();
    expect(system.combo).toBe(2);
  });

  it('smash and dodge feed the same combo counter', () => {
    const system = new ComboSystem();
    const p = player();
    system.onSmash();
    const o = obs(1, START_LANE, 20);
    system.update(p, [o], cfg);
    o.z = -0.6;
    system.update(p, [o], cfg);
    expect(system.combo).toBe(2);
  });

  it('update with countDodges false does not count dodges', () => {
    const system = new ComboSystem();
    const p = player();
    const o = obs(1, START_LANE, 20);
    system.update(p, [o], cfg, false);
    o.z = -0.6;
    system.update(p, [o], cfg, false);
    expect(system.combo).toBe(0);
  });

  it('countDodges false clears tracked obstacles so they never count later', () => {
    const system = new ComboSystem();
    const p = player();
    const o = obs(1, START_LANE, 20);
    system.update(p, [o], cfg);
    system.update(p, [o], cfg, false);
    o.z = -0.6;
    system.update(p, [o], cfg);
    expect(system.combo).toBe(0);
  });

  it('resets combo on hit and stops counting tracked obstacles', () => {
    const system = new ComboSystem();
    const p = player();
    for (let id = 1; id <= 2; id++) {
      const o = obs(id, START_LANE, 20);
      system.update(p, [o], cfg);
      o.z = -0.6;
      system.update(p, [o], cfg);
      p.gameTime += cfg.chainWindowSeconds + 0.01;
    }
    expect(system.combo).toBe(2);
    system.onHit();
    expect(system.combo).toBe(0);
    const o = obs(3, START_LANE, 20);
    system.update(p, [o], cfg);
    o.z = -0.6;
    system.update(p, [o], cfg);
    expect(system.combo).toBe(1);
  });

  it('reset clears combo and tracking', () => {
    const system = new ComboSystem();
    const p = player();
    const o = obs(1, START_LANE, 20);
    system.update(p, [o], cfg);
    system.reset();
    o.z = -0.6;
    system.update(p, [o], cfg);
    expect(system.combo).toBe(0);
  });
});

describe('Score with combo multiplier', () => {
  it('scores only coins times the combo multiplier (no distance points)', () => {
    const score = new Score();
    score.update(100, 5, 10, 2);
    expect(score.total).toBe(5 * 10 * 2);
    expect(score.meters).toBe(100);
    score.update(100, 5, 10);
    expect(score.total).toBe(5 * 10);
    score.update(100, 0, 10);
    expect(score.total).toBe(0);
  });
});

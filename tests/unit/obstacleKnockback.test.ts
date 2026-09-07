import { describe, expect, it } from 'vitest';
import {
  startMediumKnockback,
  updateMediumKnockbacks,
} from '@core/gameplay/obstacleKnockback';
import type { ObstacleEntity } from '@core/levelgen/types';

const lanes = [-3, -1, 1, 3];
const cfg = {
  lateralSpeed: 6.6,
  arcUpSpeed: 3.5,
  gravity: 19,
  backwardSpeed: -1.6,
  greenLateralSpeed: 10.8,
  greenArcUpSpeed: 7.8,
  greenGravity: 15,
  greenForwardSpeed: -3.6,
  yellowSpin: 4.8,
  greenSpin: 8.6,
  greenExplodeStrength: 2.4,
  maxDurationSeconds: 1.2,
  hitRadius: 1.4,
};

describe('obstacleKnockback', () => {
  it('knocks a yellow low toward the outer edge in an arc', () => {
    const obstacle: ObstacleEntity = { id: 1, kind: 'low', lane: 0, z: 0 };
    startMediumKnockback(obstacle, 0, 4, cfg, 'yellow');
    expect(obstacle.knockbackActive).toBe(true);
    expect(obstacle.knockbackVelX).toBeLessThan(0);
    for (let i = 0; i < 8; i++) updateMediumKnockbacks([obstacle], 1 / 60, cfg, lanes);
    expect(obstacle.xOffset ?? 0).toBeLessThan(0);
    expect(obstacle.yOffset ?? 0).toBeGreaterThan(0);
  });

  it('knocks a green low over the hood with the same lateral side as yellow', () => {
    const obstacle: ObstacleEntity = { id: 1, kind: 'low', lane: 0, z: -1 };
    startMediumKnockback(obstacle, 0, 4, cfg, 'green');
    expect(obstacle.knockbackVelX).toBe(0);
    expect(obstacle.knockbackVelZ).toBeLessThan(0);
    expect(obstacle.knockbackBurstFx).toBe(true);
    for (let i = 0; i < 4; i++) updateMediumKnockbacks([obstacle], 1 / 60, cfg, lanes);
    expect(obstacle.yOffset ?? 0).toBeGreaterThan(0.2);
    expect(obstacle.z).toBeLessThan(-1);
    for (let i = 0; i < 10; i++) updateMediumKnockbacks([obstacle], 1 / 60, cfg, lanes);
    expect(obstacle.xOffset ?? 0).toBeLessThan(0);
  });

  it('chain-breaks low/micro and explodes on tall', () => {
    const flying: ObstacleEntity = { id: 1, kind: 'low', lane: 1, z: 0 };
    const micro: ObstacleEntity = { id: 2, kind: 'micro', lane: 1, z: 0.2 };
    const tall: ObstacleEntity = { id: 3, kind: 'tall', lane: 1, z: 0.1 };
    startMediumKnockback(flying, 1, 4, cfg, 'yellow');
    for (let i = 0; i < 4; i++) {
      updateMediumKnockbacks([flying, micro, tall], 1 / 60, cfg, lanes);
    }
    expect(micro.broken).toBe(true);
    expect(micro.smashed).toBe(true);
    for (let i = 0; i < 20; i++) {
      updateMediumKnockbacks([flying, micro, tall], 1 / 60, cfg, lanes);
    }
    expect(flying.smashed).toBe(true);
    expect(flying.penaltyBreak).toBe(true);
    expect(tall.broken).not.toBe(true);
  });

  it('does not chain-break obstacles ahead of the flying piece', () => {
    const flying: ObstacleEntity = { id: 1, kind: 'low', lane: 1, z: 0 };
    const ahead: ObstacleEntity = { id: 2, kind: 'micro', lane: 1, z: -2 };
    startMediumKnockback(flying, 1, 4, cfg, 'green');
    for (let i = 0; i < 24; i++) {
      updateMediumKnockbacks([flying, ahead], 1 / 60, cfg, lanes);
    }
    expect(ahead.broken).not.toBe(true);
  });
});

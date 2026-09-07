import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import type { GameConfig } from '@core/config/schemas';
import {
  panicFleeLateralSign,
  qualifiesForPanicFleeZ,
  startObstaclePanicFlee,
  updateObstaclePanicFlees,
} from '@core/gameplay/obstaclePanicFlee';
import type { ObstacleEntity } from '@core/levelgen/types';

const game = gameRaw as GameConfig;
const cfg = game.obstaclePanicFlee;
const laneFlow = [0, -6, 17, 0];
const lanePositions = game.lane.positions;

describe('obstaclePanicFlee', () => {
  it('picks the nearer track edge for lateral flee', () => {
    expect(panicFleeLateralSign(0, lanePositions)).toBe(-1);
    expect(panicFleeLateralSign(3, lanePositions)).toBe(1);
    expect(panicFleeLateralSign(1, lanePositions)).toBe(-1);
    expect(panicFleeLateralSign(2, lanePositions)).toBe(1);
  });

  it('drives counterflow lows toward the player and parallel lows away', () => {
    const counter: ObstacleEntity = { id: 1, kind: 'low', lane: 1, z: 32 };
    const parallel: ObstacleEntity = { id: 2, kind: 'low', lane: 2, z: 32 };
    expect(startObstaclePanicFlee(counter, laneFlow, lanePositions, cfg)).toBe(true);
    expect(startObstaclePanicFlee(parallel, laneFlow, lanePositions, cfg)).toBe(true);
    updateObstaclePanicFlees([counter, parallel], 0.25, laneFlow, cfg);
    expect(counter.z).toBeLessThan(32);
    expect(parallel.z).toBeGreaterThan(32);
    expect((counter.xOffset ?? 0) * (counter.panicFleeLateralSign ?? 0)).toBeGreaterThan(0);
    expect((parallel.xOffset ?? 0) * (parallel.panicFleeLateralSign ?? 0)).toBeGreaterThan(0);
  });

  it('only starts in the visible lookahead band', () => {
    expect(qualifiesForPanicFleeZ(30, cfg)).toBe(true);
    expect(qualifiesForPanicFleeZ(8, cfg)).toBe(false);
    const tooClose: ObstacleEntity = { id: 3, kind: 'low', lane: 1, z: 8 };
    expect(startObstaclePanicFlee(tooClose, laneFlow, lanePositions, cfg)).toBe(false);
  });

  it('marks removal after duration elapses', () => {
    const obstacle: ObstacleEntity = { id: 4, kind: 'low', lane: 2, z: 30 };
    startObstaclePanicFlee(obstacle, laneFlow, lanePositions, cfg);
    updateObstaclePanicFlees([obstacle], cfg.durationSeconds, laneFlow, cfg);
    expect(obstacle.panicFleeRemove).toBe(true);
    expect(obstacle.panicFleeActive).toBe(false);
  });
});

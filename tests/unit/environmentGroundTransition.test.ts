import { describe, expect, it } from 'vitest';
import { resolveEnvironmentGroundTransition } from '../../src/render/environmentGroundTransition';

describe('environment ground transition', () => {
  it('buries car decor before raising horse decor', () => {
    expect(resolveEnvironmentGroundTransition(0)).toEqual({
      carPresence: 1,
      cityPresence: 1,
      horsePresence: 0,
    });

    const carExit = resolveEnvironmentGroundTransition(0.25);
    expect(carExit.carPresence).toBeCloseTo(0.5);
    expect(carExit.cityPresence).toBeGreaterThan(carExit.carPresence);
    expect(carExit.horsePresence).toBe(0);

    const middle = resolveEnvironmentGroundTransition(0.5);
    expect(middle.carPresence).toBe(0);
    expect(middle.cityPresence).toBeGreaterThan(0);
    expect(middle.horsePresence).toBe(0);

    const horseEntry = resolveEnvironmentGroundTransition(0.62);
    expect(horseEntry.carPresence).toBe(0);
    expect(horseEntry.cityPresence).toBeGreaterThan(0);
    expect(horseEntry.horsePresence).toBeGreaterThan(0);

    expect(resolveEnvironmentGroundTransition(1)).toEqual({
      carPresence: 0,
      cityPresence: 0,
      horsePresence: 1,
    });
  });

  it('never lets car and horse scenery coexist above ground', () => {
    for (let step = 0; step <= 20; step++) {
      const transition = resolveEnvironmentGroundTransition(step / 20);
      expect(transition.carPresence * transition.horsePresence).toBe(0);
    }
  });

  it('lets horse decor rise while massive city scenery is still burying', () => {
    const overlap = resolveEnvironmentGroundTransition(0.68);
    expect(overlap.cityPresence).toBeGreaterThan(0.08);
    expect(overlap.horsePresence).toBeGreaterThan(0.08);
  });

  it('gives massive city scenery a longer smoother movement phase', () => {
    const early = resolveEnvironmentGroundTransition(0.25);
    const late = resolveEnvironmentGroundTransition(0.82);
    expect(early.cityPresence).toBeGreaterThan(0.82);
    expect(late.cityPresence).toBeGreaterThan(0);
    expect(resolveEnvironmentGroundTransition(0.9).cityPresence).toBe(0);
  });
});

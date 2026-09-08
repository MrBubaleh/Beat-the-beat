import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEVEL_INTRO,
  levelIntroCameraBlend,
  levelIntroCountdownLabel,
  levelIntroDistanceAtGo,
  levelIntroObstacleZ,
  levelIntroSpeedAt,
  levelIntroTargetSpeed,
} from '@core/gameplay/levelIntro';

describe('levelIntro', () => {
  it('ramps speed from zero after move delay', () => {
    expect(levelIntroSpeedAt(0, 10.78)).toBe(0);
    expect(levelIntroSpeedAt(0.3, 10.78)).toBe(0);
    expect(levelIntroSpeedAt(0.5, 10.78)).toBeGreaterThan(0);
    expect(levelIntroSpeedAt(3, 10.78)).toBeCloseTo(10.78, 4);
  });

  it('uses natural target speed at countdown end', () => {
    expect(levelIntroTargetSpeed(10, 0.26)).toBeCloseTo(10.78, 4);
  });

  it('places intro obstacle using go distance and encounter seconds', () => {
    const target = levelIntroTargetSpeed(10, 0.26);
    const goDistance = levelIntroDistanceAtGo(target);
    const z = levelIntroObstacleZ(target, 3);
    expect(z).toBeCloseTo(goDistance + target * 3, 3);
  });

  it('maps countdown labels', () => {
    expect(levelIntroCountdownLabel(0)).toBe('3');
    expect(levelIntroCountdownLabel(1.2)).toBe('2');
    expect(levelIntroCountdownLabel(2.4)).toBe('1');
    expect(levelIntroCountdownLabel(3, DEFAULT_LEVEL_INTRO)).toBe('GO!');
  });

  it('eases camera blend across countdown', () => {
    expect(levelIntroCameraBlend(0)).toBe(0);
    expect(levelIntroCameraBlend(3)).toBe(1);
    expect(levelIntroCameraBlend(1.5)).toBeGreaterThan(0.4);
    expect(levelIntroCameraBlend(1.5)).toBeLessThan(0.6);
  });
});

import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import type { GameConfig } from '@core/config/schemas';
import { beginHit, registerHit, resetHealth, updateHealth } from '@core/gameplay/health';
import type { HealthFields } from '@core/gameplay/health';

const game = gameRaw as GameConfig;
const cfg = game.hit;

function makeHealth(): HealthFields & { iframe: { timer: number } } {
  return {
    isHit: false,
    damageState: 'normal',
    recoveryTimer: 0,
    timeSinceLastHit: 0,
    iframe: { timer: 0 },
  };
}

function step(
  h: HealthFields & { iframe: { timer: number } },
  seconds: number,
  recoveryOpts?: {
    nitroActive?: boolean;
    nitroClearSeconds?: number;
    damagedStress?: number;
  },
): void {
  const dt = 1 / 60;
  for (let i = 0; i < Math.ceil(seconds / dt); i++) {
    updateHealth(h, dt, h.iframe, cfg, recoveryOpts);
  }
}

describe('health module — 3 damage states', () => {
  it('steps normal → damaged → critical → game over on consecutive hits', () => {
    const h = makeHealth();
    expect(registerHit(h, cfg, h.iframe)).toBe('hit');
    expect(h.damageState).toBe('damaged');
    expect(h.isHit).toBe(true);
    expect(h.recoveryTimer).toBe(cfg.recoverySeconds);

    expect(registerHit(h, cfg, h.iframe)).toBe('hit');
    expect(h.damageState).toBe('critical');

    expect(registerHit(h, cfg, h.iframe)).toBe('gameOver');
  });

  it('recovers one state at a time after the recovery timer elapses', () => {
    const h = makeHealth();
    registerHit(h, cfg, h.iframe);
    registerHit(h, cfg, h.iframe);
    expect(h.damageState).toBe('critical');

    step(h, cfg.recoverySeconds + 0.1);
    expect(h.damageState).toBe('damaged');
    expect(h.recoveryTimer).toBeGreaterThan(0);

    step(h, cfg.recoverySeconds + 0.1);
    expect(h.damageState).toBe('normal');
    expect(h.recoveryTimer).toBe(0);
  });

  it('a new hit during recovery resets the recovery timer and escalates damage', () => {
    const h = makeHealth();
    registerHit(h, cfg, h.iframe);
    step(h, cfg.recoverySeconds / 2);
    registerHit(h, cfg, h.iframe);
    expect(h.damageState).toBe('critical');
    expect(h.recoveryTimer).toBeCloseTo(cfg.recoverySeconds, 5);
  });

  it('i-frames expire while damage persists', () => {
    const h = makeHealth();
    registerHit(h, cfg, h.iframe);
    step(h, cfg.iframeSeconds + 0.1);
    expect(h.isHit).toBe(false);
    expect(h.damageState).toBe('damaged');
  });

  it('tracks time since last hit', () => {
    const h = makeHealth();
    updateHealth(h, 0.5, h.iframe, cfg);
    expect(h.timeSinceLastHit).toBeCloseTo(0.5);
    beginHit(h, cfg, h.iframe);
    updateHealth(h, 0.1, h.iframe, cfg);
    expect(h.timeSinceLastHit).toBeCloseTo(0);
  });

  it('reset clears health fields and iframe timer', () => {
    const h = makeHealth();
    registerHit(h, cfg, h.iframe);
    resetHealth(h, h.iframe);
    expect(h.isHit).toBe(false);
    expect(h.damageState).toBe('normal');
    expect(h.recoveryTimer).toBe(0);
    expect(h.timeSinceLastHit).toBe(0);
    expect(h.iframe.timer).toBe(0);
  });

  it('recovers faster with nitro aligned to audio clear timing', () => {
    const h = makeHealth();
    registerHit(h, cfg, h.iframe);
    registerHit(h, cfg, h.iframe);
    expect(h.damageState).toBe('critical');

    const clearSeconds = game.nitro.audioClearSeconds;
    const recoveryOpts = {
      nitroActive: true,
      nitroClearSeconds: clearSeconds,
      damagedStress: game.destroy.damageAudioDamagedStress,
    };
    step(h, clearSeconds + 0.1, recoveryOpts);
    expect(h.damageState).toBe('damaged');

    const damagedStepSeconds =
      clearSeconds / game.destroy.damageAudioDamagedStress;
    step(h, damagedStepSeconds + 0.1, recoveryOpts);
    expect(h.damageState).toBe('normal');
  });
});

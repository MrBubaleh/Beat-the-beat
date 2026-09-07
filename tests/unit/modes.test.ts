import { describe, expect, it } from 'vitest';
import { interpretInput } from '@core/modes/InputContext';
import { ModeController, PRESERVED_ACROSS_MODES, RESET_ON_MODE_CHANGE } from '@core/modes/ModeController';
import { createBonusPipeline } from '@core/modes/bonus';
import { MODE_PROFILES, PLAYER_MODES } from '@core/modes/types';
import type { PlayerMode } from '@core/modes/types';

describe('ModeController', () => {
  it('starts in car mode', () => {
    const controller = new ModeController();
    expect(controller.mode).toBe('car');
    expect(controller.profile.playerShape).toBe('box');
  });

  it('switches mode and reports the transition', () => {
    const controller = new ModeController();
    const transition = controller.switchMode('horse');
    expect(transition).toEqual({ from: 'car', to: 'horse' });
    expect(controller.mode).toBe('horse');
    expect(controller.profile.playerShape).toBe('sphere');
  });

  it('reset returns to car', () => {
    const controller = new ModeController();
    controller.switchMode('rocket');
    controller.reset();
    expect(controller.mode).toBe('car');
  });

  it('defines the state preservation contract', () => {
    expect(PRESERVED_ACROSS_MODES).toEqual([
      'speedMultiplier',
      'nitro',
      'health',
      'distance',
      'coins',
      'combo',
    ]);
    expect(RESET_ON_MODE_CHANGE).toEqual(['air', 'jump', 'tricks']);
  });

  it('has a profile for every mode with the prototype shapes', () => {
    expect(PLAYER_MODES).toEqual(['car', 'horse', 'rocket']);
    expect(MODE_PROFILES.car.playerShape).toBe('box');
    expect(MODE_PROFILES.horse.playerShape).toBe('sphere');
    expect(MODE_PROFILES.rocket.playerShape).toBe('cone');
  });
});

describe('InputContext', () => {
  it('car filters jump and keeps lane and nitro actions', () => {
    const actions = ['laneRight', 'jump'] as const;
    expect(interpretInput('car', [...actions])).toEqual({ laneDelta: -1, jump: false, nitro: false });
    expect(interpretInput('car', ['nitro', 'jump'])).toEqual({ laneDelta: 0, jump: false, nitro: true });
  });

  it('maps the primary and fast-fall actions for horse mode', () => {
    expect(interpretInput('horse', ['nitro'])).toEqual({
      laneDelta: 0,
      jump: true,
      nitro: false,
    });
    expect(interpretInput('horse', ['fastFall'])).toEqual({
      laneDelta: 0,
      jump: false,
      nitro: false,
      fastFall: true,
    });
  });

  it('maps rocket arrows through center without using jump or nitro', () => {
    expect(interpretInput('rocket', ['laneLeft'])).toEqual({
      laneDelta: 1,
      jump: false,
      nitro: false,
    });
    expect(interpretInput('rocket', ['nitro'])).toEqual({
      laneDelta: 0,
      jump: false,
      nitro: false,
      verticalDelta: 1,
    });
    expect(interpretInput('rocket', ['fastFall'])).toEqual({
      laneDelta: 0,
      jump: false,
      nitro: false,
      verticalDelta: -1,
    });
  });

  it('returns a valid neutral input for every mode', () => {
    for (const mode of PLAYER_MODES) {
      const input = interpretInput(mode as PlayerMode, []);
      expect(input).toEqual({ laneDelta: 0, jump: false, nitro: false });
    }
  });
});

describe('Bonus pipeline', () => {
  it('auto-activates on acquire by default', () => {
    const pipeline = createBonusPipeline(true);
    expect(pipeline.status).toBe('none');
    expect(pipeline.acquire('horse')).toBe('horse');
    expect(pipeline.status).toBe('active');
    expect(pipeline.pending).toBeNull();
  });

  it('stores the bonus until manual activation when autoActivate is false', () => {
    const pipeline = createBonusPipeline(false);
    expect(pipeline.acquire('rocket')).toBeNull();
    expect(pipeline.status).toBe('acquired');
    expect(pipeline.pending).toBe('rocket');
    expect(pipeline.activate()).toBe('rocket');
    expect(pipeline.status).toBe('active');
    expect(pipeline.pending).toBeNull();
  });

  it('clear resets to none', () => {
    const pipeline = createBonusPipeline(false);
    pipeline.acquire('horse');
    pipeline.clear();
    expect(pipeline.status).toBe('none');
    expect(pipeline.pending).toBeNull();
  });

  it('supports the prototype car pickup', () => {
    const pipeline = createBonusPipeline(true);
    expect(pipeline.acquire('car')).toBe('car');
  });
});

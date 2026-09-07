import { describe, expect, it } from 'vitest';
import { SfxDirector } from '@core/sfx/SfxDirector';
import { SfxEventQueue } from '@core/sfx/SfxEventQueue';
import { sfxFallback } from '@core/sfx/defaults';
import { sfxConfigSchema } from '@core/sfx/config';
import type { SfxEvent, SfxFrame, SfxId, SfxState } from '@core/sfx/types';
import configJson from '../../configs/sfx.default.json';
import { ConfigStore } from '@core/config/ConfigStore';

const state = (overrides: Partial<SfxState> = {}): SfxState => ({
  gameTime: 0, mode: 'car', speed: 22, lane: 2, laneX: 0, y: 0,
  airState: 'grounded', nitroActive: false, nitroReady: false, sliding: false,
  rocketPhase: 'none', combo: 0, gameOver: false, damageState: 'normal', ...overrides,
});
const frame = (overrides: Partial<SfxFrame> = {}): SfxFrame => ({
  state: state(), phase: 'running', tutorialScale: 1, ...overrides,
});
const event = (id: SfxId, sequence = 1, overrides: Partial<SfxEvent> = {}): SfxEvent => ({
  id, sequence, run: 1, gameTime: 0, mode: 'car', speed: 22, pan: 0,
  strength: 0.5, count: 1, ...overrides,
});
const starts = (commands: ReturnType<SfxDirector['tick']>) =>
  commands.filter(c => c.type === 'start').map(c => c.voice);

describe('SFX config', () => {
  it('validates defaults and keeps an independent identical fallback', () => {
    expect(sfxConfigSchema.parse(configJson)).toEqual(sfxFallback);
    expect(new ConfigStore({ sfx: null }).get('sfx')).toEqual(sfxFallback);
  });
  it('rejects unsafe ranges, NaN, unordered profiles and malformed patches', () => {
    for (const mutate of [
      (v: typeof sfxFallback) => { v.patches.hit.bodyHz = NaN; },
      (v: typeof sfxFallback) => { v.profiles.car.maxSpeed = 2; },
      (v: typeof sfxFallback) => { v.maxVoices = 1000; },
      (v: typeof sfxFallback) => { v.patches.coin.partials = []; },
      (v: typeof sfxFallback) => { v.palette.canister.hold = 0.9; },
      (v: typeof sfxFallback) => { v.palette.smash.fragments = 100; },
      (v: typeof sfxFallback) => { v.palette.motor.drive = Infinity; },
    ]) {
      const cfg = structuredClone(sfxFallback); mutate(cfg);
      expect(sfxConfigSchema.safeParse(cfg).success).toBe(false);
    }
  });
  it('keeps the previous valid config after rejected hot reload', () => {
    const store = new ConfigStore({ sfx: configJson });
    expect(store.apply('sfx', { enabled: true })).toBe(false);
    expect(store.get('sfx')).toEqual(configJson);
  });
});

describe('SFX event delivery', () => {
  it('copies state, delivers once and preserves order through multiple simulation observations', () => {
    const q = new SfxEventQueue();
    const s = state(); q.observe(s);
    s.nitroReady = true; q.observe(s);
    s.nitroActive = true; q.observe(s);
    s.nitroActive = false; q.observe(s);
    expect(q.drain().map(e => e.id)).toEqual(['nitroReady', 'nitroStart', 'nitroEnd']);
    expect(q.drain()).toEqual([]);
  });
  it('keeps terminal events under bounded queue pressure', () => {
    const q = new SfxEventQueue(8);
    for (let i = 0; i < 20; i++) q.emit('coin', state());
    q.emit('hit', state()); q.emit('gameOver', state());
    const events = q.drain();
    expect(events).toHaveLength(8);
    expect(events.map(e => e.id)).toContain('hit');
    expect(events.at(-1)?.id).toBe('gameOver');
    expect(q.dropped).toBe(14);
  });
  it('emits a landing only once and never for the end of the landing animation', () => {
    const q = new SfxEventQueue(); q.observe(state({ mode: 'horse' }));
    q.observe(state({ mode: 'horse', airState: 'airborne' }));
    q.observe(state({ mode: 'horse', airState: 'landing' }));
    q.observe(state({ mode: 'horse', airState: 'grounded' }));
    expect(q.drain().map(e => e.id)).toEqual(['jump', 'land']);
  });
  it('marks a train-roof landing as metal without emitting another contact', () => {
    const q = new SfxEventQueue();
    q.observe(state({ airState: 'airborne' }));
    q.observe(state({ airState: 'landing', gameTime: 1 }));
    q.observe(state({ airState: 'trainRoof', gameTime: 1 }));
    const contacts = q.drain().filter(e => e.id === 'land');
    expect(contacts).toHaveLength(1);
    expect(contacts[0].surface).toBe('metal');
  });

  it('handles death without hit, reset run identity and actual slide transitions', () => {
    const q = new SfxEventQueue(); q.observe(state({ mode: 'horse' }));
    q.observe(state({ mode: 'horse', sliding: true }));
    q.observe(state({ mode: 'horse', gameOver: true }));
    const first = q.drain();
    expect(first.map(e => e.id)).toEqual(['slideStart', 'gameOver']);
    q.reset(); q.emit('coin', state());
    expect(q.drain()[0].run).not.toBe(first[0].run);
  });
});

describe('SfxDirector', () => {
  it('groups a packet before allocating and routes distinct pickups', () => {
    const d = new SfxDirector(sfxFallback);
    const commands = d.tick([...Array.from({ length: 30 }, (_, i) => event('coin', i + 1)), event('canister', 31)], frame(), 0);
    expect(starts(commands).map(v => [v.event, v.bus])).toEqual([['canister', 'pickup'], ['coin', 'pickup']]);
    expect(d.diagnostics.grouped).toBe(29);
  });
  it('uses audio time for cooldown and does not queue delayed pickups', () => {
    const d = new SfxDirector(sfxFallback);
    expect(starts(d.tick([event('coin')], frame({ tutorialScale: 0.35 }), 0))).toHaveLength(1);
    expect(starts(d.tick([event('coin', 2)], frame(), 0.08))).toHaveLength(0);
    expect(starts(d.tick([], frame(), 0.1))).toHaveLength(0);
    expect(starts(d.tick([event('coin', 3)], frame(), 0.1))).toHaveLength(1);
  });
  it('protects important voices globally and lets a stronger hit replace an earlier hit', () => {
    const cfg = structuredClone(sfxFallback); cfg.maxVoices = 1;
    const d = new SfxDirector(cfg);
    d.tick([event('coin')], frame(), 0);
    expect(starts(d.tick([event('hit', 2)], frame(), 0.01))[0].event).toBe('hit');
    expect(starts(d.tick([event('coin', 3)], frame(), 0.12))).toHaveLength(0);
    expect(starts(d.tick([event('hit', 4, { strength: 1 })], frame(), 0.13))).toHaveLength(1);
    expect(d.diagnostics.peak).toBe(1);
    expect(d.diagnostics.stolen).toBeGreaterThan(0);
  });
  it('suppresses duplicates and stale events but keeps terminal events', () => {
    const d = new SfxDirector(sfxFallback);
    const f = frame({ state: state({ gameTime: 5 }) });
    expect(starts(d.tick([event('coin')], f, 0))).toHaveLength(0);
    expect(d.diagnostics.stale).toBe(1);
    d.tick([event('coin')], f, 0.1);
    expect(d.diagnostics.duplicate).toBe(1);
    expect(starts(d.tick([event('gameOver', 2)], frame({ phase: 'gameOver' }), 0.2))[0].event).toBe('gameOver');
  });
  it('plays one terminal accent instead of a stack of fatal hit and pickups', () => {
    const d = new SfxDirector(sfxFallback);
    const f = frame({ state: state({ gameOver: true }), phase: 'gameOver' });
    expect(starts(d.tick([event('hit'), event('coin', 2), event('gameOver', 3)], f, 0)).map(v => v.event)).toEqual(['gameOver']);
    expect(starts(d.tick([], f, 0.1))).toEqual([]);
  });
  it('does not invent nitro activation when resuming and silences all non-running phases', () => {
    for (const phase of ['paused', 'countdown', 'replay', 'idle', 'finished'] as const) {
      const d = new SfxDirector(sfxFallback);
      d.tick([event('nitroStart')], frame(), 0);
      expect(starts(d.tick([event('coin', 2)], frame({ phase }), 0.1))).toEqual([]);
      expect(d.diagnostics.active).toBe(0);
      expect(starts(d.tick([], frame({ state: state({ nitroActive: true }) }), 0.2))).toEqual([]);
    }
  });
  it('bounds and resets ladder, with deterministic variation independent of other systems', () => {
    const cfg = structuredClone(sfxFallback); cfg.patches.coin.jitterCents = 0; cfg.patches.coin.speedPitch = 0;
    const d = new SfxDirector(cfg);
    const pitches = Array.from({ length: 9 }, (_, i) => starts(d.tick([event('coin', i + 1)], frame(), i * 0.12))[0].pitch);
    expect(pitches[8]).toBe(pitches[3]);
    expect(starts(d.tick([event('coin', 10)], frame(), 3))[0].pitch).toBe(1);
    d.reset();
    expect(starts(d.tick([event('coin')], frame(), 4))[0].pitch).toBe(pitches[0]);
  });
  it('never schedules hooves in the air or while sliding, and does not catch up after long frames', () => {
    const d = new SfxDirector(sfxFallback);
    const horse = frame({ state: state({ mode: 'horse' }) });
    expect(starts(d.tick([], horse, 0)).map(v => v.event)).toEqual(['hoof']);
    expect(starts(d.tick([], frame({ state: state({ mode: 'horse', airState: 'airborne' }) }), 0.5))).toEqual([]);
    expect(starts(d.tick([], frame({ state: state({ mode: 'horse', sliding: true }) }), 0.8))).toEqual([]);
    expect(starts(d.tick([], horse, 10))).toHaveLength(1);
  });
  it('deduplicates rocket/mode, ready/canister and impact/near-miss accents', () => {
    const d = new SfxDirector(sfxFallback);
    const ids: SfxId[] = ['mode', 'rocketPrepare', 'nitroReady', 'canister', 'hit', 'nearMiss', 'lane'];
    const heard = starts(d.tick(ids.map((id, i) => event(id, i + 1)), frame(), 0)).map(v => v.event);
    expect(heard).not.toContain('mode'); expect(heard).not.toContain('canister'); expect(heard).not.toContain('nearMiss');
  });
  it('does not play a sustained-ability start for activation interrupted in the same packet', () => {
    const d = new SfxDirector(sfxFallback);
    const heard = starts(d.tick([event('nitroStart'), event('nitroEnd', 2), event('hit', 3)], frame(), 0)).map(v => v.event);
    expect(heard).toEqual(['hit']);
  });

  it('applies live budget reductions and disabled mode safely', () => {
    const d = new SfxDirector(sfxFallback);
    d.tick([event('hit'), event('coin', 2), event('smash', 3)], frame(), 0);
    const cfg = structuredClone(sfxFallback); cfg.maxVoices = 1; d.configure(cfg);
    expect(d.tick([], frame(), 0.01).some(c => c.type === 'stop')).toBe(true);
    expect(d.diagnostics.active).toBe(1);
    cfg.enabled = false;
    d.tick([], frame(), 0.02); expect(d.diagnostics.active).toBe(0);
  });
});


describe('SFX motor load', () => {
  it('keeps an idle floor and separates acceleration from cruising at the same speed', () => {
    const director = new SfxDirector(sfxFallback);
    const motor = (speed: number, time: number) => director.tick([], frame({ state: state({ speed, gameTime: time }) }), time)
      .flatMap(c => c.type === 'beds' ? c.targets : []).find(b => b.id === 'motor')!;
    expect(motor(sfxFallback.profiles.car.minSpeed, 0).gain).toBeGreaterThan(0);
    motor(20, 1);
    const accelerating = motor(21, 1.1);
    const cruising = motor(21, 1.2);
    expect(accelerating.load).toBeGreaterThan(cruising.load!);
    expect(accelerating.gain).toBeGreaterThan(cruising.gain);
    expect(accelerating.filterHz).toBeGreaterThan(cruising.filterHz);
  });
});


describe('rocket MP3 routing', () => {
  it('starts at pickup, retains position across pause and fades at fall without synthetic rocket layers', () => {
    const director = new SfxDirector(sfxFallback);
    const rocketFrame = (time: number, phase: SfxState['rocketPhase'], runPhase: SfxFrame['phase'] = 'running') =>
      frame({ phase: runPhase, state: state({ gameTime: time, mode: 'rocket', rocketPhase: phase }) });
    const pickup = director.tick([event('rocketPrepare'), event('mode', 2)], rocketFrame(0, 'anticipation'), 0);
    expect(pickup).toContainEqual({ type: 'rocket', phase: 'powered', offset: 0 });
    expect(starts(pickup)).toHaveLength(0);
    director.tick([], rocketFrame(1, 'launch', 'paused'), 1);
    const resumed = director.tick([], rocketFrame(1, 'launch'), 2);
    expect(resumed).toContainEqual({ type: 'rocket', phase: 'powered', offset: 1 });
    const fall = director.tick([event('rocketEnd', 3, { gameTime: 2 })], rocketFrame(2, 'fall'), 3);
    expect(fall).toContainEqual({ type: 'rocket', phase: 'fall', offset: 2 });
    expect(starts(fall)).toHaveLength(0);
    const beds = fall.flatMap(c => c.type === 'beds' ? c.targets : []);
    expect(beds.filter(b => b.id === 'thrust' || b.id === 'wind').every(b => b.gain === 0)).toBe(true);
    expect(director.tick([], frame(), 4)).toContainEqual({ type: 'rocket', phase: 'off', offset: 0 });
  });
});

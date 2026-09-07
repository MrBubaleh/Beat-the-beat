import type { SfxConfig } from './config';
import type { BedTarget, SfxBus, SfxCommand, SfxEvent, SfxFrame, SfxId, VoiceRequest } from './types';
import { clamp } from './types';

interface ActiveVoice { request: VoiceRequest; priority: number; end: number; }
export interface SfxMetrics {
  started: number; grouped: number; cooldown: number; budget: number;
  stale: number; duplicate: number; stolen: number; active: number; peak: number;
}
const freshMetrics = (): SfxMetrics => ({ started: 0, grouped: 0, cooldown: 0, budget: 0, stale: 0, duplicate: 0, stolen: 0, active: 0, peak: 0 });
const busGains = (): Record<SfxBus, number> => ({ impact: 1, ability: 1, pickup: 1, movement: 1, foley: 1 });

export class SfxDirector {
  private active: ActiveVoice[] = [];
  private last = new Map<SfxId, { at: number; strength: number }>();
  private voiceId = 0;
  private sequence = 0;
  private run = -1;
  private rng = 0x73a915;
  private lastNow: number | null = null;
  private previous: SfxFrame | null = null;
  private ladder = 0;
  private pending = new Map<SfxId, { count: number; at: number }>();
  private nextHoof = 0;
  private hoofIndex = 0;
  private hitDuckUntil = -1;
  private abilityDuckUntil = -1;
  private ended = false;
  private rocketStartedAt: number | null = null;
  private metrics = freshMetrics();

  constructor(private config: SfxConfig) {}

  configure(config: SfxConfig): void { this.config = config; }
  get diagnostics(): Readonly<SfxMetrics> { return { ...this.metrics, active: this.active.length }; }

  reset(): void {
    this.active = [];
    this.last.clear();
    this.sequence = 0;
    this.run = -1;
    this.rng = 0x73a915;
    this.lastNow = null;
    this.previous = null;
    this.ladder = 0;
    this.pending.clear();
    this.nextHoof = 0;
    this.hoofIndex = 0;
    this.hitDuckUntil = -1;
    this.abilityDuckUntil = -1;
    this.ended = false;
    this.rocketStartedAt = null;
    this.metrics = freshMetrics();
  }

  tick(events: readonly SfxEvent[], frame: SfxFrame, now: number): SfxCommand[] {
    if (!Number.isFinite(now)) return [];
    const commands: SfxCommand[] = [];
    if (events.length && this.run !== events[0].run) {
      if (this.run !== -1) { commands.push({ type: 'silence' }); this.reset(); }
      this.run = events[0].run;
    }
    const dt = this.lastNow === null ? 0 : clamp(now - this.lastNow, 0, 0.1);
    this.lastNow = now;
    this.active = this.active.filter(v => v.end > now);
    this.trim(commands);
    const playable = this.config.enabled && (frame.phase === 'running' || frame.phase === 'gameOver');
    if (!playable) {
      if (this.active.length || this.previous?.phase === 'running' || !this.config.enabled) commands.push({ type: 'silence' });
      this.active = [];
      this.nextHoof = now;
      this.last.clear();
      this.ladder = 0;
      this.pending.clear();
      this.sequence = Math.max(this.sequence, ...events.map(e => e.sequence));
      this.previous = { ...frame, state: { ...frame.state } };
      return commands;
    }
    const packet = new Map<SfxId, SfxEvent>();
    for (const event of events) {
      if (event.sequence <= this.sequence || event.run !== this.run) { this.metrics.duplicate++; continue; }
      this.sequence = event.sequence;
      if (event.id !== 'gameOver' && frame.state.gameTime - event.gameTime > this.config.staleMs / 1000) {
        this.metrics.stale++; continue;
      }
      const old = packet.get(event.id);
      if (old) this.metrics.grouped += event.count;
      packet.set(event.id, {
        ...event, count: Math.min(12, event.count + (old?.count ?? 0)),
        strength: Math.max(event.strength, old?.strength ?? 0),
      });
    }
    if (frame.state.gameOver || frame.phase === 'gameOver') {
      if (!this.ended) {
        commands.push({ type: 'silence' });
        this.active = [];
        this.start(packet.get('gameOver') ?? this.synthetic('gameOver', frame, 1), now, commands);
        this.ended = true;
      }
      this.previous = { ...frame, state: { ...frame.state } };
      return commands;
    }
    if (packet.has('nitroStart') && packet.has('nitroEnd') && !frame.state.nitroActive) packet.delete('nitroStart');
    if (packet.has('hit')) {
      for (const id of ['land', 'nearMiss', 'lane', 'nitroEnd', 'combo'] as SfxId[]) packet.delete(id);
    }
    if (packet.has('rocketLaunch') || packet.has('rocketPrepare')) packet.delete('mode');
    if (packet.has('nitroReady') || packet.has('nitroStart')) packet.delete('canister');
    if (packet.has('nitroStart')) packet.delete('nitroReady');
    if (packet.has('nearMiss')) packet.delete('lane');
    for (const id of ['rocketPrepare', 'rocketLaunch', 'rocketEnd'] as SfxId[]) packet.delete(id);
    if (packet.has('fullRepair')) {
      commands.push({ type: 'sample', id: 'fullRepair' });
      packet.delete('fullRepair');
    }
    const rocket = frame.state.mode === 'rocket';
    if (!rocket) this.rocketStartedAt = null;
    else this.rocketStartedAt ??= frame.state.gameTime;
    commands.push({ type: 'rocket', phase: !rocket ? 'off' : frame.state.rocketPhase === 'fall' ? 'fall' : 'powered',
      offset: Math.max(0, frame.state.gameTime - (this.rocketStartedAt ?? frame.state.gameTime)) });
    const sorted = [...packet.values()].sort((a, b) => this.config.patches[b.id].priority - this.config.patches[a.id].priority);
    for (const event of sorted) this.start(event, now, commands);

    const state = frame.state;
    const moving = state.speed > this.config.profiles[state.mode].minSpeed;
    const grounded = state.airState === 'grounded' || state.airState === 'trainRoof';
    if (state.mode === 'horse' && grounded && !state.sliding && moving) {
      const profile = this.config.profiles.horse;
      const speed = clamp((state.speed - profile.minSpeed) / (profile.maxSpeed - profile.minSpeed));
      const hz = (this.config.motion.hoofMinHz + speed * (this.config.motion.hoofMaxHz - this.config.motion.hoofMinHz)) * clamp(frame.tutorialScale, 0.1, 1);
      if (now >= this.nextHoof) {
        const accents = [0.95, 0.58, 0.82, 0.46];
        const rhythm = [0.76, 1.18, 0.84, 1.22];
        const i = this.hoofIndex++ % 4;
        const hoof = this.synthetic('hoof', frame, accents[i]);
        hoof.pan = i % 2 ? 0.12 : -0.12;
        this.start(hoof, now, commands);
        this.nextHoof = now + rhythm[i] / hz;
      }
    } else {
      this.nextHoof = now;
    }
    commands.push({ type: 'beds', targets: this.beds(frame, dt) });
    const gains = busGains();
    const hit = this.duckAmount(this.hitDuckUntil, now);
    const ability = this.duckAmount(this.abilityDuckUntil, now);
    const cfg = this.config.duck;
    gains.movement = 10 ** (Math.min(cfg.movementDb * hit, cfg.abilityMovementDb * ability) / 20);
    gains.pickup = 10 ** (cfg.pickupDb * hit / 20);
    gains.foley = 10 ** (cfg.foleyDb * hit / 20);
    commands.push({ type: 'duck', gains });
    this.previous = { ...frame, state: { ...frame.state } };
    return commands;
  }

  private synthetic(id: SfxId, frame: SfxFrame, strength: number): SfxEvent {
    return { id, run: this.run, sequence: 0, gameTime: frame.state.gameTime,
      mode: frame.state.mode, speed: frame.state.speed, pan: 0, strength, surface: frame.state.airState === 'trainRoof' ? 'metal' : 'ground', count: 1 };
  }

  private start(event: SfxEvent, now: number, commands: SfxCommand[]): void {
    const p = this.config.patches[event.id];
    const prev = this.last.get(event.id);
    if (prev && now - prev.at < p.cooldownMs / 1000 &&
      !(event.id === 'hit' && event.strength > prev.strength + 0.15)) {
      this.metrics.cooldown += event.count;
      if (p.bus === 'pickup' || event.id === 'smash') {
        const pending = this.pending.get(event.id);
        this.pending.set(event.id, { count: Math.min(12, (pending?.count ?? 0) + event.count), at: now });
        this.metrics.grouped += event.count;
      }
      return;
    }
    const same = this.active.filter(v => v.request.event === event.id);
    const pickup = this.active.filter(v => v.request.bus === 'pickup');
    const candidates = same.length >= p.maxVoices ? same :
      p.bus === 'pickup' && pickup.length >= this.config.maxPickupVoices ? pickup :
        this.active.length >= this.config.maxVoices ? this.active : [];
    if (candidates.length) {
      const victim = candidates.filter(v => v.priority <= p.priority).sort((a, b) => a.priority - b.priority || a.request.at - b.request.at)[0];
      if (!victim) { this.metrics.budget++; return; }
      commands.push({ type: 'stop', voiceId: victim.request.voiceId });
      this.active = this.active.filter(v => v !== victim);
      this.metrics.stolen++;
    }
    const pending = this.pending.get(event.id);
    const count = Math.min(12, event.count + (pending && now - pending.at < this.config.ladder.resetMs / 1000 ? pending.count : 0));
    this.pending.delete(event.id);
    let cents = 0;
    if (event.id === 'coin') {
      this.ladder = prev && now - prev.at < this.config.ladder.resetMs / 1000
        ? Math.min(this.config.ladder.steps - 1, this.ladder + 1) : 0;
      cents = this.ladder * this.config.ladder.stepCents;
    }
    this.rng ^= this.rng << 13; this.rng ^= this.rng >>> 17; this.rng ^= this.rng << 5;
    const variation = (this.rng >>> 0) / 4294967296;
    cents += (variation * 2 - 1) * p.jitterCents;
    const massDuration = ['hit', 'smash', 'land'].includes(event.id) ? 0.72 + event.strength * 0.45 : 1;
    const duration = (p.attackMs + p.decayMs + p.tailMs) / 1000 * massDuration;
    const request: VoiceRequest = {
      voiceId: ++this.voiceId, event: event.id, mode: event.mode, bus: p.bus,
      gain: p.gain * (1 - p.strengthGain * (1 - event.strength)) * (1 + Math.min(count - 1, 3) * 0.025),
      pitch: 2 ** (cents / 1200) * (1 + clamp(event.speed / this.config.profiles[event.mode].maxSpeed) * p.speedPitch),
      pan: clamp(event.pan, -this.config.motion.panMax, this.config.motion.panMax),
      strength: event.strength, surface: event.surface, duration, at: now,
    };
    this.active.push({ request, priority: p.priority, end: now + duration + 0.02 });
    commands.push({ type: 'start', voice: request });
    this.last.set(event.id, { at: now, strength: event.strength });
    this.metrics.started++;
    this.metrics.peak = Math.max(this.metrics.peak, this.active.length);
    if (event.id === 'hit' || event.id === 'land') this.hitDuckUntil = now + this.config.duck.holdMs / 1000;
    if (event.id === 'nitroStart' || event.id === 'rocketLaunch') this.abilityDuckUntil = now + this.config.duck.holdMs / 1000;
  }

  private trim(commands: SfxCommand[]): void {
    for (const voice of [...this.active].sort((a, b) => a.priority - b.priority)) {
      const same = this.active.filter(v => v.request.event === voice.request.event);
      const pickupOverflow = voice.request.bus === 'pickup' && this.active.filter(v => v.request.bus === 'pickup').length > this.config.maxPickupVoices;
      if (this.active.length <= this.config.maxVoices && same.length <= this.config.patches[voice.request.event].maxVoices && !pickupOverflow) continue;
      commands.push({ type: 'stop', voiceId: voice.request.voiceId });
      this.active = this.active.filter(v => v !== voice);
    }
  }

  private duckAmount(until: number, now: number): number {
    return now <= until ? 1 : clamp(1 - (now - until) / (this.config.duck.releaseMs / 1000));
  }

  private beds(frame: SfxFrame, dt: number): BedTarget[] {
    const s = frame.state;
    const cfg = this.config;
    const profile = cfg.profiles[s.mode];
    const speed = clamp((s.speed - profile.minSpeed) / (profile.maxSpeed - profile.minSpeed));
    const prev = this.previous?.phase === 'running' && this.previous.state.mode === s.mode ? this.previous.state : null;
    const acceleration = prev && dt > 0 ? clamp((s.speed - prev.speed) / dt / cfg.motion.accelerationScale) : 0;
    const airborne = s.airState === 'airborne' || s.airState === 'landing' || s.mode === 'rocket';
    const pitch = cfg.motion.tutorialPitchFloor + (1 - cfg.motion.tutorialPitchFloor) * clamp(frame.tutorialScale);
    const load = (cfg.motion.cruiseLoad + (1 - cfg.motion.cruiseLoad) * acceleration) * (airborne ? cfg.motion.airLoad : 1);
    const laneVelocity = prev && dt > 0 ? clamp((s.laneX - prev.laneX) / dt / 25, -1, 1) : 0;
    const vertical = prev && dt > 0 ? clamp(Math.abs(s.y - prev.y) / dt / 12) : 0;
    const pan = laneVelocity * cfg.motion.panMax * 0.5;
    const rocket = s.mode === 'rocket';
    const thrust = rocket ? (s.rocketPhase === 'anticipation' ? 0.35 : s.rocketPhase === 'fall' ? 0.08 : 0.85) : s.nitroActive ? 0.7 : 0;
    const targets: BedTarget[] = [
      { id: 'motor', gain: profile.motorGain * (cfg.palette.motor.idleFloor + (1 - cfg.palette.motor.idleFloor) * speed) * Math.sqrt(load) * (s.nitroActive ? 0.55 : 1),
        hz: (profile.baseHz + speed * (profile.maxHz - profile.baseHz) + acceleration * 12) * pitch,
        filterHz: profile.filterHz * (0.55 + speed * 0.45 + acceleration * 0.25), pan: 0, pulseHz: 18 + speed * 24, toneMix: 0.8, load },
      { id: 'wind', gain: (rocket ? 0 : profile.windGain) * speed ** 1.4 * (thrust > 0 ? 0.75 : 1),
        hz: 70, filterHz: (cfg.motion.windMinHz + speed * (cfg.motion.windMaxHz - cfg.motion.windMinHz)) * pitch * (1 + vertical * 0.2),
        pan, pulseHz: 0.7, toneMix: 0 },
      { id: 'thrust', gain: rocket ? 0 : cfg.motion.thrustGain * thrust, hz: (rocket ? 82 + speed * 32 : 135) * pitch,
        filterHz: rocket && s.rocketPhase === 'anticipation' ? 420 : (rocket ? 1500 : 2100) * pitch,
        pan: 0, pulseHz: rocket ? 28 : 38, toneMix: rocket ? 0.25 : 0.15 },
      { id: 'slide', gain: s.mode === 'horse' && s.sliding ? cfg.motion.slideGain * (0.4 + speed * 0.6) : 0,
        hz: 110, filterHz: 650 + speed * 700, pan, pulseHz: 7, toneMix: 0 },
    ];
    for (const target of targets) target.filterHz = clamp(target.filterHz, 80, 12000);
    return targets;
  }
}

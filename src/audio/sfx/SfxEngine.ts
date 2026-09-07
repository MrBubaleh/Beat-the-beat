import { RocketSample } from './RocketSample';
import { LevelSamples } from './LevelSamples';
import { buildPaletteVoice } from './SfxPalette';
import { createMotor } from './SfxMotor';
import type { SfxConfig, SfxPatch } from '@core/sfx/config';
import type { BedTarget, SfxBus, SfxCommand, VoiceRequest } from '@core/sfx/types';
import { clamp, SFX_BUSES } from '@core/sfx/types';

interface Sound {
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  output: GainNode;
  end: number;
  disposed: boolean;
}
interface Bed extends Sound {
  update(target: BedTarget, at: number): void;
}
export interface EngineMetrics {
  voices: number; beds: number; retiring: number; nodes: number;
  peakNodes: number; peakVoices: number; errors: number; lastError: string;
}

export class SfxEngine {
  private readonly master: GainNode;
  private readonly safety: DynamicsCompressorNode;
  private readonly highpass: BiquadFilterNode;
  private readonly buses = new Map<SfxBus, GainNode>();
  private readonly duck = new Map<SfxBus, GainNode>();
  private readonly voices = new Map<number, Sound>();
  private readonly retiring: Sound[] = [];
  private readonly beds = new Map<BedTarget['id'], Bed>();
  private readonly sounds = new Set<Sound>();
  private readonly noiseBuffer: AudioBuffer;
  private readonly paletteNoise: AudioBuffer;
  private peakNodes = 0;
  private peakVoices = 0;
  private errors = 0;
  private lastError = '';
  private disposed = false;
  private readonly rocket: RocketSample;
  private readonly levelSamples: LevelSamples;
  private readonly ownsLevelSamples: boolean;
  get ready(): Promise<void> { return this.rocket.ready; }

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    private config: SfxConfig,
    rocketDestination?: AudioNode,
    levelSamples?: LevelSamples,
  ) {
    this.master = ctx.createGain();
    this.master.gain.value = config.enabled ? config.masterGain : 0;
    this.highpass = ctx.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = 42;
    this.highpass.Q.value = 0.6;
    this.safety = ctx.createDynamicsCompressor();
    this.safety.threshold.value = -12;
    this.safety.knee.value = 9;
    this.safety.ratio.value = 3;
    this.safety.attack.value = 0.003;
    this.safety.release.value = 0.12;
    this.highpass.connect(this.safety);
    this.safety.connect(this.master);
    this.master.connect(destination);
    for (const id of SFX_BUSES) {
      const bus = ctx.createGain();
      const duck = ctx.createGain();
      bus.gain.value = config.buses[id];
      bus.connect(duck);
      duck.connect(this.highpass);
      this.buses.set(id, bus);
      this.duck.set(id, duck);
    }
    this.rocket = new RocketSample(
      ctx,
      rocketDestination ?? this.buses.get('ability')!,
      config.rocketSample,
    );
    this.levelSamples = levelSamples ?? new LevelSamples(
      ctx,
      this.buses.get('ability')!,
      config.levelSamples,
    );
    this.ownsLevelSamples = !levelSamples;
    const samples = Math.ceil(ctx.sampleRate * 2);
    this.noiseBuffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    this.paletteNoise = ctx.createBuffer(1, samples, ctx.sampleRate);
    const whiteData = this.paletteNoise.getChannelData(0);
    let seed = 0x2919a1;
    let low = 0;
    let peak = 0;
    for (let i = 0; i < samples; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const white = (seed >>> 0) / 2147483648 - 1;
      whiteData[i] = white * 0.85;
      low = low * 0.96 + white * 0.04;
      data[i] = white * 0.55 + low * 2.4;
      peak = Math.max(peak, Math.abs(data[i]));
    }
    const seam = Math.min(1024, Math.floor(samples / 4));
    for (let i = 0; i < seam; i++) {
      const t = i / seam;
      data[samples - seam + i] = data[samples - seam + i] * (1 - t) + data[i] * t;
    }
    for (let i = 0; i < samples; i++) data[i] *= 0.65 / Math.max(peak, 0.1);
  }

  get diagnostics(): EngineMetrics {
    let nodes = this.disposed ? 0 : 13;
    for (const sound of this.sounds) nodes += sound.nodes.length;
    nodes += this.rocket.nodes;
    this.peakNodes = Math.max(this.peakNodes, nodes);
    return { voices: this.voices.size, beds: this.beds.size, retiring: this.retiring.length,
      nodes, peakNodes: this.peakNodes, peakVoices: this.peakVoices, errors: this.errors, lastError: this.lastError || this.rocket.error };
  }

  configure(config: SfxConfig, at = this.ctx.currentTime): void {
    this.config = config;
    this.rocket.configure(config.rocketSample);
    this.levelSamples.configure(config.levelSamples);
    this.lastError = '';
    this.target(this.master.gain, config.enabled ? config.masterGain : 0, at);
    for (const id of SFX_BUSES) this.target(this.buses.get(id)!.gain, config.buses[id], at);
    if (!config.enabled) this.silence(at);
    while (this.voices.size > config.maxVoices) this.stop(this.voices.keys().next().value!, at);
    this.limitRetiring();
  }

  apply(commands: readonly SfxCommand[], at = this.ctx.currentTime): void {
    if (this.disposed || this.lastError) return;
    try {
      for (const [id, voice] of this.voices) if (voice.end <= at) this.voices.delete(id);
      for (const command of commands) {
        if (command.type === 'silence') { this.silence(at); continue; }
        if (!this.config.enabled) continue;
        if (command.type === 'stop') this.stop(command.voiceId, at);
        if (command.type === 'rocket') this.rocket.update(command, at);
        if (command.type === 'sample' && command.id === 'fullRepair') {
          this.levelSamples.playFullRepair(at);
        }
        if (command.type === 'start') this.start(command.voice, at);
        if (command.type === 'beds') this.updateBeds(command.targets, at);
        if (command.type === 'duck') {
          for (const id of SFX_BUSES) this.target(this.duck.get(id)!.gain, command.gains[id], at, 0.012);
        }
      }
      void this.diagnostics;
    } catch (error) {
      this.errors++;
      this.lastError = error instanceof Error ? error.message : String(error);
      for (const sound of [...this.sounds]) this.destroy(sound);
      this.voices.clear(); this.beds.clear(); this.retiring.length = 0;
      this.master.gain.setValueAtTime(0, at);
    }
  }

  silence(at = this.ctx.currentTime): void {
    this.rocket.silence(at);
    for (const id of [...this.voices.keys()]) this.stop(id, at);
    for (const bed of this.beds.values()) this.release(bed, at);
    this.beds.clear();
    for (const node of this.duck.values()) this.target(node.gain, 1, at);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rocket.dispose();
    if (this.ownsLevelSamples) this.levelSamples.dispose();
    for (const sound of [...this.sounds]) this.destroy(sound);
    this.voices.clear(); this.beds.clear(); this.retiring.length = 0;
    for (const bus of this.buses.values()) bus.disconnect();
    for (const duck of this.duck.values()) duck.disconnect();
    this.master.disconnect(); this.safety.disconnect(); this.highpass.disconnect();
  }

  private target(param: AudioParam, value: number, at: number, tau = this.config.smoothingMs / 1000): void {
    param.setTargetAtTime(value, at, tau);
  }

  private envelope(gain: AudioParam, peak: number, at: number, attack: number, decay: number, tail: number): void {
    gain.setValueAtTime(0, at);
    gain.linearRampToValueAtTime(Math.max(0.00001, peak), at + attack);
    gain.exponentialRampToValueAtTime(Math.max(0.00001, peak * 0.08), at + attack + decay);
    gain.exponentialRampToValueAtTime(0.00001, at + attack + decay + tail * 0.9);
    gain.linearRampToValueAtTime(0, at + attack + decay + tail);
  }

  private start(request: VoiceRequest, now: number): void {
    if (this.voices.has(request.voiceId)) return;
    if (this.voices.size >= this.config.maxVoices) return;
    const p = this.config.patches[request.event];
    const at = Math.max(now, request.at);
    const output = this.ctx.createGain();
    output.gain.setValueAtTime(request.gain, at);
    const pan = this.ctx.createStereoPanner();
    pan.pan.setValueAtTime(request.pan, at);
    pan.connect(output);
    output.connect(this.buses.get(request.bus)!);
    const sound: Sound = { nodes: [output, pan], sources: [], output,
      end: at + request.duration + 0.02, disposed: false };
    this.sounds.add(sound);
    this.voices.set(request.voiceId, sound);
    if (!buildPaletteVoice(this.ctx, this.paletteNoise, sound, pan, this.config, request, at)) {
      const metal = request.surface === 'metal';
      const horseContact = request.mode === 'horse' && ['hit', 'land'].includes(request.event);
      const modePitch = request.event === 'mode' ? (request.mode === 'horse' ? 1.2 : request.mode === 'rocket' ? 0.75 : 1) : 1;
      const impactMass = ['hit', 'smash', 'land'].includes(request.event) ? 1.12 - request.strength * 0.3 : 1;
      const pitch = request.pitch * (horseContact ? 0.85 : modePitch) * impactMass * (metal ? 1.16 : 1);
      const durationScale = request.duration / ((p.attackMs + p.decayMs + p.tailMs) / 1000);
      const attack = p.attackMs / 1000 * durationScale;
      const decay = p.decayMs / 1000 * durationScale;
      const tail = p.tailMs / 1000 * durationScale;
      let weights = 0;
      for (let i = 0; i < p.partials.length; i++) weights += 1 / (1 + i * 2);
      p.partials.forEach((ratio, index) => {
        const osc = this.ctx.createOscillator();
        const amp = this.ctx.createGain();
        const offset = index * 0.002;
        const weight = p.toneMix / weights / (1 + index * 2) * (horseContact && index > 0 ? (metal ? 0.7 : 0.3) : 1);
        osc.type = index === 0 && ['hit', 'smash', 'land', 'hoof'].includes(request.event) ? 'triangle' : 'sine';
        const end = clamp(p.endHz * ratio * pitch, 25, this.ctx.sampleRate * 0.4);
        osc.frequency.setValueAtTime(clamp(p.bodyHz * ratio * pitch, 25, this.ctx.sampleRate * 0.4), at + offset);
        osc.frequency.exponentialRampToValueAtTime(end, at + attack + decay);
        this.envelope(amp.gain, weight, at + offset, attack, decay / (1 + index * 0.45), tail / (1 + index * 0.35));
        osc.connect(amp); amp.connect(pan);
        sound.nodes.push(osc, amp); sound.sources.push(osc);
        osc.start(at + offset);
      });
      this.addNoise(sound, pan, p, at, attack, decay, tail, horseContact ? (metal ? 1 : 0.65) : (metal ? 1.15 : 1), horseContact && request.event === 'land');
    }
    let remaining = sound.sources.length;
    for (const source of sound.sources) {
      source.onended = () => {
        if (--remaining > 0) return;
        if (this.voices.get(request.voiceId) === sound) this.voices.delete(request.voiceId);
        this.destroy(sound);
      };
      source.stop(sound.end);
    }
    this.peakVoices = Math.max(this.peakVoices, this.voices.size);
  }

  private addNoise(sound: Sound, target: AudioNode, p: SfxPatch, at: number, attack: number, decay: number, tail: number, material: number, doubleContact: boolean): void {
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer; noise.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = p.q;
    filter.frequency.setValueAtTime(p.filterHz * material, at);
    filter.frequency.exponentialRampToValueAtTime(p.filterEndHz * material, at + attack + decay + tail);
    const amp = this.ctx.createGain();
    this.envelope(amp.gain, p.noiseMix * 1.5, at, Math.max(0.002, attack), decay * 0.7, tail);
    if (doubleContact && decay > 0.05) {
      amp.gain.cancelScheduledValues(at);
      amp.gain.setValueAtTime(0, at);
      amp.gain.linearRampToValueAtTime(p.noiseMix, at + attack);
      amp.gain.exponentialRampToValueAtTime(Math.max(0.00001, p.noiseMix * 0.12), at + attack + 0.018);
      amp.gain.linearRampToValueAtTime(p.noiseMix * 0.55, at + attack + 0.035);
      amp.gain.exponentialRampToValueAtTime(0.00001, at + attack + decay + tail * 0.9);
      amp.gain.linearRampToValueAtTime(0, at + attack + decay + tail);
    }
    noise.connect(filter); filter.connect(amp); amp.connect(target);
    sound.nodes.push(noise, filter, amp); sound.sources.push(noise);
    noise.start(at, (at * 0.731) % 1.7);
  }

  private stop(id: number, at: number): void {
    const voice = this.voices.get(id);
    if (!voice) return;
    this.voices.delete(id);
    this.release(voice, at);
    this.retiring.push(voice);
    this.limitRetiring();
  }

  private release(sound: Sound, at: number): void {
    if (sound.disposed) return;
    const end = at + this.config.fadeMs / 1000;
    sound.output.gain.cancelAndHoldAtTime(at);
    sound.output.gain.linearRampToValueAtTime(0, end);
    sound.end = Math.min(sound.end, end + 0.005);
    for (const source of sound.sources) source.stop(sound.end);
  }

  private limitRetiring(): void {
    for (let i = this.retiring.length - 1; i >= 0; i--) {
      if (this.retiring[i].disposed) this.retiring.splice(i, 1);
    }
    while (this.retiring.length > this.config.maxRetiring) this.destroy(this.retiring.shift()!);
  }

  private destroy(sound: Sound): void {
    if (sound.disposed) return;
    sound.disposed = true;
    for (const source of sound.sources) {
      source.onended = null;
      try { source.stop(); } catch {}
    }
    for (const node of sound.nodes) node.disconnect();
    this.sounds.delete(sound);
    const i = this.retiring.indexOf(sound);
    if (i >= 0) this.retiring.splice(i, 1);
  }

  private updateBeds(targets: BedTarget[], at: number): void {
    for (const target of targets) {
      let bed = this.beds.get(target.id);
      if (target.gain <= 0.0001) {
        if (bed) { this.release(bed, at); this.beds.delete(target.id); }
        continue;
      }
      if (!bed) { bed = this.createBed(target, at); this.beds.set(target.id, bed); }
      this.target(bed.output.gain, target.gain, at);
      bed.update(target, at);
    }
  }

  private createBed(target: BedTarget, at: number): Bed {
    const output = this.ctx.createGain(); output.gain.value = 0;
    if (target.id === 'motor') {
      const motor = createMotor(this.ctx, this.paletteNoise, output, target, this.config.palette.motor);
      output.connect(this.buses.get('movement')!);
      const bed: Bed = { output, end: Infinity, disposed: false,
        nodes: [output, ...motor.nodes], sources: motor.sources,
        update: (t, time) => motor.update(t, this.config.palette.motor, time, this.config.smoothingMs / 1000) };
      this.startBed(bed, at);
      return bed;
    }
    const oscillator = this.ctx.createOscillator();
    oscillator.setPeriodicWave(this.ctx.createPeriodicWave(new Float32Array(5), new Float32Array([0, 1, 0.38, 0.16, 0.06])));
    oscillator.frequency.value = target.hz;
    const tone = this.ctx.createGain(); tone.gain.value = target.toneMix * 0.4;
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = this.noiseBuffer; noiseSource.loop = true;
    const noise = this.ctx.createGain(); noise.gain.value = (1 - target.toneMix * 0.7) * 0.9;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = target.id === 'wind' ? 380 : 95;
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.value = target.filterHz; filter.Q.value = 0.7;
    const pulse = this.ctx.createGain(); pulse.gain.value = 0.9;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = target.pulseHz;
    const depth = this.ctx.createGain(); depth.gain.value = 0.025;
    const pan = this.ctx.createStereoPanner(); pan.pan.value = target.pan;
    oscillator.connect(tone); tone.connect(filter);
    noiseSource.connect(hp); hp.connect(noise); noise.connect(filter);
    filter.connect(pulse); lfo.connect(depth); depth.connect(pulse.gain);
    pulse.connect(pan); pan.connect(output);
    output.connect(this.buses.get('movement')!);
    const bed: Bed = { output, end: Infinity, disposed: false,
      update: (t, time) => {
        this.target(oscillator.frequency, t.hz, time);
        this.target(filter.frequency, t.filterHz, time);
        this.target(tone.gain, t.toneMix * 0.4, time);
        this.target(noise.gain, (1 - t.toneMix * 0.7) * 0.9, time);
        this.target(pan.pan, t.pan, time);
        this.target(lfo.frequency, t.pulseHz, time);
      },
      nodes: [output, oscillator, tone, noiseSource, noise, hp, filter, pulse, lfo, depth, pan],
      sources: [oscillator, noiseSource, lfo] };
    this.startBed(bed, at);
    return bed;
  }

  private startBed(bed: Bed, at: number): void {
    this.sounds.add(bed);
    let remaining = bed.sources.length;
    for (const source of bed.sources) {
      source.onended = () => { if (--remaining === 0) this.destroy(bed); };
      source.start(at);
    }
  }
}

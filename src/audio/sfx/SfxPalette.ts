import type { SfxConfig, SfxPatch } from '@core/sfx/config';
import type { VoiceRequest } from '@core/sfx/types';
import { clamp } from '@core/sfx/types';

export interface VoiceNodes {
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
}
type Shape = readonly (readonly [number, number])[];

export function contour(param: AudioParam, peak: number, at: number, duration: number, points: Shape): void {
  param.setValueAtTime(0, at);
  for (const [t, value] of points) param.linearRampToValueAtTime(peak * value, at + duration * t);
  param.linearRampToValueAtTime(0, at + duration);
}

class Layers {
  constructor(private ctx: BaseAudioContext, private buffer: AudioBuffer, private voice: VoiceNodes,
    private out: AudioNode, private seed: number) {}

  tone(hz: number, endHz: number, gain: number, at: number, duration: number, shape: Shape, fm?: { ratio: number; depth: number }): void {
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.frequency.setValueAtTime(clamp(hz, 25, this.ctx.sampleRate * 0.4), at);
    osc.frequency.exponentialRampToValueAtTime(clamp(endHz, 25, this.ctx.sampleRate * 0.4), at + duration * 0.7);
    contour(amp.gain, gain, at, duration, shape);
    osc.connect(amp); amp.connect(this.out);
    this.voice.nodes.push(osc, amp); this.voice.sources.push(osc);
    if (fm) {
      const mod = this.ctx.createOscillator();
      const depth = this.ctx.createGain();
      mod.frequency.value = Math.min(hz * fm.ratio, this.ctx.sampleRate * 0.4);
      contour(depth.gain, hz * fm.depth, at, duration, [[0.005, 1], [0.18, 0.12], [0.55, 0.01]]);
      mod.connect(depth); depth.connect(osc.frequency);
      this.voice.nodes.push(mod, depth); this.voice.sources.push(mod); mod.start(at);
    }
    osc.start(at);
  }

  noise(hz: number, endHz: number, q: number, gain: number, at: number, duration: number, shape: Shape,
    type: BiquadFilterType = 'bandpass', highpass = 0): void {
    const source = this.ctx.createBufferSource(); source.buffer = this.buffer; source.loop = true;
    const filter = this.ctx.createBiquadFilter(); filter.type = type; filter.Q.value = q;
    filter.frequency.setValueAtTime(clamp(hz, 80, this.ctx.sampleRate * 0.4), at);
    filter.frequency.exponentialRampToValueAtTime(clamp(endHz, 80, this.ctx.sampleRate * 0.4), at + duration * 0.85);
    const amp = this.ctx.createGain(); contour(amp.gain, gain, at, duration, shape);
    source.connect(filter);
    if (highpass > 0) {
      const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = highpass;
      filter.connect(hp); hp.connect(amp); this.voice.nodes.push(hp);
    } else filter.connect(amp);
    amp.connect(this.out);
    this.voice.nodes.push(source, filter, amp); this.voice.sources.push(source);
    this.seed = Math.imul(this.seed ^ 0x9e3779b9, 1664525) >>> 0;
    source.start(at, (this.seed / 4294967296) * (this.buffer.duration - 0.1));
  }
}

export function buildPaletteVoice(ctx: BaseAudioContext, noise: AudioBuffer, voice: VoiceNodes, out: AudioNode,
  cfg: SfxConfig, request: VoiceRequest, at: number): boolean {
  if (!['hit', 'canister', 'smash', 'coin', 'hoof', 'beat'].includes(request.event)) return false;
  const p: SfxPatch = cfg.patches[request.event];
  const layer = new Layers(ctx, noise, voice, out, request.voiceId);
  const d = request.duration;
  const attack = clamp(p.attackMs / (p.attackMs + p.decayMs + p.tailMs), 0.003, 0.12);
  const pitch = request.pitch;
  const strength = clamp(request.strength);
  const body: Shape = [[attack, 1], [0.12, 0.6], [0.38, 0.18], [0.72, 0.025]];
  switch (request.event) {
    case 'hit': {
      const material = request.mode === 'horse' ? 0.6 : 1;
      const mass = 1.15 - strength * 0.32;
      const c = cfg.palette.hit;
      layer.tone(p.bodyHz * pitch * mass, p.endHz * pitch * mass, p.toneMix, at, d, body);
      layer.noise(c.contactHz * material, c.contactHz * 0.7 * material, p.q, c.contactMix * p.noiseMix,
        at, d * 0.13, [[0.03, 1], [0.24, 0.5], [0.6, 0.05]]);
      layer.noise(p.filterHz * material, p.filterEndHz * material, 0.7, p.noiseMix * (0.3 + strength * 0.55),
        at + d * 0.025, d * 0.7, [[0.015, 0.35], [0.1, 1], [0.25, 0.32], [0.42, 0.45], [0.65, 0.07]]);
      for (const [i, ratio] of p.partials.slice(0, 2).entries()) {
        layer.tone(c.ringHz * ratio * pitch, c.ringHz * ratio * pitch * 0.97,
          c.ringMix * p.toneMix * material / (i + 1), at + d * 0.018, d * 0.94, body);
      }
      break;
    }
    case 'canister': {
      const c = cfg.palette.canister;
      layer.noise(c.valveHz, c.valveHz * 0.7, 2.5, c.valveMix, at, d * 0.09,
        [[0.07, 1], [0.2, 0.32], [0.6, 0.08]]);
      layer.noise(p.filterHz, p.filterEndHz, p.q, p.noiseMix * 1.7, at + d * 0.025, d * 0.95,
        [[0.06, 0.8], [c.hold, 1], [0.72, 0.48], [0.9, 0.08]], 'lowpass', c.airHighpassHz);
      layer.tone(p.bodyHz * pitch, p.endHz * pitch, p.toneMix * c.pressureMix,
        at + d * 0.08, d * 0.82, [[0.12, 0.4], [0.38, 1], [0.7, 0.28], [0.9, 0.03]]);
      break;
    }
    case 'smash': {
      const c = cfg.palette.smash;
      layer.noise(c.crackHz, p.filterHz, 0.65, p.noiseMix * 1.25, at, d * 0.14,
        [[0.015, 1], [0.2, 0.45], [0.36, 0.8], [0.7, 0.08]], 'lowpass', 550);
      layer.tone(p.bodyHz * pitch, p.endHz * pitch, p.toneMix * 0.72, at + d * 0.015, d * 0.5, body);
      layer.tone(p.bodyHz * p.partials.at(-1)! * pitch, p.endHz * p.partials.at(-1)! * pitch,
        p.toneMix * 0.38, at + d * 0.03, d * 0.6, body);
      const fragments: [number, number][] = [];
      for (let i = 0; i < c.fragments; i++) {
        const t = 0.03 + i * 0.8 / c.fragments;
        const weight = (1 - i / c.fragments) * (i % 2 ? 0.65 : 1);
        fragments.push([t, 0], [t + 0.007, weight], [t + 0.065, weight * 0.08], [t + 0.1, 0]);
      }
      layer.noise(p.filterHz, p.filterEndHz, 1.5, c.debrisMix * p.noiseMix,
        at + d * 0.12, d * 0.86, fragments, 'bandpass');
      break;
    }
    case 'coin': {
      const c = cfg.palette.coin;
      const ring: Shape = [[attack, 1], [0.16, 0.58], [0.46, 0.16], [0.8, 0.025]];
      layer.tone(p.bodyHz * pitch, p.endHz * pitch, p.toneMix * 0.8, at, d, ring,
        { ratio: c.fmRatio, depth: c.fmDepth });
      layer.tone(p.bodyHz * (p.partials[1] ?? 2.71) * pitch, p.endHz * (p.partials[1] ?? 2.71) * pitch,
        p.toneMix * c.shimmerMix, at + d * 0.014, d * 0.68, ring);
      layer.noise(p.filterHz, p.filterEndHz, 0.7, p.noiseMix, at, d * 0.1,
        [[0.04, 1], [0.3, 0.15]], 'highpass');
      break;
    }
    case 'beat': {
      const tick: Shape = [[attack, 1], [0.2, 0.4], [0.55, 0.06]];
      layer.tone(p.bodyHz * pitch, p.endHz * pitch, p.toneMix * 0.8, at, d, tick);
      layer.noise(p.filterHz, p.filterEndHz, p.q, p.noiseMix, at, d * 0.12,
        [[0.05, 1], [0.35, 0.12]], 'highpass');
      break;
    }
    case 'hoof': {
      const c = cfg.palette.hoof;
      const metal = request.surface === 'metal';
      const variant = 0.94 + (request.voiceId % 4) * 0.04;
      const gap = Math.min(c.contactGapMs / 1000, d * 0.3);
      layer.tone(c.shellHz * pitch * variant * (metal ? 1.28 : 1), c.shellHz * pitch * variant * 0.94,
        c.shellMix * p.toneMix, at, d * 0.55, [[0.025, 1], [0.13, 0.25], [0.42, 0.04]]);
      layer.tone(p.bodyHz * pitch, p.endHz * pitch, p.toneMix * 0.45,
        at + gap, d - gap, [[0.025, 1], [0.2, 0.3], [0.55, 0.03]]);
      layer.noise(p.filterHz * (metal ? 1.4 : 1), p.filterEndHz, metal ? 2.2 : 0.85,
        c.soleMix * p.noiseMix, at, d,
        [[gap / d * 0.08, 1], [gap / d * 0.6, 0.1], [gap / d, 0.06], [gap / d + 0.04, 0.65], [0.58, 0.06], [0.85, 0.01]]);
      break;
    }
  }
  return true;
}
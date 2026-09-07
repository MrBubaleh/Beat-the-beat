import { SfxDirector } from '@core/sfx/SfxDirector';
import type { SfxConfig } from '@core/sfx/config';
import type { SfxId, VoiceRequest } from '@core/sfx/types';
import { SfxEngine } from './SfxEngine';
import { SfxScenario, SFX_DEMO_SECONDS } from './SfxScenario';

export function measureAudio(buffer: AudioBuffer) {
  let peak = 0, sum = 0, tailSum = 0, tailN = 0, nonFinite = 0, clipped = 0, hash = 2166136261;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      if (!Number.isFinite(value)) { nonFinite++; continue; }
      peak = Math.max(peak, Math.abs(value)); sum += value * value;
      if (Math.abs(value) >= 0.999) clipped++;
      if (i >= data.length - buffer.sampleRate * 0.5) { tailSum += value * value; tailN++; }
      if (ch === 0 && i % 16 === 0) hash = Math.imul(hash ^ Math.round(value * 32767), 16777619);
    }
  }
  return { peak, rms: Math.sqrt(sum / (buffer.length * buffer.numberOfChannels)),
    tailRms: Math.sqrt(tailSum / Math.max(1, tailN)), nonFinite, clipped,
    seconds: buffer.duration, hash: hash >>> 0 };
}

export async function renderSfxPatch(config: SfxConfig, id: SfxId) {
  const p = config.patches[id];
  const duration = (p.attackMs + p.decayMs + p.tailMs) / 1000;
  const ctx = new OfflineAudioContext(2, Math.ceil((duration + 1) * 44100), 44100);
  const engine = new SfxEngine(ctx, ctx.destination, config);
  const voice: VoiceRequest = { voiceId: 1, event: id, mode: id === 'hoof' ? 'horse' : 'car',
    bus: p.bus, gain: p.gain, pitch: 1, pan: 0, strength: 0.7, duration, at: 0.1 };
  engine.apply([{ type: 'start', voice }], 0);
  const buffer = await ctx.startRendering();
  const diagnostics = engine.diagnostics;
  engine.dispose();
  return { buffer, metrics: measureAudio(buffer), diagnostics };
}

export async function renderSfxDemo(config: SfxConfig) {
  const ctx = new OfflineAudioContext(2, Math.ceil(SFX_DEMO_SECONDS * 44100), 44100);
  const engine = new SfxEngine(ctx, ctx.destination, config);
  await engine.ready;
  const director = new SfxDirector(config);
  const scenario = new SfxScenario();
  let frame = 0;
  const schedule = (limit: number) => {
    while (frame / 60 < limit) {
      const t = frame++ / 60;
      const input = scenario.step(t);
      engine.apply(director.tick(input.events, input.frame, t), t);
    }
  };
  schedule(0.5);
  let waiting = ctx.suspend(0.5);
  const rendering = ctx.startRendering();
  for (let end = 1; end <= SFX_DEMO_SECONDS; end += 0.5) {
    await waiting;
    schedule(end);
    if (end < SFX_DEMO_SECONDS) waiting = ctx.suspend(end);
    await ctx.resume();
  }
  const buffer = await rendering;
  const diagnostics = { director: director.diagnostics, engine: engine.diagnostics };
  engine.dispose();
  return { buffer, metrics: measureAudio(buffer), diagnostics };
}

export function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const channels = buffer.numberOfChannels;
  const bytes = buffer.length * channels * 2;
  const output = new ArrayBuffer(44 + bytes);
  const view = new DataView(output);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, bytes, true);
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(44 + (i * channels + ch) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    }
  }
  return output;
}

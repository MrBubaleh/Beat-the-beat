import { SfxDirector } from '@core/sfx/SfxDirector';
import { sfxConfigSchema } from '@core/sfx/config';
import type { SfxConfig } from '@core/sfx/config';
import type { SfxEvent, SfxFrame, SfxId } from '@core/sfx/types';
import { SfxEngine } from '@audio/sfx/SfxEngine';
import { measureAudio } from '@audio/sfx/SfxOffline';
import { LegacySfxEngine } from './LegacySfxEngine';
import legacyRaw from './sfx-legacy.json';

export const COMPARISON_IDS = ['hit', 'canister', 'smash', 'coin', 'motor', 'hoof'] as const;
export type ComparisonId = typeof COMPARISON_IDS[number];
export const COMPARISON_REFERENCE_GAIN = legacyRaw.masterGain;
const seconds = 5;

async function render(config: SfxConfig, id: ComparisonId, legacy: boolean) {
  const cfg = legacy ? sfxConfigSchema.parse({ ...legacyRaw, palette: config.palette }) : structuredClone(config);
  cfg.enabled = true;
  cfg.masterGain = COMPARISON_REFERENCE_GAIN;
  const ctx = new OfflineAudioContext(2, seconds * 44100, 44100);
  const engine = legacy ? new LegacySfxEngine(ctx, ctx.destination, cfg) : new SfxEngine(ctx, ctx.destination, cfg);
  const director = new SfxDirector(cfg);
  let cursor = 0, sequence = 0, frame = 0;
  const contacts = id === 'hoof' ? [0.25, 0.4, 0.63, 0.8, 1.12, 1.25, 1.47, 1.63, 1.93, 2.05, 2.25, 2.4, 2.68, 2.8, 3, 3.14] :
    id === 'canister' || id === 'coin' ? [0.25, 1.5, 1.57, 1.64, 1.71, 1.78, 1.85, 1.92, 1.99, 2.06, 2.13, 2.2, 2.27, 2.34, 2.41] : [0.25, 1.9];
  const schedule = (limit: number) => {
    while (frame / 60 < limit) {
      const t = frame++ / 60;
      const speed = t < 2 ? 9 + t * 13 : t < 3 ? 35 : Math.max(9, 35 - (t - 3) * 19);
      const input: SfxFrame = { phase: t < 4.1 ? 'running' : 'finished', tutorialScale: 1,
        state: { gameTime: t, mode: 'car', speed, lane: 2, laneX: 0, y: 0, airState: 'grounded',
          nitroActive: false, nitroReady: false, sliding: false, rocketPhase: 'none', combo: 0, gameOver: false,
          damageState: 'normal' } };
      const events: SfxEvent[] = [];
      if (id !== 'motor') while (cursor < contacts.length && contacts[cursor] <= t) {
        const index = cursor++;
        events.push({ id: id as SfxId, run: 501, sequence: ++sequence, gameTime: t,
          mode: id === 'hoof' ? 'horse' : 'car', speed, pan: 0, count: 1,
          strength: id === 'hoof' ? [0.95, 0.58, 0.82, 0.46][index % 4] : index === 0 ? 0.4 : 0.9 });
      }
      const commands = director.tick(events, input, t).filter(c => id === 'motor' || c.type !== 'beds');
      for (const command of commands) if (command.type === 'beds') {
        command.targets = command.targets.filter(b => b.id === 'motor');
        if (legacy) for (const bed of command.targets) {
          const p = cfg.profiles.car;
          bed.gain = p.motorGain * Math.max(0, Math.min(1, (speed - p.minSpeed) / (p.maxSpeed - p.minSpeed))) * (bed.load ?? 0.32);
        }
      }
      engine.apply(commands, t);
    }
  };
  schedule(0.5);
  let waiting = ctx.suspend(0.5);
  const rendering = ctx.startRendering();
  for (let end = 1; end <= seconds; end += 0.5) {
    await waiting; schedule(end);
    if (end < seconds) waiting = ctx.suspend(end);
    await ctx.resume();
  }
  const buffer = await rendering;
  const diagnostics = engine.diagnostics;
  engine.dispose();
  return { buffer, diagnostics, metrics: measureAudio(buffer), weightedRms: await weightedRms(buffer) };
}

async function weightedRms(buffer: AudioBuffer): Promise<number> {
  const ctx = new OfflineAudioContext(2, buffer.length, buffer.sampleRate);
  const source = ctx.createBufferSource(); source.buffer = buffer;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 60; hp.Q.value = 0.5;
  const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 1500; shelf.gain.value = 4;
  source.connect(hp); hp.connect(shelf); shelf.connect(ctx.destination); source.start();
  const weighted = await ctx.startRendering();
  const energies: number[] = [];
  const block = Math.round(buffer.sampleRate * 0.2);
  for (let start = 0; start < buffer.length; start += block) {
    let energy = 0;
    const end = Math.min(buffer.length, start + block);
    for (let ch = 0; ch < 2; ch++) {
      const data = weighted.getChannelData(ch);
      for (let i = start; i < end; i++) energy += data[i] ** 2;
    }
    energies.push(energy / (2 * (end - start)));
  }
  const gate = Math.max(...energies) * 0.01;
  const active = energies.filter(e => e > Math.max(gate, 1e-14));
  return Math.sqrt(active.reduce((a, b) => a + b, 0) / Math.max(1, active.length));
}

export async function renderComparison(config: SfxConfig, id: ComparisonId) {
  const before = await render(config, id, true);
  const after = await render(config, id, false);
  const target = Math.min(0.045, ...[before, after].map(r => Math.min(32 * r.weightedRms, 0.45 * r.weightedRms / Math.max(r.metrics.peak, 1e-8))));
  const gains = [before, after].map(r => Math.min(32, target / Math.max(r.weightedRms, 1e-8)));
  return { before, after, gains, target };
}
export type Comparison = Awaited<ReturnType<typeof renderComparison>>;

export function comparisonReport(pair: Comparison) {
  return { before: { ...pair.before.metrics, weightedRms: pair.before.weightedRms, diagnostics: pair.before.diagnostics },
    after: { ...pair.after.metrics, weightedRms: pair.after.weightedRms, diagnostics: pair.after.diagnostics },
    gains: pair.gains, matchedWeightedRms: [pair.before.weightedRms * pair.gains[0], pair.after.weightedRms * pair.gains[1]] };
}

export function comparisonWavBuffer(ctx: BaseAudioContext, pair: Comparison, matched: boolean, volume = 1): AudioBuffer {
  const sampleRate = pair.before.buffer.sampleRate;
  const gap = Math.round(sampleRate * 0.4);
  const result = ctx.createBuffer(2, pair.before.buffer.length + pair.after.buffer.length + gap, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const out = result.getChannelData(ch);
    for (const [index, value] of [pair.before, pair.after].entries()) {
      const data = value.buffer.getChannelData(ch);
      const offset = index === 0 ? 0 : pair.before.buffer.length + gap;
      const gain = (matched ? pair.gains[index] : 1) * volume;
      for (let i = 0; i < data.length; i++) out[offset + i] = data[i] * gain;
    }
  }
  return result;
}
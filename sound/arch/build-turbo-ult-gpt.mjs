#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const RATE = 44100;
const FRAMES = 564480;
const DURATION = FRAMES / RATE;
const TIMING = { launch: 2.5, plateau: 5.5, cruise: 6.35, cutoff: 10.27, landing: 11.27 };
const MIX = {
  rocketGain: 1,
  turboGain: 0.92,
  windGain: 1.1,
  windSideGain: 1.2,
  windHighpassHz: 1700,
  windLowpassHz: 7600,
  launchBlendSeconds: 0.006,
  landingBlendSeconds: 0.05,
  limiterKnee: 0.885,
  limiterCeiling: 0.945,
};
const PHASES = [
  ['Anticipation', 0, 2.5], ['Launch', 2.5, 5.5], ['Plateau', 5.5, 6.35],
  ['Cruise', 6.35, 10.27], ['Fall', 10.27, 11.27], ['Touchdown & fade', 11.27, 12.8],
];
const clamp01 = x => Math.max(0, Math.min(1, x));
const fade = (time, start, duration) => {
  const x = clamp01((time - start) / duration);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const db = x => 20 * Math.log10(Math.max(1e-12, x));

function readWav(name) {
  const bytes = readFileSync(new URL(name, import.meta.url));
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE'
      || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error(`${name}: invalid RIFF/WAVE`);
  let format, payload;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const tag = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > bytes.length) throw new Error(`${name}: truncated ${tag}`);
    if (tag === 'fmt ') {
      if (length < 16) throw new Error(`${name}: truncated format`);
      format = { pcm: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2),
        rate: bytes.readUInt32LE(start + 4), byteRate: bytes.readUInt32LE(start + 8),
        block: bytes.readUInt16LE(start + 12), bits: bytes.readUInt16LE(start + 14) };
    }
    if (tag === 'data') payload = bytes.subarray(start, start + length);
    offset = start + length + (length & 1);
  }
  if (!format || !payload || format.pcm !== 1 || format.channels !== 2 || format.rate !== RATE
      || format.bits !== 16 || format.block !== 4 || format.byteRate !== RATE * 4
      || payload.length !== FRAMES * 4) throw new Error(`${name}: expected 12.80 s stereo PCM16 / 44100 Hz`);
  const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
  for (let i = 0; i < FRAMES; i++) for (let c = 0; c < 2; c++) channels[c][i] = payload.readInt16LE(i * 4 + c * 2) / 32768;
  return channels;
}

class Biquad {
  constructor(kind, frequency, q = Math.SQRT1_2) {
    const w = 2 * Math.PI * frequency / RATE;
    const cos = Math.cos(w), alpha = Math.sin(w) / (2 * q), norm = 1 / (1 + alpha);
    const numerator = kind === 'highpass' ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
      : [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    [this.b0, this.b1, this.b2] = numerator.map(x => x * norm);
    this.a1 = -2 * cos * norm; this.a2 = (1 - alpha) * norm;
    this.z1 = 0; this.z2 = 0;
  }
  tick(input) {
    const output = input * this.b0 + this.z1;
    this.z1 = input * this.b1 - output * this.a1 + this.z2;
    this.z2 = input * this.b2 - output * this.a2;
    return output;
  }
}

function extractAir(channels) {
  return channels.map(channel => {
    const chain = [new Biquad('highpass', MIX.windHighpassHz, 0.5411961),
      new Biquad('highpass', MIX.windHighpassHz, 1.306563),
      new Biquad('lowpass', MIX.windLowpassHz)];
    const result = new Float32Array(FRAMES);
    for (let i = 0; i < FRAMES; i++) result[i] = chain.reduce((x, filter) => filter.tick(x), channel[i]);
    return result;
  });
}

function softLimit(x) {
  const magnitude = Math.abs(x);
  if (magnitude <= MIX.limiterKnee) return x;
  const headroom = MIX.limiterCeiling - MIX.limiterKnee;
  return Math.sign(x) * (MIX.limiterKnee + headroom * Math.tanh((magnitude - MIX.limiterKnee) / headroom));
}

function mix(rocket, turbo, air) {
  const output = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
  let limited = 0, preLimitPeak = 0;
  for (let i = 0; i < FRAMES; i++) {
    const t = i / RATE;
    const middle = fade(t, TIMING.launch, MIX.launchBlendSeconds)
      * (1 - fade(t, TIMING.landing - MIX.landingBlendSeconds, MIX.landingBlendSeconds));
    const turboWeight = Math.sin(middle * Math.PI / 2);
    const rocketWeight = Math.cos(middle * Math.PI / 2);
    const plateau = fade(t, TIMING.plateau, 0.09) * (1 - fade(t, TIMING.cruise, 0.16));
    const windEnvelope = fade(t, TIMING.launch + 0.08, 1.65)
      * (1 - fade(t, TIMING.landing - 0.17, 0.17)) * (0.83 + 0.27 * plateau);
    const airMid = (air[0][i] + air[1][i]) * 0.5;
    const airSide = (air[0][i] - air[1][i]) * 0.5 * MIX.windSideGain;
    for (let c = 0; c < 2; c++) {
      const wind = (airMid + (c === 0 ? airSide : -airSide)) * MIX.windGain * windEnvelope;
      const value = rocket[c][i] * rocketWeight * MIX.rocketGain + turbo[c][i] * turboWeight * MIX.turboGain + wind;
      if (!Number.isFinite(value)) throw new Error(`Non-finite sample at frame ${i}`);
      preLimitPeak = Math.max(preLimitPeak, Math.abs(value));
      if (Math.abs(value) > MIX.limiterKnee) limited++;
      output[c][i] = softLimit(value) * (1 - fade(t, DURATION - 0.04, 0.04));
    }
  }
  return { output, preLimitPeak, limitedPercent: limited / (FRAMES * 2) * 100 };
}

function encode(channels) {
  const bytes = Buffer.alloc(44 + FRAMES * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(RATE, 24); bytes.writeUInt32LE(RATE * 4, 28); bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(FRAMES * 4, 40);
  let state = 0x31854271;
  const random = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  for (let i = 0; i < FRAMES; i++) for (let c = 0; c < 2; c++) {
    const pcm = i === 0 || i >= FRAMES - 64 ? 0 : Math.round(channels[c][i] * 32768 + random() - random());
    if (Math.abs(pcm / 32768) > 0.95) throw new Error('PCM peak exceeds 0.95');
    bytes.writeInt16LE(pcm, 44 + i * 4 + c * 2);
  }
  return bytes;
}

function measure(channels, start, end) {
  const first = Math.round(start * RATE), last = Math.round(end * RATE);
  const sums = [0, 0], peaks = [0, 0];
  let cross = 0;
  for (let i = first; i < last; i++) {
    for (let c = 0; c < 2; c++) {
      sums[c] += channels[c][i] ** 2;
      peaks[c] = Math.max(peaks[c], Math.abs(channels[c][i]));
    }
    cross += channels[0][i] * channels[1][i];
  }
  return { peakL: peaks[0], peakR: peaks[1], rmsL: Math.sqrt(sums[0] / (last - first)),
    rmsR: Math.sqrt(sums[1] / (last - first)), rmsDbFS: db(Math.sqrt((sums[0] + sums[1]) / (2 * (last - first)))),
    correlation: cross / Math.sqrt(sums[0] * sums[1]) };
}

const rocket = readWav('./rocket-flight.wav');
const turbo = readWav('./turbo-synth.wav');
const cinematic = readWav('./rocket-flight-cinematic.wav');
const { output, preLimitPeak, limitedPercent } = mix(rocket, turbo, extractAir(cinematic));
const bytes = encode(output);
writeFileSync(new URL('./turbo-ult-gpt.wav', import.meta.url), bytes);
const saved = readWav('./turbo-ult-gpt.wav');
if (!bytes.subarray(bytes.length - 256).every(x => x === 0)) throw new Error('Non-silent tail');
const report = {
  duration: DURATION, frames: FRAMES, sampleRate: RATE, channels: 2, bitsPerSample: 16,
  sourceMap: { beginning: 'rocket-flight.wav', flight: 'turbo-synth.wav', landingAndTail: 'rocket-flight.wav',
    air: 'rocket-flight-cinematic.wav: 1700 Hz highpass / 7600 Hz lowpass, stereo enhancement; filtered mixture, not an isolated stem' },
  timing: TIMING, mix: MIX, preLimitPeak, limitedPercent,
  peakType: 'sample peak from saved PCM', master: measure(saved, 0, DURATION),
  phases: PHASES.map(([name, start, end]) => ({ name, start, end, ...measure(saved, start, end) })),
  sourcePhaseRms: PHASES.map(([name, start, end]) => ({ name, rocket: measure(rocket, start, end).rmsDbFS,
    turbo: measure(turbo, start, end).rmsDbFS, cinematic: measure(cinematic, start, end).rmsDbFS })),
};
writeFileSync(new URL('./turbo-ult-gpt.stats.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(`turbo-ult-gpt.wav | ${DURATION.toFixed(2)} s | stereo PCM16 ${RATE} Hz | ${bytes.length} bytes`);
console.log(`Sample peak ${Math.max(report.master.peakL, report.master.peakR).toFixed(6)}; limiter active ${limitedPercent.toFixed(3)}%`);
console.table(report.phases.map(p => ({ phase: p.name, peak: Math.max(p.peakL, p.peakR).toFixed(5), rmsDbFS: p.rmsDbFS.toFixed(2) })));

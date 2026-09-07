#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const PI2 = Math.PI * 2;
const CEILING = 0.95;

const T = {
  launch: 2.5,
  land: 11.27,
  end: 12.8,
  startX0: 2.47,
  startX1: 2.54,
  endX0: 11.18,
  endX1: 11.34,
};

const PHASES = [
  ['1 Anticipation', 0, 2.5],
  ['2 Launch', 2.5, 5.5],
  ['3 Plateau', 5.5, 6.35],
  ['4 Cruise', 6.35, 10.27],
  ['5 Fall', 10.27, 11.27],
  ['6 Touchdown', 11.27, 12.8],
];

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function loadWav(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV: ' + path);
  }
  const ch = b.readUInt16LE(22);
  const sr = b.readUInt32LE(24);
  const bits = b.readUInt16LE(34);
  if (sr !== SR || bits !== 16 || ch !== 2) {
    throw new Error(`Expected 44.1kHz stereo 16-bit: ${path} (sr=${sr} ch=${ch} bits=${bits})`);
  }
  const n = Math.floor((b.length - 44) / 4);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let o = 44;
  for (let i = 0; i < n; i++) {
    L[i] = b.readInt16LE(o) / 32768;
    R[i] = b.readInt16LE(o + 2) / 32768;
    o += 4;
  }
  return { L, R, n };
}

class Biquad {
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
    this.x1 = 0; this.x2 = 0;
    this.y1 = 0; this.y2 = 0;
  }

  highpass(freq, q) {
    const f = clamp(freq, 20, SR * 0.45);
    const Q = Math.max(0.2, q);
    const w0 = PI2 * f / SR;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    const b = (1 + cos) * 0.5;
    const a0 = 1 + alpha;
    this.b0 = b / a0; this.b1 = -(1 + cos) / a0; this.b2 = b / a0;
    this.a1 = (-2 * cos) / a0; this.a2 = (1 - alpha) / a0;
  }

  bandpass(freq, q) {
    const f = clamp(freq, 20, SR * 0.45);
    const Q = Math.max(0.2, q);
    const w0 = PI2 * f / SR;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0; this.b1 = 0; this.b2 = -alpha / a0;
    this.a1 = (-2 * cos) / a0; this.a2 = (1 - alpha) / a0;
  }

  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = Number.isFinite(y) ? y : 0;
    return this.y1;
  }
}

function equalPower(t, t0, t1) {
  const u = clamp((t - t0) / (t1 - t0), 0, 1);
  return [Math.cos(u * Math.PI * 0.5), Math.sin(u * Math.PI * 0.5)];
}

function windGain(t) {
  if (t < T.launch) return 0;
  if (t < 5.5) return lerp(0.42, 0.78, (t - T.launch) / 3);
  if (t < 6.35) return lerp(0.78, 1, (t - 5.5) / 0.85);
  if (t < 10.27) return 0.88;
  if (t < T.land) return lerp(0.88, 0.55, (t - 10.27) / 1);
  return 0;
}

function stats(L, R, a, b) {
  const i0 = Math.max(0, Math.floor(a * SR));
  const i1 = Math.min(L.length, Math.floor(b * SR));
  let peakL = 0, peakR = 0, accL = 0, accR = 0;
  const n = Math.max(1, i1 - i0);
  for (let i = i0; i < i1; i++) {
    const al = Math.abs(L[i]);
    const ar = Math.abs(R[i]);
    if (al > peakL) peakL = al;
    if (ar > peakR) peakR = ar;
    accL += L[i] * L[i];
    accR += R[i] * R[i];
  }
  return { peakL, peakR, rmsL: Math.sqrt(accL / n), rmsR: Math.sqrt(accR / n) };
}

function db(x) {
  return 20 * Math.log10(Math.max(x, 1e-12));
}

function fmt(x) {
  return x.toFixed(4).padStart(8);
}

function writeWav(L, R) {
  const n = L.length;
  const dataBytes = n * 4;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const sl = clamp(L[i], -1, 1);
    const sr = clamp(R[i], -1, 1);
    buf.writeInt16LE(sl < 0 ? Math.round(sl * 32768) : Math.round(sl * 32767), o);
    buf.writeInt16LE(sr < 0 ? Math.round(sr * 32768) : Math.round(sr * 32767), o + 2);
    o += 4;
  }
  return buf;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const start = loadWav(join(root, 'sound', 'rocket-flight.wav'));
const power = loadWav(join(root, 'sound', 'turbo-synth.wav'));
const cine = loadWav(join(root, 'sound', 'rocket-flight-cinematic.wav'));
const n = Math.min(start.n, power.n, cine.n);

const hpL = new Biquad();
const hpR = new Biquad();
const bpL = new Biquad();
const bpR = new Biquad();
hpL.highpass(1050, 0.68);
hpR.highpass(1120, 0.68);
bpL.bandpass(2650, 0.9);
bpR.bandpass(2850, 0.9);

const outL = new Float32Array(n);
const outR = new Float32Array(n);

for (let i = 0; i < n; i++) {
  const t = i / SR;
  let gStart = 0;
  let gPower = 0;
  if (t < T.startX0) {
    gStart = 1;
  } else if (t < T.startX1) {
    const x = equalPower(t, T.startX0, T.startX1);
    gStart = x[0];
    gPower = x[1];
  } else if (t < T.endX0) {
    gPower = 1;
  } else if (t < T.endX1) {
    const x = equalPower(t, T.endX0, T.endX1);
    gPower = x[0];
    gStart = x[1];
  } else {
    gStart = 1;
  }

  const wind = windGain(t);
  const airL = hpL.process(cine.L[i]) * 0.72 + bpL.process(cine.L[i]) * 0.55;
  const airR = hpR.process(cine.R[i]) * 0.72 + bpR.process(cine.R[i]) * 0.55;
  const mid = (airL + airR) * 0.5;
  const side = (airL - airR) * 0.5;
  const wideL = mid + side * 1.55;
  const wideR = mid - side * 1.55;

  outL[i] = start.L[i] * gStart + power.L[i] * gPower * 0.9 + wideL * wind * 0.38;
  outR[i] = start.R[i] * gStart + power.R[i] * gPower * 0.9 + wideR * wind * 0.38;
}

function softLimit(x) {
  const a = Math.abs(x);
  if (a <= 0.86) return x;
  const extra = a - 0.86;
  const y = 0.86 + extra / (1 + extra * 3.4);
  return Math.sign(x) * Math.min(CEILING, y);
}

let peak = 0;
for (let i = 0; i < n; i++) {
  outL[i] = softLimit(outL[i]);
  outR[i] = softLimit(outR[i]);
  peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
}
const gain = peak > CEILING ? CEILING / peak : 1;
if (gain < 1) {
  for (let i = 0; i < n; i++) {
    outL[i] *= gain;
    outR[i] *= gain;
  }
}

const outPath = join(root, 'sound', 'turbo-ult-grok.wav');
const wav = writeWav(outL, outR);
writeFileSync(outPath, wav);

const master = stats(outL, outR, 0, T.end);
console.log('turbo-ult-grok.wav');
console.log(`Duration: ${(n / SR).toFixed(2)} s  |  ${SR} Hz stereo 16-bit PCM`);
console.log(`File: ${outPath}`);
console.log(`Size: ${(wav.length / 1024).toFixed(1)} KB`);
console.log(`True peak: ${peak.toFixed(4)}  (soft limit, makeup ${gain.toFixed(3)})`);
console.log('');
console.log('Phase                         Peak L   Peak R    RMS L    RMS R   RMS dB');
for (const [name, a, b] of PHASES) {
  const s = stats(outL, outR, a, b);
  const rms = 0.5 * (s.rmsL + s.rmsR);
  const label = `${name} ${a.toFixed(2)}–${b.toFixed(2)}s`.padEnd(28);
  console.log(`${label} ${fmt(s.peakL)} ${fmt(s.peakR)} ${fmt(s.rmsL)} ${fmt(s.rmsR)}  ${db(rms).toFixed(1)}`);
}
const rms = 0.5 * (master.rmsL + master.rmsR);
console.log(`${'MASTER 0.00–12.80s'.padEnd(28)} ${fmt(master.peakL)} ${fmt(master.peakR)} ${fmt(master.rmsL)} ${fmt(master.rmsR)}  ${db(rms).toFixed(1)}`);

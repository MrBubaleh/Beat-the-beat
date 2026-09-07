#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const DT = 1 / SR;
const PI2 = Math.PI * 2;
const PEAK_CEILING = 0.95;
const G_FALL = 18;

const T = Object.freeze({
  launch: 2.5,
  choke: 2.42,
  snap: 2.45,
  plateau: 5.5,
  cruise: 6.35,
  starve: 9.5,
  fall: 10.27,
  land: 11.27,
  end: 12.8,
});

const PHASES = [
  ['1 Anticipation', 0, T.launch],
  ['2 Launch', T.launch, T.plateau],
  ['3 Plateau', T.plateau, T.cruise],
  ['4 Cruise', T.cruise, T.fall],
  ['5 Fall', T.fall, T.land],
  ['6 Touchdown', T.land, T.end],
];

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function unlerp(a, b, x) {
  return (x - a) / (b - a);
}

function saturate(x, drive = 1) {
  return Math.tanh(x * drive);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gate(t, start, end, attack, release) {
  if (t < start || t >= end) return 0;
  const a = attack <= 0 ? 1 : Math.min(1, (t - start) / attack);
  const r = release <= 0 ? 1 : Math.min(1, (end - t) / release);
  return a * r;
}

class Biquad {
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
    this.x1 = 0; this.x2 = 0;
    this.y1 = 0; this.y2 = 0;
  }

  _set(b0, b1, b2, a0, a1, a2) {
    const inv = 1 / a0;
    this.b0 = b0 * inv; this.b1 = b1 * inv; this.b2 = b2 * inv;
    this.a1 = a1 * inv; this.a2 = a2 * inv;
  }

  lowpass(freq, q) {
    const f = clamp(freq, 18, SR * 0.45);
    const Q = Math.max(0.15, q);
    const w0 = PI2 * f / SR;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    const b1 = 1 - cos;
    this._set(b1 * 0.5, b1, b1 * 0.5, 1 + alpha, -2 * cos, 1 - alpha);
  }

  highpass(freq, q) {
    const f = clamp(freq, 18, SR * 0.45);
    const Q = Math.max(0.15, q);
    const w0 = PI2 * f / SR;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    const b = (1 + cos) * 0.5;
    this._set(b, -(1 + cos), b, 1 + alpha, -2 * cos, 1 - alpha);
  }

  bandpass(freq, q) {
    const f = clamp(freq, 18, SR * 0.45);
    const Q = Math.max(0.15, q);
    const w0 = PI2 * f / SR;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    this._set(alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha);
  }

  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = Number.isFinite(y) ? y : 0;
    return this.y1;
  }
}

class Comb {
  constructor(maxDelay) {
    this.n = Math.max(4, maxDelay | 0);
    this.buf = new Float32Array(this.n);
    this.w = 0;
  }

  process(x, delay, fb) {
    const d = clamp(delay, 1.1, this.n - 2);
    const r = this.w - d;
    const i0 = Math.floor(r);
    const frac = r - i0;
    const a = this.buf[(i0 % this.n + this.n) % this.n];
    const b = this.buf[((i0 + 1) % this.n + this.n) % this.n];
    const y = a + (b - a) * frac;
    this.buf[this.w] = x + y * fb;
    this.w++;
    if (this.w >= this.n) this.w = 0;
    return y;
  }
}

class Noise {
  constructor(seed) {
    this.rng = mulberry32(seed);
    this.b0 = 0; this.b1 = 0; this.b2 = 0; this.b3 = 0; this.b4 = 0; this.b5 = 0; this.b6 = 0;
    this.brown = 0;
  }

  white() {
    return this.rng() * 2 - 1;
  }

  pink() {
    const w = this.white();
    this.b0 = 0.99886 * this.b0 + w * 0.0555179;
    this.b1 = 0.99332 * this.b1 + w * 0.0750759;
    this.b2 = 0.969 * this.b2 + w * 0.153852;
    this.b3 = 0.8665 * this.b3 + w * 0.3104856;
    this.b4 = 0.55 * this.b4 + w * 0.5329522;
    this.b5 = -0.7616 * this.b5 - w * 0.016898;
    const p = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362;
    this.b6 = w * 0.115926;
    return p * 0.11;
  }

  brownNext() {
    this.brown = clamp(this.brown + this.white() * 0.02, -1, 1);
    this.brown *= 0.996;
    return this.brown;
  }
}

function writeWav16Stereo(l, r) {
  const n = l.length;
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
    const sl = clamp(l[i], -1, 1);
    const sr = clamp(r[i], -1, 1);
    buf.writeInt16LE(sl < 0 ? Math.round(sl * 32768) : Math.round(sl * 32767), o);
    buf.writeInt16LE(sr < 0 ? Math.round(sr * 32768) : Math.round(sr * 32767), o + 2);
    o += 4;
  }
  return buf;
}

function stats(l, r, start, end) {
  const i0 = Math.max(0, Math.floor(start * SR));
  const i1 = Math.min(l.length, Math.floor(end * SR));
  let peakL = 0, peakR = 0, accL = 0, accR = 0;
  const n = Math.max(1, i1 - i0);
  for (let i = i0; i < i1; i++) {
    const al = Math.abs(l[i]);
    const ar = Math.abs(r[i]);
    if (al > peakL) peakL = al;
    if (ar > peakR) peakR = ar;
    accL += l[i] * l[i];
    accR += r[i] * r[i];
  }
  return { peakL, peakR, rmsL: Math.sqrt(accL / n), rmsR: Math.sqrt(accR / n) };
}

function db(x) {
  return 20 * Math.log10(Math.max(x, 1e-12));
}

function fmt(x) {
  return x.toFixed(4).padStart(8);
}

const FORMANTS = [
  { f: 52, q: 2.4, g: 1.15 },
  { f: 98, q: 2.0, g: 0.95 },
  { f: 165, q: 1.7, g: 0.82 },
  { f: 280, q: 1.45, g: 0.62 },
  { f: 470, q: 1.25, g: 0.44 },
  { f: 860, q: 1.15, g: 0.30 },
  { f: 1550, q: 1.05, g: 0.20 },
  { f: 2800, q: 0.95, g: 0.13 },
  { f: 5200, q: 0.85, g: 0.08 },
];

export function generateRocketFlight() {
  const n = Math.round(T.end * SR);
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);

  const nzL = new Noise(0x4e465331);
  const nzR = new Noise(0x48503252);

  const formL = FORMANTS.map(() => new Biquad());
  const formR = FORMANTS.map(() => new Biquad());
  const subLp = new Biquad();
  const subLp2 = new Biquad();
  const bodyLpL = new Biquad();
  const bodyLpR = new Biquad();
  const bodyLp2L = new Biquad();
  const bodyLp2R = new Biquad();
  const gritBpL = new Biquad();
  const gritBpR = new Biquad();
  const turboBpL = new Biquad();
  const turboBpR = new Biquad();
  const airHpL = new Biquad();
  const airHpR = new Biquad();
  const airBpL = new Biquad();
  const airBpR = new Biquad();
  const vacL = new Biquad();
  const vacR = new Biquad();
  const vacHpL = new Biquad();
  const vacHpR = new Biquad();
  const snapBp = new Biquad();
  const boomLp = new Biquad();
  const crackHpL = new Biquad();
  const crackHpR = new Biquad();
  const diveHpL = new Biquad();
  const diveHpR = new Biquad();
  const diveLpL = new Biquad();
  const diveLpR = new Biquad();
  const dustHpL = new Biquad();
  const dustHpR = new Biquad();
  const dcL = new Biquad();
  const dcR = new Biquad();
  const hiL = new Biquad();
  const hiR = new Biquad();
  const loL = new Biquad();
  const loR = new Biquad();
  const sizzleHpL = new Biquad();
  const sizzleHpR = new Biquad();
  const sweepA_L = new Biquad();
  const sweepA_R = new Biquad();
  const sweepB_L = new Biquad();
  const sweepB_R = new Biquad();
  const combL = new Comb(2048);
  const combR = new Comb(2048);
  const haas = new Comb(2048);

  dcL.highpass(16, 0.707);
  dcR.highpass(16, 0.707);

  let phSubA = 0;
  let phSubB = 0;
  let phPulse = 0;
  let phBoom = 0;
  let phSnap = 0;
  let phGust = 0;
  let phFlutter = 0;
  let phGrain = 0;
  let phTurbo = 0;
  let phLand = 0;
  let phCutoff = 0;
  let phStarve = 0;
  let phVib = 0;
  let phGrowl = 0;
  let formLfo = FORMANTS.map((_, i) => i * 1.17);

  for (let i = 0; i < n; i++) {
    const t = i * DT;
    const wL = nzL.white();
    const wR = nzR.white();
    const pL = nzL.pink();
    const pR = nzR.pink();
    const brL = nzL.brownNext();
    const brR = nzR.brownNext();

    const pAnt = clamp(t / T.launch, 0, 1);
    const pClimb = clamp(unlerp(T.launch, T.plateau, t), 0, 1);
    const pPlat = clamp(unlerp(T.plateau, T.cruise, t), 0, 1);
    const starve = t >= T.starve && t < T.fall ? clamp(unlerp(T.starve, T.fall, t), 0, 1) : t >= T.fall ? 1 : 0;
    const powered = gate(t, T.launch, T.fall, 0.03, 0.055);

    phGust += PI2 * 0.87 * DT;
    phFlutter += PI2 * lerp(4.2, 5.1, starve) * DT;
    phGrain += PI2 * 11.5 * DT;
    phTurbo += PI2 * 0.11 * DT;
    phVib += PI2 * (6.1 + starve * 5) * DT;
    phStarve += PI2 * (9.5 + starve * 8) * DT;
    phGrowl += PI2 * 43.5 * DT;
    const gustL = 1 + 0.22 * Math.sin(phGust);
    const gustR = 1 + 0.22 * Math.cos(phGust + 0.7);
    const flutter = 1 + (0.055 + 0.14 * starve) * Math.sin(phFlutter) + starve * 0.07 * Math.sin(phStarve);
    const growl = 1 + 0.16 * Math.sin(phGrowl) + 0.07 * Math.sin(phGrowl * 2.03);

    let choke = 1;
    if (t >= 2.32 && t < T.launch) {
      const drop = clamp((t - 2.32) / 0.035, 0, 1);
      choke = 0.005 + 0.995 * (1 - drop);
    }

    let wall = 0;
    if (t < T.launch) wall = choke;
    else if (t < T.fall) wall = powered;
    else wall = 0;

    let bright = 0.35;
    if (t < T.launch) bright = 0.25 + 0.75 * Math.pow(pAnt, 1.4);
    else if (t < T.plateau) bright = 0.45 + 0.4 * Math.pow(pClimb, 0.85);
    else if (t < T.cruise) bright = 0.88 + 0.12 * pPlat;
    else if (t < T.fall) bright = 0.9 - 0.22 * starve;
    else bright = 0;

    let density = 0.55;
    if (t < T.launch) density = (0.85 + 0.2 * pAnt) * choke;
    else if (t < T.plateau) density = 0.72 + 0.28 * Math.pow(pClimb, 0.7);
    else if (t < T.fall) density = (0.98 - 0.18 * starve) * flutter;
    else density = 0;

    let sub = 0;
    let bodyL = 0;
    let bodyR = 0;
    let airL = 0;
    let airR = 0;
    let fxL = 0;
    let fxR = 0;

    if (wall > 0.001 || t < T.launch) {
      const pulseHz = t < T.launch ? 3 * Math.pow(10, pAnt) : 0;
      if (t < T.launch) {
        phPulse += PI2 * pulseHz * DT;
      }
      const trem = t < T.launch ? 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(phPulse)) : flutter;
      const subHz = t < T.launch ? lerp(34, 48, pAnt) : lerp(40, 46, bright);
      phSubA += PI2 * subHz * DT;
      phSubB += PI2 * (subHz * 1.027) * DT;
      const subOsc = Math.sin(phSubA) + 0.72 * Math.sin(phSubB) + 0.28 * Math.sin(phSubA * 2);
      subLp.lowpass(78 + bright * 30, 0.8);
      subLp2.lowpass(62, 0.7);
      const subNoise = subLp2.process(0.55 * brL + 0.45 * brR);
      const subAmp = (t < T.launch ? 0.58 : 0.44) * density * wall;
      const oscMix = t < T.launch ? 0.38 : 0.7;
      sub = subOsc * oscMix + subNoise * (t < T.launch ? 1.45 : 1.15);
      sub = saturate(subLp.process(sub), 1.65) * trem * subAmp;
    }

    if (wall > 0.001 || t < T.launch) {
      const bodyCut = lerp(180, 430, bright);
      bodyLpL.lowpass(bodyCut, 0.72);
      bodyLpR.lowpass(bodyCut * 1.03, 0.72);
      bodyLp2L.lowpass(bodyCut * 0.55, 0.8);
      bodyLp2R.lowpass(bodyCut * 0.52, 0.8);
      const rawBodyL = bodyLp2L.process(pL * 1.1 + brL * 0.55);
      const rawBodyR = bodyLp2R.process(pR * 1.1 + brR * 0.55);
      const satBodyL = saturate(bodyLpL.process(rawBodyL * 1.8), 1.85);
      const satBodyR = saturate(bodyLpR.process(rawBodyR * 1.8), 1.85);

      gritBpL.bandpass(380 + bright * 220, 1.15);
      gritBpR.bandpass(410 + bright * 230, 1.15);
      const gritL = saturate(gritBpL.process(pL * 2.2), 1.6);
      const gritR = saturate(gritBpR.process(pR * 2.2), 1.6);

      const turboHz = lerp(980, 1680, bright) * (1 + 0.018 * Math.sin(phVib) + 0.01 * Math.sin(phTurbo * 7));
      turboBpL.bandpass(turboHz, 1.35);
      turboBpR.bandpass(turboHz * 1.04, 1.35);
      const turboL = turboBpL.process(pL * 1.6 + wL * 0.25);
      const turboR = turboBpR.process(pR * 1.6 + wR * 0.25);
      const combHz = turboHz * (1 + 0.012 * Math.sin(phVib * 1.3) + starve * 0.04 * Math.sin(phStarve));
      const combDelay = SR / combHz;
      const combFb = 0.38 + 0.12 * bright - 0.08 * starve;
      const combOutL = combL.process(turboL, combDelay, combFb);
      const combOutR = combR.process(turboR, combDelay * 1.017, combFb);

      let formSumL = 0;
      let formSumR = 0;
      for (let k = 0; k < FORMANTS.length; k++) {
        formLfo[k] += PI2 * (3.1 + k * 0.55) * DT;
        const spec = FORMANTS[k];
        const fMod = spec.f * (1 + 0.018 * Math.sin(formLfo[k] * 0.12));
        const gMod = spec.g * (1 + 0.22 * Math.sin(formLfo[k]));
        formL[k].bandpass(fMod, spec.q);
        formR[k].bandpass(fMod * (1.02 + k * 0.004), spec.q);
        const open = k < 4 ? 1 : lerp(0.35, 1, bright);
        formSumL += formL[k].process(pL) * gMod * open;
        formSumR += formR[k].process(pR) * gMod * open;
      }

      const bodyAmp = (t < T.launch ? 0.55 : 0.4) * density * wall * growl;
      bodyL += (satBodyL * 0.85 + gritL * 0.32 + combOutL * 0.22 + formSumL * 0.55) * bodyAmp * gustL;
      bodyR += (satBodyR * 0.85 + gritR * 0.32 + combOutR * 0.22 + formSumR * 0.55) * bodyAmp * gustR;
    }

    if (t < T.launch) {
      const vacHz = 160 * Math.pow(16, pAnt);
      vacHpL.highpass(80 + pAnt * 400, 0.65);
      vacHpR.highpass(90 + pAnt * 420, 0.65);
      vacL.bandpass(vacHz, 0.9 + pAnt * 1.8);
      vacR.bandpass(vacHz * 1.05, 0.9 + pAnt * 1.8);
      const vacAmp = Math.pow(pAnt, 1.15) * 0.62 * choke;
      airL += vacL.process(vacHpL.process(wL)) * vacAmp;
      airR += vacR.process(vacHpR.process(wR)) * vacAmp;
    }

    if (wall > 0.001 && t >= T.launch) {
      const airHp = lerp(900, 2200, bright);
      airHpL.highpass(airHp, 0.65);
      airHpR.highpass(airHp * 1.06, 0.65);
      airBpL.bandpass(lerp(1800, 3400, bright), 0.85);
      airBpR.bandpass(lerp(1950, 3600, bright), 0.85);
      const airAmp = density * wall * lerp(0.28, 0.62, bright);
      airL += (airHpL.process(pL) * 0.7 + airBpL.process(pL) * 0.7 + wL * 0.08) * airAmp * gustL;
      airR += (airHpR.process(pR) * 0.7 + airBpR.process(pR) * 0.7 + wR * 0.08) * airAmp * gustR;

      let sweepA = 820;
      let sweepB = 1680;
      if (t < T.plateau) {
        sweepA = lerp(720, 2100, Math.pow(pClimb, 0.8));
        sweepB = lerp(1400, 3900, Math.pow(pClimb, 0.75));
      } else if (t < T.fall) {
        sweepA = lerp(2100, 1750, starve);
        sweepB = lerp(3900, 3100, starve);
      }
      const vib = 1 + 0.02 * Math.sin(phVib) + 0.012 * Math.sin(phVib * 2.4);
      sweepA_L.bandpass(sweepA * vib, 5.2);
      sweepA_R.bandpass(sweepA * 1.03 * vib, 5.2);
      sweepB_L.bandpass(sweepB * vib, 4.4);
      sweepB_R.bandpass(sweepB * 0.97 * vib, 4.4);
      const sweepAmp = density * wall * lerp(0.16, 0.34, bright);
      airL += (sweepA_L.process(pL) + sweepB_L.process(pL * 0.7 + wL * 0.3)) * sweepAmp;
      airR += (sweepA_R.process(pR) + sweepB_R.process(pR * 0.7 + wR * 0.3)) * sweepAmp;

      sizzleHpL.highpass(6200, 0.55);
      sizzleHpR.highpass(6800, 0.55);
      const sizzle = density * wall * lerp(0.1, 0.28, bright);
      airL += sizzleHpL.process(wL) * sizzle * gustL;
      airR += sizzleHpR.process(wR) * sizzle * gustR;
    }

    if (t >= T.snap && t < T.snap + 0.022) {
      const dtSnap = t - T.snap;
      phSnap += PI2 * 2450 * DT;
      snapBp.bandpass(2850, 3.6);
      const click = Math.sin(phSnap) * Math.exp(-dtSnap * 240);
      const tick = saturate(snapBp.process(wL * 2.8), 3.4) * Math.exp(-dtSnap * 170);
      fxL += (click * 0.5 + tick) * 0.7;
      fxR += (click * 0.45 + tick * 0.92) * 0.7;
    }

    if (t >= T.launch && t < T.launch + 0.38) {
      const dtB = t - T.launch;
      const boomHz = 28 + 155 * Math.exp(-dtB / 0.04);
      phBoom += PI2 * boomHz * DT;
      boomLp.lowpass(170, 0.8);
      const punch = boomLp.process(Math.sin(phBoom) + 0.25 * Math.sin(phBoom * 2) + brL * 0.4);
      fxL += saturate(punch, 2.4) * Math.exp(-dtB / 0.07) * 1.15;
      fxR += saturate(punch, 2.4) * Math.exp(-dtB / 0.07) * 1.15;
      crackHpL.highpass(1400 * Math.exp(-dtB * 2.2) + 350, 0.6);
      crackHpR.highpass(1500 * Math.exp(-dtB * 2.2) + 360, 0.6);
      const crackEnv = Math.exp(-dtB / 0.048);
      fxL += saturate(crackHpL.process(wL * 2.8), 2.8) * crackEnv * 0.78 + wL * crackEnv * 0.5;
      fxR += saturate(crackHpR.process(wR * 2.8), 2.8) * crackEnv * 0.78 + wR * crackEnv * 0.5;
    }

    if (t >= T.fall && t < T.land) {
      const dtF = t - T.fall;
      phCutoff += PI2 * 90 * DT;
      const cutEnv = Math.exp(-dtF / 0.03);
      fxL += (saturate(wL * 1.6, 2.1) * 0.45 + Math.sin(phCutoff) * 0.5) * cutEnv * 0.85;
      fxR += (saturate(wR * 1.6, 2.1) * 0.45 + Math.sin(phCutoff) * 0.46) * cutEnv * 0.85;

      const vN = clamp((G_FALL * dtF) / G_FALL, 0, 1);
      const rush = 0.28 + 0.95 * (vN * vN);
      diveLpL.lowpass(520 + 1600 * vN, 0.7);
      diveLpR.lowpass(500 + 1580 * vN, 0.7);
      diveHpL.highpass(220 + 1100 * vN, 0.6);
      diveHpR.highpass(240 + 1120 * vN, 0.6);
      const residual = Math.exp(-dtF / 0.16) * 0.24;
      airL += (diveLpL.process(pL * 1.3) * 0.8 + diveHpL.process(pL) * 0.55) * (rush + residual);
      airR += (diveLpR.process(pR * 1.3) * 0.8 + diveHpR.process(pR) * 0.55) * (rush + residual);
    }

    if (t >= T.land) {
      const dtLnd = t - T.land;
      if (dtLnd < 0.5) {
        const thumpHz = 24 + 42 * Math.exp(-dtLnd / 0.05);
        phLand += PI2 * thumpHz * DT;
        const thump = (Math.sin(phLand) + 0.22 * Math.sin(phLand * 2) + brL * 0.3) * Math.exp(-dtLnd / 0.085);
        fxL += saturate(thump, 2.0) * 0.95;
        fxR += saturate(thump, 2.0) * 0.95;
        dustHpL.highpass(650, 0.65);
        dustHpR.highpass(700, 0.65);
        const dust = Math.exp(-dtLnd / 0.1);
        fxL += dustHpL.process(pL) * dust * 0.42;
        fxR += dustHpR.process(pR) * dust * 0.42;
      }
      const fade = Math.exp(-dtLnd * 2.2);
      subLp.lowpass(70, 0.75);
      bodyLpL.lowpass(220, 0.7);
      bodyLpR.lowpass(230, 0.7);
      sub += subLp.process(brL) * fade * 0.28;
      airL += bodyLpL.process(pL) * fade * 0.18;
      airR += bodyLpR.process(pR) * fade * 0.18;
    }

    const midBody = (bodyL + bodyR) * 0.5;
    const sideBody = (bodyL - bodyR) * 0.5;
    const width = t >= T.plateau && t < T.fall ? lerp(1.35, 1.75, t < T.cruise ? pPlat : 1) : t < T.launch ? 1.2 : 1.35;
    const bodyMidL = midBody + sideBody * width;
    const bodyMidR = midBody - sideBody * width;
    const airWideR = haas.process(airR, 0.011 * SR, 0);
    const airMixR = t < T.fall ? lerp(airR, airWideR, 0.7) : airR;

    let mixL = sub + bodyMidL + airL + fxL;
    let mixR = sub + bodyMidR + airMixR + fxR;

    const dryL = mixL;
    const dryR = mixR;
    loL.lowpass(160, 0.7);
    loR.lowpass(160, 0.7);
    hiL.highpass(2500, 0.65);
    hiR.highpass(2500, 0.65);
    const lowL = loL.process(mixL);
    const lowR = loR.process(mixR);
    const highL = hiL.process(mixL);
    const highR = hiR.process(mixR);
    const midL = mixL - lowL - highL * 0.35;
    const midR = mixR - lowR - highR * 0.35;
    mixL = saturate(lowL, 1.55) + saturate(midL, 1.12) + highL * 0.92;
    mixR = saturate(lowR, 1.55) + saturate(midR, 1.12) + highR * 0.92;
    mixL = mixL * 0.72 + dryL * 0.28;
    mixR = mixR * 0.72 + dryR * 0.28;

    let master = 1;
    if (t < 0.03) master = t / 0.03;
    if (t > T.end - 0.16) master = Math.max(0, (T.end - t) / 0.16);

    mixL = dcL.process(mixL * master);
    mixR = dcR.process(mixR * master);
    outL[i] = saturate(mixL, 1.08);
    outR[i] = saturate(mixR, 1.08);
  }

  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
  const gain = peak > 1e-8 ? PEAK_CEILING / peak : 1;
  for (let i = 0; i < n; i++) {
    outL[i] = clamp(outL[i] * gain, -PEAK_CEILING, PEAK_CEILING);
    outR[i] = clamp(outR[i] * gain, -PEAK_CEILING, PEAK_CEILING);
  }
  return { l: outL, r: outR, peak: PEAK_CEILING, duration: n / SR };
}

function printReport(l, r, peak, duration, outPath, bytes) {
  const master = stats(l, r, 0, duration);
  console.log('Rocket Flight SFX  (NFS-style wall, game timings)');
  console.log(`Duration: ${duration.toFixed(2)} s  |  ${SR} Hz stereo 16-bit PCM`);
  console.log(`File: ${outPath}`);
  console.log(`Size: ${(bytes / 1024).toFixed(1)} KB`);
  console.log(`True peak: ${peak.toFixed(4)}  (${db(peak).toFixed(2)} dBFS)`);
  console.log('');
  console.log('Phase                         Peak L   Peak R    RMS L    RMS R   RMS dB');
  for (const [name, a, b] of PHASES) {
    const s = stats(l, r, a, b);
    const rms = 0.5 * (s.rmsL + s.rmsR);
    const label = `${name} ${a.toFixed(2)}–${b.toFixed(2)}s`.padEnd(28);
    console.log(`${label} ${fmt(s.peakL)} ${fmt(s.peakR)} ${fmt(s.rmsL)} ${fmt(s.rmsR)}  ${db(rms).toFixed(1)}`);
  }
  const rms = 0.5 * (master.rmsL + master.rmsR);
  console.log(`${'MASTER 0.00–12.80s'.padEnd(28)} ${fmt(master.peakL)} ${fmt(master.peakR)} ${fmt(master.rmsL)} ${fmt(master.rmsR)}  ${db(rms).toFixed(1)}`);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'sound');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'rocket-flight.wav');

console.log('Synthesizing NFS-style rocket turbo (12.80 s)…');
const { l, r, peak, duration } = generateRocketFlight();
const wav = writeWav16Stereo(l, r);
writeFileSync(outPath, wav);
printReport(l, r, peak, duration, outPath, wav.length);

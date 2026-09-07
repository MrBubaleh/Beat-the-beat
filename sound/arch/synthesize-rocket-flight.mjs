#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const RATE = 44100;
const OVERSAMPLE = 2;
const HZ = RATE * OVERSAMPLE;
const TAU = 2 * Math.PI;
const DURATION = 12.8;
const FRAMES = Math.round(DURATION * RATE);
const LIMIT = 0.95;
const EVENTS = { choke: 2.42, snap: 2.45, launch: 2.5, plateau: 5.5, cruise: 6.35, warning: 9.5, cutoff: 10.27, landing: 11.27, end: DURATION };
const FALL_TIME = EVENTS.landing - EVENTS.cutoff;
const FALL_GRAVITY = 2 * 8.8 / (FALL_TIME * FALL_TIME);
const PHASES = [
  ['Anticipation', 0, 2.5], ['Launch', 2.5, 5.5], ['Plateau', 5.5, 6.35],
  ['Cruise', 6.35, 10.27], ['Fall', 10.27, 11.27], ['Touchdown & fade', 11.27, 12.8],
];
const unit = x => Math.max(0, Math.min(1, x));
const blend = (a, b, x) => a + (b - a) * x;
const smooth = x => { const u = unit(x); return u * u * (3 - 2 * u); };
const ramp = (t, start, span) => smooth((t - start) / span);
const decay = (age, attack, time) => age < 0 ? 0 : smooth(age / attack) * Math.exp(-age / time);
const shaped = (x, drive) => Math.tanh(x * drive) / Math.tanh(drive);
const db = x => 20 * Math.log10(Math.max(1e-12, x));

class Random {
  constructor(seed) { this.state = seed >>> 0; }
  next() {
    let s = this.state;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this.state = s >>> 0;
    return this.state / 2147483648 - 1;
  }
}

class Noise {
  constructor(seed) {
    this.random = new Random(seed);
    this.rows = new Float32Array(12);
    this.sum = 0; this.counter = 0; this.white = 0;
    for (let k = 0; k < this.rows.length; k++) {
      this.rows[k] = this.random.next(); this.sum += this.rows[k];
    }
  }
  next() {
    this.counter = (this.counter + 1) & 4095;
    if (this.counter !== 0) {
      let k = 0, bits = this.counter;
      while ((bits & 1) === 0) { k++; bits >>>= 1; }
      this.sum -= this.rows[k]; this.rows[k] = this.random.next(); this.sum += this.rows[k];
    }
    this.white = this.random.next();
    return (this.sum + this.white) / 7;
  }
}

class Filter {
  constructor(type, frequency, q = Math.SQRT1_2) {
    this.z1 = 0; this.z2 = 0; this.type = type;
    this.tune(frequency, q);
  }
  tune(frequency, q = Math.SQRT1_2) {
    const w = TAU * Math.max(10, Math.min(HZ * 0.43, frequency)) / HZ;
    const c = Math.cos(w), alpha = Math.sin(w) / (2 * q), norm = 1 / (1 + alpha);
    const numerator = this.type === 'lowpass' ? [(1 - c) / 2, 1 - c, (1 - c) / 2]
      : this.type === 'highpass' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2]
        : [alpha, 0, -alpha];
    [this.b0, this.b1, this.b2] = numerator.map(v => v * norm);
    this.a1 = -2 * c * norm; this.a2 = (1 - alpha) * norm;
  }
  tick(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

class Rotor {
  constructor(offset = 0) { this.angle = offset; }
  tick(frequency, richness = 0) {
    this.angle = (this.angle + TAU * frequency / HZ) % TAU;
    return Math.sin(this.angle) + richness * (0.46 * Math.sin(2 * this.angle + 0.3)
      + 0.25 * Math.sin(3 * this.angle + 0.9) + 0.12 * Math.sin(5 * this.angle));
  }
}

class Diffusion {
  constructor(seconds, feedback) {
    this.buffer = new Float32Array(Math.round(seconds * HZ));
    this.position = 0; this.feedback = feedback; this.damped = 0;
  }
  tick(x) {
    const delayed = this.buffer[this.position];
    this.damped += 0.16 * (delayed - this.damped);
    this.buffer[this.position] = x + this.damped * this.feedback;
    this.position = (this.position + 1) % this.buffer.length;
    return delayed;
  }
}

function channel(seed, detune) {
  return {
    noise: new Noise(seed), detune,
    inhale: new Filter('bandpass', 200, 0.8),
    combustion: new Filter('bandpass', 260, 0.7),
    jet: new Filter('bandpass', 750, 0.75),
    air: new Filter('bandpass', 1700, 0.65),
    edge: new Filter('bandpass', 3250, 2.2),
    hiss: new Filter('highpass', 2900),
    darken: new Filter('lowpass', 6700, 0.6),
    bearing: new Filter('bandpass', 650, 1.6),
    dive: new Filter('bandpass', 650, 1.05),
    rotor: new Rotor(detune * 9),
    roomA: new Diffusion(detune > 1 ? 0.0431 : 0.0379, 0.41),
    roomB: new Diffusion(detune > 1 ? 0.0713 : 0.0617, 0.3),
  };
}

function render() {
  const length = FRAMES * OVERSAMPLE;
  const raw = [new Float32Array(length), new Float32Array(length)];
  const channels = [channel(0x18a5c391, 0.987), channel(0x73be590f, 1.013)];
  const coreNoise = new Noise(0x592dfa17);
  const bassFilter = new Filter('lowpass', 145, 0.8);
  const bassDC = new Filter('highpass', 24);
  const pulse = new Rotor(), sub = new Rotor(), core = new Rotor();
  const launchSub = new Rotor(), landingSub = new Rotor(), valve = new Rotor();
  const flutter = new Rotor(), spoolA = new Rotor(), spoolB = new Rotor(0.71);
  const sideHP = new Filter('highpass', 190);
  const masterDC = [new Filter('highpass', 18, 0.65), new Filter('highpass', 18, 0.65)];
  for (let i = 0; i < length; i++) {
    const t = i / HZ;
    const prepare = unit(t / EVENTS.launch);
    const climbing = unit((t - EVENTS.launch) / 3);
    const plateau = ramp(t, EVENTS.plateau, 0.045) * (1 - ramp(t, EVENTS.cruise - 0.07, 0.07));
    const starving = ramp(t, EVENTS.warning, EVENTS.cutoff - EVENTS.warning);
    const ignition = t - EVENTS.launch, fall = t - EVENTS.cutoff, landing = t - EVENTS.landing;
    const thrust = ramp(t, EVENTS.launch, 0.075) * (1 - ramp(t, EVENTS.cutoff, 0.002));
    const anticipation = t < EVENTS.launch
      ? ramp(t, 0, 0.07) * (0.12 + 0.88 * prepare ** 1.18) * (1 - 0.987 * ramp(t, EVENTS.choke, 0.004)) : 0;
    const boom = decay(ignition, 0.00045, 0.095);
    const boomBody = decay(ignition, 0.007, 0.32);
    const impact = decay(landing, 0.0015, 0.14);
    const dust = decay(landing, 0.004, 0.105);
    const snap = decay(t - EVENTS.snap, 0.00035, 0.006);
    const cutoff = decay(fall, 0.0004, 0.018);
    const wake = fall >= 0 ? Math.exp(-fall / 0.085) : 0;
    const speed = FALL_GRAVITY * Math.max(0, fall);
    const velocity = unit(speed / (FALL_GRAVITY * FALL_TIME));
    const fallAir = fall >= 0 && landing < 0 ? ramp(t, EVENTS.cutoff, 0.018) * (0.12 + 0.48 * velocity ** 2) : 0;
    const tail = landing >= 0 ? Math.exp(-landing / 0.28) * ramp(t, EVENTS.landing, 0.006) : 0;
    const rotorSpeed = t < EVENTS.launch ? 155 * 4.5 ** prepare
      : landing >= 0 ? 190 + 1100 * Math.exp(-landing / 0.19)
        : fall >= 0 ? 240 + 1120 * Math.exp(-fall / 0.07)
          : (300 + 1060 * climbing ** 0.84) * (1 - 0.21 * starving);
    const vibration = 1 + 0.013 * Math.sin(TAU * 6.8 * t) + 0.007 * Math.sin(TAU * 17.3 * t + Math.sin(t * 8));
    const slowSurge = 0.89 + 0.11 * Math.sin(TAU * 0.9 * t + 0.35 * Math.sin(t * 2.1));
    const flutterValue = flutter.tick(4.55 + 0.22 * Math.sin(t * 1.7));
    const instability = 1 - starving * (0.15 + 0.12 * (0.5 + 0.5 * Math.sin(TAU * 12.1 * t)) ** 4);
    const pulseValue = 0.24 + 0.76 * ((pulse.tick(3 * 10 ** prepare) + 1) / 2) ** 2;
    const pink = coreNoise.next();
    const lowRumble = bassDC.tick(bassFilter.tick(pink * 3.1));
    const subTone = sub.tick(32 + 56 * prepare, 0.45);
    const engineFundamental = core.tick((49 + 24 * climbing) * (1 - 0.14 * starving), 0.65);
    const flame = thrust * (0.77 + 0.23 * climbing) * instability * (0.93 + 0.07 * flutterValue);
    const detonationFrequency = 180 * (30 / 180) ** unit(ignition / 0.18);
    const detonation = launchSub.tick(detonationFrequency, 0.22) * boom;
    const thumpFrequency = 65 * (25 / 65) ** unit(landing / 0.18);
    const thump = landingSub.tick(thumpFrequency, 0.28) * impact;
    const low = shaped(anticipation * (0.27 * subTone * pulseValue + 0.1 * lowRumble)
      + flame * (0.035 * engineFundamental + 0.105 * lowRumble)
      + 1.08 * detonation + 0.35 * lowRumble * boomBody + 0.87 * thump, 1.65);
    const mechanical = shaped(0.64 * spoolA.tick(rotorSpeed * vibration, 0.8)
      + 0.36 * spoolB.tick(rotorSpeed * 1.017 * (1 + 0.006 * Math.sin(t * 31)), 0.6), 1.4);
    const valveRing = valve.tick(2280 + 640 * Math.exp(-Math.max(0, t - EVENTS.snap) * 180), 0.3);
    const airValues = [0, 0];
    const transientValues = [0, 0];
    for (let c = 0; c < 2; c++) {
      const v = channels[c], p = v.noise.next(), w = v.noise.white;
      if ((i & 15) === 0) {
        v.inhale.tune((150 * 17 ** prepare) * v.detune, 0.8 + 0.65 * prepare);
        v.combustion.tune((190 + 140 * climbing + 18 * Math.sin(t * 5)) * v.detune, 0.62);
        v.jet.tune((460 + 780 * climbing) * (1 - 0.16 * starving) * v.detune, 0.82);
        v.air.tune((1250 + 930 * climbing + 190 * Math.sin(t * 2.9 + c)) * v.detune, 0.68);
        v.edge.tune(3250 + 130 * Math.sin(t * 21 + c), 2.1);
        v.bearing.tune(rotorSpeed * v.detune, 1.65);
        v.dive.tune((600 + 2050 * velocity) * v.detune, 1.1);
      }
      const inhale = v.inhale.tick(0.45 * w + p);
      const combustion = v.combustion.tick(p * 2.8);
      const jet = v.jet.tick(p * 2.5 + w * 0.16);
      const air = v.air.tick(p * 1.45 + w * 0.23);
      const edge = v.edge.tick(w * 0.6 + p * 0.7);
      const hiss = v.darken.tick(v.hiss.tick(w));
      const bearing = v.bearing.tick(p * 2.2);
      const dive = v.dive.tick(0.33 * w + 1.7 * p);
      const roughness = 0.84 + 0.16 * Math.sin(TAU * 37 * t + 5 * p + c * 0.8);
      const gust = slowSurge * (0.94 + 0.06 * Math.sin(TAU * 1.37 * t + c * 1.2));
      const rotor = v.rotor.tick(rotorSpeed * v.detune * vibration, 0.5);
      const tone = (mechanical * 0.72 + rotor * 0.28) * (0.62 + 0.38 * unit(Math.abs(air) * 4));
      const spool = anticipation * (0.51 * inhale + 0.038 * tone + 0.16 * bearing);
      const jetBus = flame * 0.245 * shaped(combustion * 0.52 + jet * 1.2 * roughness + bearing * 0.15 + tone * 0.03, 1.75);
      const wind = thrust * climbing ** 0.8 * gust * (0.26 * air + 0.018 * hiss);
      const shear = plateau * (0.20 * edge + 0.012 * hiss);
      const diveTone = Math.sin(TAU * (600 * Math.max(0, fall) + 1025 * Math.max(0, fall) ** 2) + 0.3 * Math.sin(t * 46));
      const falling = fallAir * (dive * 1.15 + 0.016 * diveTone) + wake * (0.22 * air + 0.08 * jet);
      const cooling = tail * (0.28 * air + 0.15 * bearing + 0.009 * tone);
      const pressure = shaped(jet * 2.2 + air * 1.6 + w * 0.18, 2.8) * decay(ignition, 0.0002, 0.038) * 0.7;
      const debris = (0.42 * jet + 0.13 * air) * boomBody;
      const clicks = snap * (0.21 * valveRing + 0.48 * shaped(hiss, 3))
        + cutoff * (0.27 * shaped(air + 0.1 * w, 2.2));
      const ground = dust * (0.55 * combustion + 0.45 * air);
      const dry = spool + jetBus + wind + shear + falling + cooling;
      const room = 0.11 * v.roomA.tick(dry + pressure * 0.45 + ground * 0.2)
        + 0.075 * v.roomB.tick(dry + pressure * 0.3);
      const roomGate = t < EVENTS.launch ? 1 - 0.99 * ramp(t, EVENTS.choke, 0.004)
        : fall >= 0 && landing < 0 ? 0.3 + 0.7 * Math.exp(-fall / 0.04) : 1;
      airValues[c] = shaped(dry + room * roomGate, 1.3);
      transientValues[c] = pressure + debris + clicks + ground;
    }
    const mid = (airValues[0] + airValues[1]) * 0.5;
    const width = 0.54 + 0.28 * ramp(t, EVENTS.launch, 2.2) + 0.42 * plateau;
    const side = sideHP.tick((airValues[0] - airValues[1]) * 0.5) * width;
    for (let c = 0; c < 2; c++) {
      const bus = low + mid + (c === 0 ? side : -side) + transientValues[c];
      const mastered = Math.tanh(masterDC[c].tick(bus) * 1.24);
      const fade = 1 - ramp(t, DURATION - 0.11, 0.11);
      raw[c][i] = mastered * fade;
      if (!Number.isFinite(raw[c][i])) throw new Error(`Non-finite synthesis at frame ${i}, channel ${c}`);
    }
  }
  return raw.map(downsample);
}

function downsample(input) {
  const radius = 48, cutoff = 18500 / HZ;
  const kernel = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const sinc = k === 0 ? 2 * cutoff : Math.sin(TAU * cutoff * k) / (Math.PI * k);
    const window = 0.42 + 0.5 * Math.cos(Math.PI * k / radius) + 0.08 * Math.cos(TAU * k / radius);
    kernel[k + radius] = sinc * window; sum += sinc * window;
  }
  const output = new Float32Array(FRAMES);
  for (let i = 0; i < output.length; i++) {
    let value = 0;
    for (let k = -radius; k <= radius; k++) {
      const source = i * OVERSAMPLE + k;
      if (source >= 0 && source < input.length) value += input[source] * kernel[k + radius];
    }
    output[i] = value / sum;
  }
  return output;
}

function encode(channels) {
  let peak = 0;
  for (const data of channels) for (const x of data) peak = Math.max(peak, Math.abs(x));
  const gain = 0.94 / peak;
  const buffer = Buffer.alloc(44 + FRAMES * 4);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(RATE, 24); buffer.writeUInt32LE(RATE * 4, 28); buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(FRAMES * 4, 40);
  const dither = new Random(0x355eba19);
  for (let i = 0; i < FRAMES; i++) for (let c = 0; c < 2; c++) {
    const exactSilence = i === 0 || i >= FRAMES - 64;
    const pcm = exactSilence ? 0 : Math.round(channels[c][i] * gain * 32768 + (dither.next() - dither.next()) * 0.5);
    if (Math.abs(pcm / 32768) > LIMIT) throw new Error('PCM peak exceeds ceiling');
    buffer.writeInt16LE(pcm, 44 + i * 4 + c * 2);
  }
  return { buffer, gain };
}

function inspect(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE'
      || buffer.readUInt32LE(4) !== buffer.length - 8 || buffer.readUInt16LE(20) !== 1
      || buffer.readUInt16LE(22) !== 2 || buffer.readUInt32LE(24) !== RATE
      || buffer.readUInt32LE(28) !== RATE * 4 || buffer.readUInt16LE(32) !== 4
      || buffer.readUInt16LE(34) !== 16 || buffer.readUInt32LE(40) !== FRAMES * 4
      || buffer.length !== FRAMES * 4 + 44) throw new Error('Invalid WAV format or duration');
  const measure = (start, end) => {
    const first = Math.round(start * RATE), last = Math.round(end * RATE);
    const peaks = [0, 0], squares = [0, 0], means = [0, 0];
    let cross = 0;
    for (let i = first; i < last; i++) {
      const pair = [buffer.readInt16LE(44 + i * 4) / 32768, buffer.readInt16LE(46 + i * 4) / 32768];
      for (let c = 0; c < 2; c++) {
        peaks[c] = Math.max(peaks[c], Math.abs(pair[c])); squares[c] += pair[c] ** 2; means[c] += pair[c];
      }
      cross += pair[0] * pair[1];
    }
    const rms = squares.map(s => Math.sqrt(s / (last - first)));
    return { peakL: peaks[0], peakR: peaks[1], rmsL: rms[0], rmsR: rms[1],
      rmsDbFS: db(Math.sqrt((squares[0] + squares[1]) / (2 * (last - first)))),
      dcL: means[0] / (last - first), dcR: means[1] / (last - first),
      correlation: cross / Math.sqrt(squares[0] * squares[1]) };
  };
  const master = measure(0, DURATION);
  if (Math.max(master.peakL, master.peakR) > LIMIT) throw new Error('Saved PCM exceeds ceiling');
  if (!buffer.subarray(buffer.length - 256).every(x => x === 0)) throw new Error('Tail is not silent');
  return {
    format: 'stereo 16-bit PCM WAV', sampleRate: RATE, duration: FRAMES / RATE, frames: FRAMES,
    peakType: 'sample peak measured from saved PCM; not a true-peak measurement',
    events: Object.fromEntries(Object.entries(EVENTS).map(([name, seconds]) => [name, { seconds, frame: Math.round(seconds * RATE) }])),
    master, phases: PHASES.map(([name, start, end]) => ({ name, start, end, ...measure(start, end) })),
    chokeBefore: measure(2.36, 2.42), chokeAfter: measure(2.43, 2.449),
  };
}

console.log('Synthesizing new procedural Rocket Flight at 88.2 kHz, exporting 44.1 kHz PCM...');
const { buffer, gain } = encode(render());
const wavPath = new URL('./rocket-flight-cinematic.wav', import.meta.url);
writeFileSync(wavPath, buffer);
const report = inspect(readFileSync(wavPath));
report.normalizationGain = gain;
writeFileSync(new URL('./rocket-flight-cinematic.stats.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(`Duration ${report.duration.toFixed(2)} s | ${RATE} Hz | stereo | PCM 16-bit | ${buffer.length} bytes`);
console.log(`Sample peak: ${Math.max(report.master.peakL, report.master.peakR).toFixed(6)}; ceiling ${LIMIT}`);
console.table(report.phases.map(p => ({ phase: p.name, seconds: `${p.start.toFixed(2)}-${p.end.toFixed(2)}`,
  peakL: p.peakL.toFixed(5), peakR: p.peakR.toFixed(5), rmsL: p.rmsL.toFixed(5), rmsR: p.rmsR.toFixed(5), rmsDbFS: p.rmsDbFS.toFixed(2) })));
console.log(`Verified saved PCM header, duration, ceiling and silent tail. Output: ${wavPath.pathname}`);

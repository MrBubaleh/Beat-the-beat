import fs from 'fs';
import path from 'path';

function loadPcm16Stereo(filePath) {
  const buf = fs.readFileSync(filePath);
  const sampleRate = buf.readUInt32LE(24);
  const channels = buf.readUInt16LE(22);
  const bitsPerSample = buf.readUInt16LE(34);
  const dataLen = buf.readUInt32LE(40);
  const numSamples = dataLen / (channels * (bitsPerSample / 8));

  const left = new Float32Array(numSamples);
  const right = new Float32Array(numSamples);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    left[i] = buf.readInt16LE(offset) / 32768;
    offset += 2;
    if (channels === 2) {
      right[i] = buf.readInt16LE(offset) / 32768;
      offset += 2;
    } else {
      right[i] = left[i];
    }
  }

  return { sampleRate, numSamples, left, right };
}

function writeWav16Stereo(sampleRate, left, right, peakCeiling = 0.945) {
  const numSamples = left.length;
  const bytesPerSample = 2;
  const numChannels = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);

  // data
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Peak search
  let maxPeak = 0;
  for (let i = 0; i < numSamples; i++) {
    const aL = Math.abs(left[i]);
    const aR = Math.abs(right[i]);
    if (aL > maxPeak) maxPeak = aL;
    if (aR > maxPeak) maxPeak = aR;
  }

  const gain = maxPeak > 0 ? Math.min(1.15, peakCeiling / maxPeak) : 1.0;

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const exactSilence = i >= numSamples - 64;
    const sL = exactSilence ? 0 : Math.max(-1, Math.min(1, left[i] * gain));
    const sR = exactSilence ? 0 : Math.max(-1, Math.min(1, right[i] * gain));

    const intL = sL < 0 ? Math.round(sL * 32768) : Math.round(sL * 32767);
    const intR = sR < 0 ? Math.round(sR * 32768) : Math.round(sR * 32767);

    buffer.writeInt16LE(intL, offset);
    offset += 2;
    buffer.writeInt16LE(intR, offset);
    offset += 2;
  }

  return { buffer, peak: maxPeak * gain, gainApplied: gain };
}

class Biquad {
  constructor() {
    this.x1 = 0; this.x2 = 0;
    this.y1 = 0; this.y2 = 0;
    this.b0 = 1; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
  }

  setHighpass(freq, Q, sampleRate) {
    const safeFreq = Math.max(20, Math.min(freq, sampleRate * 0.48));
    const safeQ = Math.max(0.1, Q);
    const w0 = (2 * Math.PI * safeFreq) / sampleRate;
    const alpha = Math.sin(w0) / (2 * safeQ);
    const cosw0 = Math.cos(w0);
    const b0 = (1 + cosw0) / 2;
    const b1 = -(1 + cosw0);
    const b2 = (1 + cosw0) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cosw0;
    const a2 = 1 - alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  setBandpass(freq, Q, sampleRate) {
    const safeFreq = Math.max(20, Math.min(freq, sampleRate * 0.48));
    const safeQ = Math.max(0.1, Q);
    const w0 = (2 * Math.PI * safeFreq) / sampleRate;
    const alpha = Math.sin(w0) / (2 * safeQ);
    const b0 = alpha;
    const b1 = 0;
    const b2 = -alpha;
    const a0 = 1 + alpha;
    const a1 = -2 * Math.cos(w0);
    const a2 = 1 - alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  setLowpass(freq, Q, sampleRate) {
    const safeFreq = Math.max(20, Math.min(freq, sampleRate * 0.48));
    const safeQ = Math.max(0.1, Q);
    const w0 = (2 * Math.PI * safeFreq) / sampleRate;
    const alpha = Math.sin(w0) / (2 * safeQ);
    const cosw0 = Math.cos(w0);
    const b0 = (1 - cosw0) / 2;
    const b1 = 1 - cosw0;
    const b2 = (1 - cosw0) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cosw0;
    const a2 = 1 - alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = Number.isFinite(y) ? y : 0;
    return this.y1;
  }
}

class LinkwitzRileyHighpass {
  constructor(freq, sampleRate) {
    this.stage1 = new Biquad();
    this.stage2 = new Biquad();
    this.stage1.setHighpass(freq, Math.SQRT1_2, sampleRate);
    this.stage2.setHighpass(freq, Math.SQRT1_2, sampleRate);
  }

  process(x) {
    return this.stage2.process(this.stage1.process(x));
  }
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// 7 distinct, diverse, non-repetitive events (warm, low-mid vortex whooshes)
const FLYBY_EVENTS = [
  // 1. Launch climb: solitary massive arch overhead-left (wide, deep, low whoosh)
  { t0: 3.75, side: 'left',  fStart: 1050, fEnd: 260, span: 0.24, weight: 2.10 },

  // 2. Launch climb: high-speed structure whipping past on right
  { t0: 4.70, side: 'right', fStart: 1200, fEnd: 290, span: 0.18, weight: 2.15 },

  // 3. Plateau apex: supersonic flyby right at peak altitude on left
  { t0: 5.85, side: 'left',  fStart: 1250, fEnd: 320, span: 0.17, weight: 2.25 },

  // 4 & 5. Rapid staggered double-pass: Right then Left ("whoosh-whoosh" combo)
  { t0: 6.95, side: 'right', fStart: 1150, fEnd: 280, span: 0.15, weight: 2.20 },
  { t0: 7.35, side: 'left',  fStart: 1200, fEnd: 300, span: 0.16, weight: 2.30 },

  // 6. Cruise mid: heavy structural pass on right
  { t0: 8.45, side: 'right', fStart: 1100, fEnd: 240, span: 0.22, weight: 2.25 },

  // 7. Cruise finale: razor-close pass on left right before fuel warning
  { t0: 9.40, side: 'left',  fStart: 1300, fEnd: 340, span: 0.16, weight: 2.35 }
];

export function synthesizeTurboUltimate() {
  const pcmRf = loadPcm16Stereo(fs.existsSync('sound/rocket-flight.wav') ? 'sound/rocket-flight.wav' : 'sound/arch/rocket-flight.wav');
  const pcmRfc = loadPcm16Stereo(fs.existsSync('sound/rocket-flight-cinematic.wav') ? 'sound/rocket-flight-cinematic.wav' : 'sound/arch/rocket-flight-cinematic.wav');
  const pcmTs = loadPcm16Stereo(fs.existsSync('sound/turbo-synth.wav') ? 'sound/turbo-synth.wav' : 'sound/arch/turbo-synth.wav');

  const sr = pcmRf.sampleRate; // 44100
  const n = pcmRf.numSamples;  // 564480 = 12.80s

  const outL = new Float32Array(n);
  const outR = new Float32Array(n);

  // Highpass filter for aerodynamic wind layer
  const windHpfL = new LinkwitzRileyHighpass(780, sr);
  const windHpfR = new LinkwitzRileyHighpass(780, sr);
  const windAirPeakL = new Biquad();
  const windAirPeakR = new Biquad();
  windAirPeakL.setBandpass(3200, 1.2, sr);
  windAirPeakR.setBandpass(3200, 1.2, sr);

  // Dedicated filters for the flyby engine (warm, low-mid, no harsh highs)
  const flybyBp1 = new Biquad();
  const flybyBp2 = new Biquad();
  const flybyBody = new Biquad();
  const flybyThump = new Biquad();
  const flybyCeiling = new Biquad();
  flybyCeiling.setLowpass(1900, 0.707, sr); // Strictly cut off piercing frequencies

  // Warm de-harsh filters for cruise engine and wind in second half
  const bedWarmL = new Biquad();
  const bedWarmR = new Biquad();
  bedWarmL.setLowpass(2400, 0.707, sr);
  bedWarmR.setLowpass(2400, 0.707, sr);

  let phaseFlutter = 0;

  const T_LAUNCH = 2.50;
  const T_PLATEAU = 5.50;
  const T_CRUISE = 6.35;
  const T_FALL = 10.27;
  const T_LAND = 11.27;
  const T_END = 12.80;

  for (let i = 0; i < n; i++) {
    const t = i / sr;

    // 1. Aerodynamic wind extraction from rocket-flight-cinematic.wav
    const rawWindL = windHpfL.process(pcmRfc.left[i]);
    const rawWindR = windHpfR.process(pcmRfc.right[i]);
    const airShearL = windAirPeakL.process(pcmRfc.left[i]);
    const airShearR = windAirPeakR.process(pcmRfc.right[i]);
    const windL = rawWindL * 0.78 + airShearL * 0.28;
    const windR = rawWindR * 0.78 + airShearR * 0.28;

    let sampleL = 0;
    let sampleR = 0;

    // =========================================================================
    // 1. ANTICIPATION (0.00s -> 2.50s)
    // =========================================================================
    if (t < T_LAUNCH - 0.004) {
      sampleL = pcmRf.left[i];
      sampleR = pcmRf.right[i];
    }
    // Clean crossfade in silence right before detonation
    else if (t >= T_LAUNCH - 0.004 && t < T_LAUNCH) {
      const p = (t - (T_LAUNCH - 0.004)) / 0.004;
      const cosP = Math.cos(p * Math.PI * 0.5);
      const sinP = Math.sin(p * Math.PI * 0.5);
      sampleL = pcmRf.left[i] * cosP + pcmTs.left[i] * sinP;
      sampleR = pcmRf.right[i] * cosP + pcmTs.right[i] * sinP;
    }
    // =========================================================================
    // 2. LAUNCH, PLATEAU, CRUISE (2.50s -> 10.27s)
    // =========================================================================
    else if (t >= T_LAUNCH && t < T_FALL) {
      let windAmp = 0.32;
      if (t < 3.30) {
        windAmp = smoothstep(2.65, 3.30, t) * 0.28;
      } else if (t >= T_PLATEAU && t < T_CRUISE) {
        windAmp = 0.38;
      } else {
        windAmp = 0.34;
      }

      // Base engine & wind bed
      let rawBedL = pcmTs.left[i] * 0.72 + windL * (windAmp * 0.85);
      let rawBedR = pcmTs.right[i] * 0.72 + windR * (windAmp * 0.85);

      // De-harsh bed in cruise: smooth warm lowpass to remove grating metallic bite
      const warmBedL = bedWarmL.process(rawBedL);
      const warmBedR = bedWarmR.process(rawBedR);
      const warmMix = smoothstep(5.50, 6.80, t);
      let bedL = rawBedL * (1.0 - 0.70 * warmMix) + warmBedL * (0.70 * warmMix);
      let bedR = rawBedR * (1.0 - 0.70 * warmMix) + warmBedR * (0.70 * warmMix);

      // -----------------------------------------------------------------------
      // HIGH-SPEED OBJECT FLYBYS (PUNCHY, AUDIBLY VISCERAL, WARM)
      // -----------------------------------------------------------------------
      let flybyL = 0;
      let flybyR = 0;
      let duckOppositeL = 1.0;
      let duckOppositeR = 1.0;
      let duckSameL = 1.0;
      let duckSameR = 1.0;

      for (let k = 0; k < FLYBY_EVENTS.length; k++) {
        const ev = FLYBY_EVENTS[k];
        const dt = t - ev.t0;

        // Active pass window
        if (dt >= -ev.span && dt <= ev.span) {
          const p = dt / ev.span; // -1 to +1

          // Proximity bell envelope
          const env = Math.exp(-Math.pow(p * 2.2, 2));

          // Smooth exponential Doppler sweep (glide down)
          const dopplerProgress = 0.5 + 0.5 * Math.tanh(p * 2.8);
          const fCur = ev.fStart * Math.pow(ev.fEnd / ev.fStart, dopplerProgress);

          // 1. Dual resonant bandpass whoosh (hollow aerodynamic vortex)
          flybyBp1.setBandpass(fCur, 2.0, sr);
          flybyBp2.setBandpass(fCur * 1.3, 1.8, sr);

          const noise = Math.random() * 2 - 1;
          const whoosh1 = flybyBp1.process(noise);
          const whoosh2 = flybyBp2.process(noise * 1.2);
          const rawWhoosh = (whoosh1 * 0.75 + whoosh2 * 0.45) * env;

          // 2. Air tearing flutter (smooth 24 Hz modulation with soft sine)
          phaseFlutter += (2 * Math.PI * 24) / sr;
          const isClose = Math.exp(-Math.pow(p * 4.5, 2));
          const flutter = 1.0 + 0.18 * Math.sin(phaseFlutter) * isClose;

          // 3. Low-frequency displacement pressure thump (75 Hz)
          flybyThump.setBandpass(75, 1.2, sr);
          const thump = flybyThump.process(noise * 1.5) * isClose * 0.75;

          // 4. Low-mid air rush (280 Hz)
          flybyBody.setBandpass(280, 1.2, sr);
          const body = flybyBody.process(noise) * env * 0.5;

          // Filter through warm lowpass (strictly cut off harsh highs)
          const sound = flybyCeiling.process((rawWhoosh * flutter + thump + body) * ev.weight);

          // Duck the OPPOSITE channel strongly and same channel slightly so the pass cuts through
          const duckAmount = 0.58 * isClose;

          if (ev.side === 'left') {
            flybyL += sound * 1.0;
            flybyR += sound * 0.04; // tiny stereo spill
            duckOppositeR = Math.min(duckOppositeR, 1.0 - duckAmount);
            duckSameL = Math.min(duckSameL, 1.0 - 0.20 * isClose);
          } else {
            flybyR += sound * 1.0;
            flybyL += sound * 0.04; // tiny stereo spill
            duckOppositeL = Math.min(duckOppositeL, 1.0 - duckAmount);
            duckSameR = Math.min(duckSameR, 1.0 - 0.20 * isClose);
          }
        }
      }

      // Mix flybys with ducked bed
      const midL = bedL * duckOppositeL * duckSameL + flybyL;
      const midR = bedR * duckOppositeR * duckSameR + flybyR;

      sampleL = Math.tanh(midL * 0.98) * 0.945;
      sampleR = Math.tanh(midR * 0.98) * 0.945;
    }
    // =========================================================================
    // 3. FALL / DIVE (10.27s -> 11.27s)
    // =========================================================================
    else if (t >= T_FALL && t < T_LAND) {
      const p = (t - T_FALL) / (T_LAND - T_FALL);
      const cosW = Math.cos(p * Math.PI * 0.5);
      const sinW = Math.sin(p * Math.PI * 0.5);

      const mixL = pcmTs.left[i] * (cosW ** 1.3) + pcmRf.left[i] * (sinW ** 1.1);
      const mixR = pcmTs.right[i] * (cosW ** 1.3) + pcmRf.right[i] * (sinW ** 1.1);

      sampleL = Math.tanh(mixL * 1.02) * 0.94;
      sampleR = Math.tanh(mixR * 1.02) * 0.94;
    }
    // =========================================================================
    // 4. TOUCHDOWN & DECAY (11.27s -> 12.80s)
    // =========================================================================
    else {
      sampleL = pcmRf.left[i];
      sampleR = pcmRf.right[i];
    }

    outL[i] = sampleL;
    outR[i] = sampleR;
  }

  // Master fade at the very end
  for (let i = Math.floor((T_END - 0.08) * sr); i < n; i++) {
    const t = i / sr;
    const fade = Math.max(0, (T_END - t) / 0.08);
    outL[i] *= fade;
    outR[i] *= fade;
  }

  return writeWav16Stereo(sr, outL, outR, 0.945);
}

// Generate sound/turbo-ultimate.wav
const targetPath = path.resolve('sound/turbo-ultimate.wav');
console.log(`Generating Turbo Ultimate SFX (Audible, Punchy Flybys) -> ${targetPath}`);
const { buffer, peak, gainApplied } = synthesizeTurboUltimate();
fs.writeFileSync(targetPath, buffer);
console.log(`Saved ${buffer.length} bytes (${(buffer.length / 1024).toFixed(1)} KB).`);
console.log(`True Peak: ${peak.toFixed(4)}, Normalization Gain: ${gainApplied.toFixed(4)}`);

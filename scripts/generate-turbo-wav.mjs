import fs from 'fs';
import path from 'path';

function createWavBuffer(sampleRate, numChannels, samplesL, samplesR) {
  const numSamples = samplesL.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);

  // data sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const sL = Math.max(-1, Math.min(1, samplesL[i]));
    const intL = sL < 0 ? Math.round(sL * 32768) : Math.round(sL * 32767);
    buffer.writeInt16LE(intL, offset);
    offset += 2;

    if (numChannels === 2) {
      const sR = Math.max(-1, Math.min(1, samplesR[i]));
      const intR = sR < 0 ? Math.round(sR * 32768) : Math.round(sR * 32767);
      buffer.writeInt16LE(intR, offset);
      offset += 2;
    }
  }

  return buffer;
}

class Biquad {
  constructor() {
    this.x1 = 0; this.x2 = 0;
    this.y1 = 0; this.y2 = 0;
    this.b0 = 1; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
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
    this.y1 = isNaN(y) ? 0 : y;
    return this.y1;
  }
}

function saturate(x, drive = 1.0) {
  return Math.tanh(x * drive);
}

/**
 * Procedural Rocket Flight SFX aligned with exact in-game timings:
 * - Anticipation: 0.00s -> 2.50s (2.5s) - Energy buildup, vacuum spool, snap at end
 * - Launch: 2.50s -> 5.50s (3.0s) - Detonation blast, rocket climb & acceleration
 * - Plateau: 5.50s -> 6.35s (0.85s) - FOV-kick, peak height supersonic apex
 * - Cruise: 6.35s -> 10.27s (3.92s) - Sustained high-speed jet roar, wind gusts, fuel burn
 * - Fall: 10.27s -> 11.27s (~1.0s) - Engine cutoff, dive whistle
 * - Touchdown & Fade: 11.27s -> 12.80s - Ground impact thump, spool-down decay
 */
export function generateTurboWav({
  anticipationSec = 2.50,
  launchSec = 3.00,
  plateauSec = 0.85,
  cruiseSec = 3.92,
  fallSec = 1.00,
  fadeAfterLandSec = 1.53,
  sampleRate = 44100
} = {}) {
  const tLaunch = anticipationSec;                             // 2.50s
  const tPlateau = tLaunch + launchSec;                        // 5.50s
  const tCruise = tPlateau + plateauSec;                       // 6.35s
  const tFall = tCruise + cruiseSec;                           // 10.27s
  const tLand = tFall + fallSec;                               // 11.27s
  const totalDuration = tLand + fadeAfterLandSec;              // 12.80s

  const totalSamples = Math.floor(totalDuration * sampleRate);
  const outL = new Float32Array(totalSamples);
  const outR = new Float32Array(totalSamples);

  // Filters
  const chargeRumbleL = new Biquad();
  const chargeRumbleR = new Biquad();
  const suctionL = new Biquad();
  const suctionR = new Biquad();
  const snapL = new Biquad();
  const snapR = new Biquad();

  const blastSubL = new Biquad();
  const blastCrackL = new Biquad();
  const blastCrackR = new Biquad();

  const jetThrustL = new Biquad();
  const jetThrustR = new Biquad();
  const jetWhineL = new Biquad();
  const jetWhineR = new Biquad();

  const windLowL = new Biquad();
  const windLowR = new Biquad();
  const windHighL = new Biquad();
  const windHighR = new Biquad();

  const diveWhistleL = new Biquad();
  const diveWhistleR = new Biquad();
  const landThumpL = new Biquad();

  // Oscillators
  let phaseChargeBass = 0;
  let phaseChargeLFO = 0;
  let phaseChargeWhine = 0;

  let phaseBlastSub = 0;
  let phaseJetRumble = 0;
  let phaseJetWhine = 0;
  let phaseJetLFO = 0;

  let phaseWindLFO = 0;
  let phaseDiveWhistle = 0;
  let phaseLandThump = 0;

  // Pink noise state (Paul Kellet's algorithm)
  let b0L = 0, b1L = 0, b2L = 0, b3L = 0;
  let b0R = 0, b1R = 0, b2R = 0, b3R = 0;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;

    // Generate stereo pink noise
    const wL = Math.random() * 2 - 1;
    b0L = 0.99886 * b0L + wL * 0.0555179;
    b1L = 0.99332 * b1L + wL * 0.0750759;
    b2L = 0.96900 * b2L + wL * 0.1538520;
    b3L = 0.86650 * b3L + wL * 0.3104856;
    const pinkL = b0L + b1L + b2L + b3L + wL * 0.5362;

    const wR = Math.random() * 2 - 1;
    b0R = 0.99886 * b0R + wR * 0.0555179;
    b1R = 0.99332 * b1R + wR * 0.0750759;
    b2R = 0.96900 * b2R + wR * 0.1538520;
    b3R = 0.86650 * b3R + wR * 0.3104856;
    const pinkR = b0R + b1R + b2R + b3R + wR * 0.5362;

    let sigL = 0;
    let sigR = 0;

    // =========================================================================
    // 1. PHASE 1: ANTICIPATION (0.00s -> 2.50s) - Colossal Energy Buildup & Snap
    // =========================================================================
    if (t < tLaunch + 0.05) {
      const p = Math.min(1.0, t / tLaunch); // 0 -> 1

      // Choke right before blast (at 2.42s - 2.50s)
      let choke = 1.0;
      if (t > tLaunch - 0.08 && t <= tLaunch) {
        choke = Math.max(0.04, (tLaunch - t) / 0.08);
      }

      // Sub-bass energy coil (accelerating pulse from 3 Hz to 30 Hz)
      const pulseRate = 3.2 + Math.pow(p, 2.6) * 26.8;
      phaseChargeLFO += (2 * Math.PI * pulseRate) / sampleRate;
      const tremolo = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(phaseChargeLFO));

      const bassFreq = 34 + Math.pow(p, 1.8) * 58; // 34Hz -> 92Hz
      phaseChargeBass += (2 * Math.PI * bassFreq) / sampleRate;
      const subHarm = Math.sin(phaseChargeBass) + 0.38 * Math.sin(phaseChargeBass * 2);
      chargeRumbleL.setLowpass(bassFreq * 1.5, 1.3, sampleRate);
      const chargeBass = chargeRumbleL.process(subHarm) * tremolo * Math.pow(p, 1.3) * 0.58 * choke;

      // Inhaling Vortex / Suction sweep
      const suctionFreq = 160 + Math.pow(p, 2.3) * 2900; // 160Hz -> 3060Hz
      const suctionQ = 2.0 + p * 3.5;
      suctionL.setBandpass(suctionFreq, suctionQ, sampleRate);
      suctionR.setBandpass(suctionFreq * 1.04, suctionQ, sampleRate);
      const suctionSoundL = suctionL.process(wL) * Math.pow(p, 1.4) * 0.70 * choke;
      const suctionSoundR = suctionR.process(wR) * Math.pow(p, 1.4) * 0.70 * choke;

      // High-frequency magnetic turbo spool (warmly saturated, NO static tea-kettle)
      const whineFreq = 220 + Math.pow(p, 2.0) * 1980; // 220Hz -> 2200Hz
      phaseChargeWhine += (2 * Math.PI * whineFreq) / sampleRate;
      const rawWhine = Math.sin(phaseChargeWhine) + 0.3 * Math.sin(phaseChargeWhine * 2) + 0.1 * Math.sin(phaseChargeWhine * 3);
      const spoolWhine = saturate(rawWhine, 1.9) * Math.pow(p, 1.7) * 0.24 * choke;

      // Turbo-snap mechanical click at 2.45s right before launch
      let snap = 0;
      if (t >= tLaunch - 0.05 && t < tLaunch) {
        const dtSnap = t - (tLaunch - 0.05);
        snapL.setBandpass(3800, 3.0, sampleRate);
        snap = saturate(snapL.process(wL * 3.0), 3.0) * Math.exp(-dtSnap * 70.0) * 0.75;
      }

      sigL += chargeBass + suctionSoundL + spoolWhine + snap;
      sigR += chargeBass + suctionSoundR + spoolWhine + snap;
    }

    // =========================================================================
    // 2. PHASE 2: LAUNCH (2.50s -> 5.50s) - Detonation & Rocket Climb
    // =========================================================================
    if (t >= tLaunch && t < tPlateau + 0.1) {
      const dtLaunch = t - tLaunch;
      const pLaunch = Math.min(1.0, dtLaunch / launchSec); // 0 -> 1 during climb

      // Detonation Sub-Impact (at 2.50s, 190Hz -> 30Hz drop)
      if (dtLaunch < 0.9) {
        const subProgress = Math.min(1.0, dtLaunch / 0.22);
        const blastFreq = 180 * Math.exp(-subProgress * 3.0) + 30;
        phaseBlastSub += (2 * Math.PI * blastFreq) / sampleRate;
        blastSubL.setLowpass(160, 0.9, sampleRate);
        const subPunch = blastSubL.process(Math.sin(phaseBlastSub) * 2.2) * Math.exp(-dtLaunch * 4.5) * 0.95;
        sigL += subPunch;
        sigR += subPunch;
      }

      // Detonation Nitro Shockwave Crack (first 1.2s of launch)
      if (dtLaunch < 1.2) {
        blastCrackL.setBandpass(2600 * Math.exp(-dtLaunch * 2.5) + 900, 1.3, sampleRate);
        blastCrackR.setBandpass(2800 * Math.exp(-dtLaunch * 2.5) + 900, 1.3, sampleRate);
        const crackL = saturate(blastCrackL.process(wL * 3.0), 2.2) * Math.exp(-dtLaunch * 6.0) * 0.88;
        const crackR = saturate(blastCrackR.process(wR * 3.0), 2.2) * Math.exp(-dtLaunch * 6.0) * 0.88;
        sigL += crackL;
        sigR += crackR;
      }

      // Rocket Afterburner Climb Thrust (swells to full power)
      const thrustAmp = 0.35 + pLaunch * 0.65;
      const jetRumbleFreq = 55 + pLaunch * 40;
      phaseJetRumble += (2 * Math.PI * jetRumbleFreq) / sampleRate;
      jetThrustL.setLowpass(320 + pLaunch * 180, 1.0, sampleRate);
      jetThrustR.setLowpass(320 + pLaunch * 180, 1.0, sampleRate);
      const thrustL = jetThrustL.process(pinkL * 1.5 + Math.sin(phaseJetRumble) * 0.6) * thrustAmp * 0.55;
      const thrustR = jetThrustR.process(pinkR * 1.5 + Math.sin(phaseJetRumble) * 0.6) * thrustAmp * 0.55;

      // Rocket Whistle / Turbine Ascent (glides up cleanly with climb)
      const climbWhistleFreq = 1600 + pLaunch * 1400; // 1600Hz -> 3000Hz
      phaseJetWhine += (2 * Math.PI * climbWhistleFreq) / sampleRate;
      jetWhineL.setBandpass(climbWhistleFreq, 2.2, sampleRate);
      jetWhineR.setBandpass(climbWhistleFreq * 1.02, 2.2, sampleRate);
      const climbWhineL = jetWhineL.process(Math.sin(phaseJetWhine) * 0.8) * (0.15 + pLaunch * 0.25);
      const climbWhineR = jetWhineR.process(Math.sin(phaseJetWhine) * 0.8) * (0.15 + pLaunch * 0.25);

      // Rising aerodynamic wind as speed climbs
      const windClimbAmp = Math.pow(pLaunch, 1.5) * 0.6;
      windLowL.setLowpass(450 + pLaunch * 250, 0.8, sampleRate);
      windLowR.setLowpass(450 + pLaunch * 250, 0.8, sampleRate);
      const climbWindL = windLowL.process(pinkL) * windClimbAmp;
      const climbWindR = windLowR.process(pinkR) * windClimbAmp;

      sigL += thrustL + climbWhineL + climbWindL;
      sigR += thrustR + climbWhineR + climbWindR;
    }

    // =========================================================================
    // 3. PHASE 3: PLATEAU (5.50s -> 6.35s) - Peak Height 8.8m, FOV-Kick Apex
    // =========================================================================
    if (t >= tPlateau && t < tCruise + 0.1) {
      const dtPlateau = t - tPlateau;
      const pPlateau = Math.min(1.0, dtPlateau / plateauSec);

      // FOV Kick Stereo Expansion & High-altitude supersonic rush
      // Intense aerodynamic cutting sound (3.2 kHz air shear)
      windHighL.setBandpass(3200 + Math.sin(dtPlateau * 6) * 300, 1.4, sampleRate);
      windHighR.setBandpass(3400 + Math.cos(dtPlateau * 6) * 300, 1.4, sampleRate);
      const apexShearL = saturate(windHighL.process(pinkL * 2.2), 1.8) * 0.58;
      const apexShearR = saturate(windHighR.process(pinkR * 2.2), 1.8) * 0.58;

      // Deep steady core thrust
      jetThrustL.setLowpass(420, 1.0, sampleRate);
      jetThrustR.setLowpass(420, 1.0, sampleRate);
      const coreThrustL = jetThrustL.process(pinkL * 1.6) * 0.62;
      const coreThrustR = jetThrustR.process(pinkR * 1.6) * 0.62;

      sigL += apexShearL + coreThrustL;
      sigR += apexShearR + coreThrustR;
    }

    // =========================================================================
    // 4. PHASE 4: CRUISE (6.35s -> 10.27s) - Sustained Max Speed & Fuel Burn
    // =========================================================================
    if (t >= tCruise && t < tFall + 0.05) {
      const dtCruise = t - tCruise;
      const pCruise = Math.min(1.0, dtCruise / cruiseSec);

      // Turbulent wind gusts (0.9 Hz LFO)
      phaseWindLFO += (2 * Math.PI * 0.9) / sampleRate;
      const gustL = 1.0 + 0.28 * Math.sin(phaseWindLFO);
      const gustR = 1.0 + 0.28 * Math.cos(phaseWindLFO + 0.9);

      // Roaring wind rush (Pink noise through lowpass ~550 Hz + bandpass ~2200 Hz)
      windLowL.setLowpass(520, 0.8, sampleRate);
      windLowR.setLowpass(520, 0.8, sampleRate);
      const cruiseWindL = windLowL.process(pinkL) * 0.60 * gustL;
      const cruiseWindR = windLowR.process(pinkR) * 0.60 * gustR;

      windHighL.setBandpass(2100, 1.2, sampleRate);
      windHighR.setBandpass(2200, 1.2, sampleRate);
      const cruiseAirL = saturate(windHighL.process(pinkL * 1.6), 1.4) * 0.48 * gustL;
      const cruiseAirR = saturate(windHighR.process(pinkR * 1.6), 1.4) * 0.48 * gustR;

      // Rocket motor drone with fuel consumption flutter
      phaseJetLFO += (2 * Math.PI * 4.5) / sampleRate; // 4.5 Hz flutter
      const fuelFlutter = 1.0 + 0.08 * Math.sin(phaseJetLFO);

      // Warning pitch glide down as fuel depletes near end (last 0.8s: 9.47s -> 10.27s)
      let fuelDeplete = 1.0;
      if (t > tFall - 0.8) {
        fuelDeplete = Math.max(0.65, 1.0 - ((t - (tFall - 0.8)) / 0.8) * 0.35);
      }

      const cruiseWhistleFreq = (2600 + Math.sin(dtCruise * 2.0) * 120) * fuelFlutter * fuelDeplete;
      phaseJetWhine += (2 * Math.PI * cruiseWhistleFreq) / sampleRate;
      jetWhineL.setBandpass(cruiseWhistleFreq, 2.4, sampleRate);
      jetWhineR.setBandpass(cruiseWhistleFreq * 1.02, 2.4, sampleRate);
      const cruiseWhineL = jetWhineL.process(Math.sin(phaseJetWhine) * 0.5) * 0.20;
      const cruiseWhineR = jetWhineR.process(Math.sin(phaseJetWhine) * 0.5) * 0.20;

      sigL += cruiseWindL + cruiseAirL + cruiseWhineL;
      sigR += cruiseWindR + cruiseAirR + cruiseWhineR;
    }

    // =========================================================================
    // 5. PHASE 5: FALL (10.27s -> 11.27s) - Engine Cut-Off & Downward Dive
    // =========================================================================
    if (t >= tFall && t < tLand + 0.05) {
      const dtFall = t - tFall;
      const pFall = Math.min(1.0, dtFall / fallSec);

      // Rapid engine cutoff in first 150ms
      const cutoffEnv = Math.exp(-dtFall * 12.0);
      const cutoffPopL = saturate(snapL.process(wL * 2.0), 2.0) * cutoffEnv * 0.45;
      const cutoffPopR = saturate(snapR.process(wR * 2.0), 2.0) * cutoffEnv * 0.45;

      // Diving wind whistle (pitch accelerates downward with gravity: 18 m/s^2)
      // Whistle frequency glides from 2400 Hz down to 800 Hz as it dives
      const diveFreq = 2400 * Math.exp(-pFall * 1.1) + 400;
      phaseDiveWhistle += (2 * Math.PI * diveFreq) / sampleRate;
      diveWhistleL.setBandpass(diveFreq, 2.0, sampleRate);
      diveWhistleR.setBandpass(diveFreq * 0.98, 2.0, sampleRate);

      const diveVolume = 0.35 + pFall * 0.45; // Gets louder as vertical speed builds
      const diveWindL = diveWhistleL.process(pinkL * 1.8) * diveVolume;
      const diveWindR = diveWhistleR.process(pinkR * 1.8) * diveVolume;

      sigL += cutoffPopL + diveWindL;
      sigR += cutoffPopR + diveWindR;
    }

    // =========================================================================
    // 6. PHASE 6: TOUCHDOWN & RESIDUAL DECAY (11.27s -> 12.80s)
    // =========================================================================
    if (t >= tLand) {
      const dtLand = t - tLand;

      // Ground impact thump (low 65Hz shock + dust hiss)
      if (dtLand < 0.8) {
        const thumpFreq = 68 * Math.exp(-dtLand * 6.0) + 28;
        phaseLandThump += (2 * Math.PI * thumpFreq) / sampleRate;
        landThumpL.setLowpass(120, 0.9, sampleRate);
        const thump = landThumpL.process(Math.sin(phaseLandThump) * 2.0) * Math.exp(-dtLand * 5.5) * 0.85;

        // Ground air dust puff
        snapL.setBandpass(900, 1.2, sampleRate);
        const dustPuff = snapL.process(pinkL * 1.5) * Math.exp(-dtLand * 4.0) * 0.40;

        sigL += thump + dustPuff;
        sigR += thump + dustPuff;
      }

      // Residual cooling turbine spin-down and dissipation fade
      const decayEnv = Math.exp(-dtLand * 1.8);
      const coolDownFreq = Math.max(120, 650 - dtLand * 350);
      jetWhineL.setBandpass(coolDownFreq, 2.0, sampleRate);
      jetWhineR.setBandpass(coolDownFreq * 1.02, 2.0, sampleRate);
      const coolDownL = jetWhineL.process(pinkL) * decayEnv * 0.25;
      const coolDownR = jetWhineR.process(pinkR) * decayEnv * 0.25;

      sigL += coolDownL;
      sigR += coolDownR;
    }

    // Master envelope: smooth start at 0.0s, fade out at very end
    let master = 1.0;
    if (t < 0.05) master = t / 0.05;
    if (t > totalDuration - 0.4) {
      master = Math.max(0, (totalDuration - t) / 0.4);
    }

    // Stereo saturation limiter
    outL[i] = Math.tanh((sigL * master) * 1.30) * 0.92;
    outR[i] = Math.tanh((sigR * master) * 1.30) * 0.92;
  }

  return createWavBuffer(sampleRate, 2, outL, outR);
}

// Run CLI
const targetPath = path.resolve('sound/turbo-synth.wav');
console.log(`Generating in-game synchronized Rocket Turbo SFX (12.8s) -> ${targetPath}`);
const wavBuffer = generateTurboWav();
fs.writeFileSync(targetPath, wavBuffer);
console.log(`Saved ${wavBuffer.length} bytes (${(wavBuffer.length / 1024).toFixed(1)} KB). Done!`);

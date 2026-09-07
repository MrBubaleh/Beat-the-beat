import type { SfxConfig } from '@core/sfx/config';
import type { BedTarget } from '@core/sfx/types';
import { clamp } from '@core/sfx/types';
import type { VoiceNodes } from './SfxPalette';

type MotorConfig = SfxConfig['palette']['motor'];
export interface MotorVoice extends VoiceNodes {
  update(target: BedTarget, config: MotorConfig, at: number, tau: number): void;
}

export function createMotor(ctx: BaseAudioContext, noiseBuffer: AudioBuffer, destination: AudioNode, target: BedTarget,
  config: MotorConfig): MotorVoice {
  const exhaust = ctx.createOscillator();
  const real = new Float32Array(13), imaginary = new Float32Array(13);
  for (let i = 1; i < imaginary.length; i++) {
    const amplitude = (i % 2 === 0 ? 0.78 : 1) / i ** 0.85;
    real[i] = amplitude * Math.sin(i * 0.47);
    imaginary[i] = amplitude * Math.cos(i * 0.47);
  }
  exhaust.setPeriodicWave(ctx.createPeriodicWave(real, imaginary));
  const exhaustGain = ctx.createGain();
  const saturation = ctx.createWaveShaper(); saturation.oversample = '2x';
  let drive = 0;
  const setDrive = (value: number) => {
    if (drive === value) return;
    drive = value;
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / (curve.length - 1) * 2 - 1) * drive) / Math.tanh(drive);
    saturation.curve = curve;
  };
  const body = ctx.createBiquadFilter(); body.type = 'lowpass'; body.Q.value = 0.65;
  const dc = ctx.createBiquadFilter(); dc.type = 'highpass'; dc.frequency.value = 48;
  const intake = ctx.createBufferSource(); intake.buffer = noiseBuffer; intake.loop = true;
  const intakeFilter = ctx.createBiquadFilter(); intakeFilter.type = 'bandpass';
  const intakeGain = ctx.createGain();
  const mechanical = ctx.createOscillator(); mechanical.type = 'triangle';
  const mechanicalGain = ctx.createGain();
  const wobble = ctx.createOscillator(); wobble.frequency.value = 7.3;
  const wobbleDepth = ctx.createGain();
  const pulse = ctx.createGain(); pulse.gain.value = 0.8;
  const pulseDepth = ctx.createGain();
  exhaust.connect(exhaustGain); exhaustGain.connect(saturation); saturation.connect(body);
  body.connect(dc); dc.connect(pulse);
  intake.connect(intakeFilter); intakeFilter.connect(intakeGain); intakeGain.connect(pulse);
  mechanical.connect(mechanicalGain); mechanicalGain.connect(pulse);
  wobble.connect(wobbleDepth); wobbleDepth.connect(exhaust.detune); wobbleDepth.connect(mechanical.detune);
  exhaust.connect(pulseDepth); pulseDepth.connect(intakeGain.gain);
  pulse.connect(destination);
  const update = (t: BedTarget, c: MotorConfig, at: number, tau: number) => {
    const load = clamp(t.load ?? 0.32);
    const smooth = (p: AudioParam, value: number) => p.setTargetAtTime(value, at, tau);
    smooth(exhaust.frequency, t.hz);
    smooth(exhaustGain.gain, c.exhaustMix * (0.55 + load * 0.45));
    smooth(body.frequency, t.filterHz * (0.6 + load * 0.5));
    smooth(intakeFilter.frequency, t.filterHz * (0.9 + load * 0.35));
    smooth(intakeFilter.Q, c.intakeQ);
    smooth(intakeGain.gain, c.intakeMix * (0.22 + load * 0.65));
    smooth(pulseDepth.gain, c.intakeMix * c.roughness * (0.3 + load * 0.7));
    smooth(mechanical.frequency, t.hz * 3.02);
    smooth(mechanicalGain.gain, c.mechanicalMix * (0.45 + load * 0.55));
    smooth(wobbleDepth.gain, c.roughness * 24);
    setDrive(c.drive);
  };
  exhaust.frequency.value = target.hz; mechanical.frequency.value = target.hz * 3.02;
  exhaustGain.gain.value = 0; intakeGain.gain.value = 0; mechanicalGain.gain.value = 0; pulseDepth.gain.value = 0;
  update(target, config, ctx.currentTime, 0.05);
  return { nodes: [exhaust, exhaustGain, saturation, body, dc, intake, intakeFilter, intakeGain,
    mechanical, mechanicalGain, wobble, wobbleDepth, pulse, pulseDepth],
    sources: [exhaust, intake, mechanical, wobble], update };
}
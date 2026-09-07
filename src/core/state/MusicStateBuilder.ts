import type { AudioConfig } from '@core/config/schemas';
import type { MusicState, RawFeatures } from './MusicState';

export class MusicStateBuilder {
  private _energy = 0;
  private _beat = false;
  private _brightness = 0;
  private _silence = false;
  private _lastT = 0;
  private _lastBeat = -Infinity;
  private _fluxHistory: number[] = [];
  private _silentFrames = 0;
  private _lastSilenceEnd = -Infinity;
  private _rmsMin = Infinity;
  private _rmsMax = -Infinity;
  private _centroidMin = Infinity;
  private _centroidMax = -Infinity;

  constructor(private readonly config: AudioConfig) {}

  push(features: RawFeatures): void {
    const t = features.t;
    const dt = Math.max(0, t - this._lastT);
    this._lastT = t;

    this.updateEnergy(features.rms, dt);
    this.updateBeat(features.spectralFlux, t);
    this.updateSilence(features.rms, t);
    this.updateBrightness(features.spectralCentroid, dt);
  }

  get state(): MusicState {
    return {
      audioTime: this._lastT,
      energy: { value: this._energy, audioTime: this._lastT },
      beat: { value: this._beat, audioTime: this._lastT },
      brightness: { value: this._brightness, audioTime: this._lastT },
      silence: { value: this._silence, audioTime: this._lastT },
    };
  }

  reset(): void {
    this._energy = 0;
    this._beat = false;
    this._brightness = 0;
    this._silence = false;
    this._lastT = 0;
    this._lastBeat = -Infinity;
    this._fluxHistory = [];
    this._silentFrames = 0;
    this._lastSilenceEnd = -Infinity;
    this._rmsMin = Infinity;
    this._rmsMax = -Infinity;
    this._centroidMin = Infinity;
    this._centroidMax = -Infinity;
  }

  private updateEnergy(rms: number, dt: number): void {
    this.leakyBounds(rms, dt, 'energy');
    const target = this.normalize(rms, this._rmsMin, this._rmsMax);
    const tau = target > this._energy
      ? this.config.energy.attackSeconds
      : this.config.energy.releaseSeconds;
    this._energy += this.emaAlpha(tau, dt) * (target - this._energy);
  }

  private updateBeat(flux: number, t: number): void {
    this._fluxHistory.push(flux);
    if (this._fluxHistory.length > this.config.beat.rollingWindow) {
      this._fluxHistory.shift();
    }
    if (this._fluxHistory.length < 8) {
      this._beat = false;
      return;
    }
    const { mean, std } = this.meanStd(this._fluxHistory);
    const threshold = mean + this.config.beat.thresholdK * std;
    const minInterval = this.config.beat.minIntervalMs / 1000;
    if (flux > threshold && t - this._lastBeat >= minInterval) {
      this._lastBeat = t;
      this._beat = true;
    } else {
      this._beat = false;
    }
  }

  private updateSilence(rms: number, t: number): void {
    const enterThreshold = this.config.silence.rmsThreshold;
    const exitThreshold = enterThreshold * this.config.silence.exitFactor;

    if (rms < enterThreshold) {
      this._silentFrames++;
    } else {
      if (this._silence && rms >= exitThreshold) {
        this._silence = false;
        this._lastSilenceEnd = t;
      }
      this._silentFrames = 0;
    }

    if (!this._silence) {
      const debounce = this.config.silence.debounceMs / 1000;
      if (this._silentFrames >= this.config.silence.minFrames && t - this._lastSilenceEnd >= debounce) {
        this._silence = true;
      }
    }
  }

  private updateBrightness(centroid: number, dt: number): void {
    this.leakyBounds(centroid, dt, 'brightness');
    const target = this.normalize(centroid, this._centroidMin, this._centroidMax);
    const tau = target > this._brightness
      ? this.config.brightness.attackSeconds
      : this.config.brightness.releaseSeconds;
    this._brightness += this.emaAlpha(tau, dt) * (target - this._brightness);
  }

  private leakyBounds(value: number, dt: number, kind: 'energy' | 'brightness'): void {
    if (kind === 'energy') {
      if (value < this._rmsMin) this._rmsMin = value;
      else this._rmsMin += this.emaAlpha(this.config.energy.minRiseSeconds, dt) * (value - this._rmsMin);
      if (value > this._rmsMax) this._rmsMax = value;
      else this._rmsMax += this.emaAlpha(this.config.energy.maxFallSeconds, dt) * (value - this._rmsMax);
    } else {
      if (value < this._centroidMin) this._centroidMin = value;
      else this._centroidMin += this.emaAlpha(this.config.brightness.minRiseSeconds, dt) * (value - this._centroidMin);
      if (value > this._centroidMax) this._centroidMax = value;
      else this._centroidMax += this.emaAlpha(this.config.brightness.maxFallSeconds, dt) * (value - this._centroidMax);
    }
  }

  private normalize(value: number, min: number, max: number): number {
    const range = max - min;
    if (range < 1e-6) return 0.5;
    const t = clamp01((value - min) / range);
    return t * t * (3 - 2 * t);
  }

  private emaAlpha(tauSeconds: number, dt: number): number {
    return 1 - Math.exp(-dt / Math.max(1e-6, tauSeconds));
  }

  private meanStd(values: number[]): { mean: number; std: number } {
    let sum = 0;
    for (const v of values) sum += v;
    const mean = sum / values.length;
    let sq = 0;
    for (const v of values) sq += (v - mean) * (v - mean);
    return { mean, std: Math.sqrt(sq / values.length) };
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

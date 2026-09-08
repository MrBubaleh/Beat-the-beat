import type { MusicForecast } from '../gameplay/musicPlanning';

export interface TimedValue {
  value: number | boolean;
  audioTime: number;
}

export interface RawFeatures {
  t: number;
  rms: number;
  spectralCentroid: number;
  spectralFlux: number;
  zcr?: number;
}

export interface MusicState {
  forecast?: MusicForecast;
  audioTime: number;
  energy: TimedValue;
  beat: TimedValue;
  brightness: TimedValue;
  silence: TimedValue;
}

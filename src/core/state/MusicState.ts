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
  audioTime: number;
  energy: TimedValue;
  beat: TimedValue;
  brightness: TimedValue;
  silence: TimedValue;
}

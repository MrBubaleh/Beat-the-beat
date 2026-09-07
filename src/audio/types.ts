import type { MusicState } from '@core/state/MusicState';
import type { AudioClock } from './AudioClock';

export interface IAudioSource {
  load(file: File): Promise<void>;
  play(): Promise<void>;
  restart(): Promise<void>;
  pause(): void;
  connect(ctx: AudioContext): AudioNode;
  dispose(): void;
}

export interface IAudioAnalyzer {
  start(sourceNode: AudioNode, clock: AudioClock): Promise<void>;
  getLatestState(): MusicState;
  restart(): void;
  stop(): void;
}

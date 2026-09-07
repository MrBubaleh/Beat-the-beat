import type { DirectorIntent } from '@core/state/DirectorIntent';
import type { MusicState } from '@core/state/MusicState';
import type { DirectorMemory } from './DirectorMemory';

export interface DirectorOutput {
  intents: DirectorIntent[];
  phase: string;
  phaseElapsed: number;
}

export interface Director {
  readonly phase: string;
  readonly phaseElapsed: number;
  readonly memory: DirectorMemory;
  update(dt: number, now: number, music: MusicState, stress: number): DirectorOutput;
  reset(): void;
}

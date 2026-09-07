import type { DirectorIntent } from './DirectorIntent';

export type DirectorPhase = 'calm' | 'buildUp' | 'intense' | 'peak' | 'cooldown';

export interface DirectorMemory {
  lastMajorEventAt: number;
  lastSpeedChangeAt: number;
  lastCameraChangeAt: number;
  recentDifficultyDelta: number[];
  intentHistory: DirectorIntent[];
}

export interface DirectorState {
  phase: DirectorPhase;
  phaseElapsed: number;
  memory: DirectorMemory;
}

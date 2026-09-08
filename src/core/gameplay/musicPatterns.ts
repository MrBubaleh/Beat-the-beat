export { requestMusicalPatterns } from './musicPlanning';

import type { DirectorPhase } from '@core/state/DirectorState';

export type MusicPatternKind =
  | 'calmCoins'
  | 'buildUpGuide'
  | 'intenseSlalom'
  | 'peakGate'
  | 'peakCoins'
  | 'horseRoadTransition';

export interface MusicPatternPlan {
  kind: MusicPatternKind;
  arrivalSeconds: number;
}

export type MusicSceneRouteHint =
  | 'straight'
  | 'diagonal'
  | 'slalom'
  | 'ramp'
  | 'transition';

export interface MusicSceneTelemetry {
  kind: MusicPatternKind;
  phase: DirectorPhase;
  reason: string;
  arrivalSeconds: number;
  remainingSeconds: number;
  leadDistance: number;
  guideLanes: number[];
  routeHint: MusicSceneRouteHint;
  echo: 'none' | 'ramp';
}

export function planMusicPattern(
  phase: DirectorPhase,
  canScheduleRamp: boolean,
  sequence: number,
): MusicPatternPlan | null {
  if (phase === 'buildUp') {
    return canScheduleRamp && sequence % 2 === 0
      ? { kind: 'peakGate', arrivalSeconds: 4.2 }
      : { kind: 'buildUpGuide', arrivalSeconds: 3.2 };
  }
  if (phase === 'intense') return { kind: 'intenseSlalom', arrivalSeconds: 2.6 };
  if (phase === 'peak') return { kind: 'peakCoins', arrivalSeconds: 1.8 };
  if (phase === 'cooldown') return { kind: 'calmCoins', arrivalSeconds: 2.2 };
  return null;
}

export function musicalLeadDistance(
  speed: number,
  arrivalSeconds: number,
  minLead = 36,
  maxLead = 110,
): number {
  return clamp(speed * arrivalSeconds, minLead, maxLead);
}

export function musicSceneRouteHint(kind: MusicPatternKind): MusicSceneRouteHint {
  if (kind === 'intenseSlalom') return 'slalom';
  if (kind === 'buildUpGuide' || kind === 'peakCoins') return 'diagonal';
  if (kind === 'peakGate') return 'ramp';
  if (kind === 'horseRoadTransition') return 'transition';
  return 'straight';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

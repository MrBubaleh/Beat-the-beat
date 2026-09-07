import type { DamageState } from '@core/gameplay/health';
import type { PlayerMode } from '@core/modes/types';
import type { PassabilityResult } from '@core/levelgen/passability';

export interface TrackMeta {
  fileName: string;
  artist: string;
  title: string;
  durationSeconds: number;
  searchQuery: string;
}

export interface ObstacleRef {
  kind: string;
  lane: number;
  z: number;
  horseAction?: string;
  redWall?: boolean;
  trainId?: number;
  source: 'obstacle' | 'train' | 'train_roof';
}

export interface PassabilityRef {
  passable: boolean;
  reason: PassabilityResult['reason'];
  mode: PlayerMode;
}

export type PlaytestEvent =
  | {
      e: 'session_start';
      t: number;
      p: number;
      seed: number;
    }
  | {
      e: 'hit';
      t: number;
      p: number;
      mode: PlayerMode;
      lane: number;
      dmg: DamageState;
      obs?: ObstacleRef;
      passable?: PassabilityRef;
    }
  | {
      e: 'game_over';
      t: number;
      p: number;
      mode: PlayerMode;
      hits: number;
    }
  | {
      e: 'mode';
      t: number;
      p: number;
      from: PlayerMode;
      to: PlayerMode;
      reason?: string;
    }
  | {
      e: 'bonus';
      t: number;
      p: number;
      kind: string;
      mode: PlayerMode;
    }
  | {
      e: 'heartbeat';
      t: number;
      p: number;
      mode: PlayerMode;
      lane: number;
      dmg: DamageState;
      phase: string;
      energy: number;
      brightness: number;
    }
  | {
      e: 'session_end';
      t: number;
      p: number;
      reason: 'death' | 'manual' | 'song_end';
    }
  | {
      e: 'recovery_step';
      t: number;
      p: number;
      from: DamageState;
      to: DamageState;
      mode: PlayerMode;
      combo: number;
      cleanSeconds: number;
    }
  | {
      e: 'hit_while_damaged';
      t: number;
      p: number;
      mode: PlayerMode;
      lane: number;
      from: DamageState;
      to: DamageState;
    };

export interface PlaytestSummary {
  hits: number;
  modeSwitches: number;
  maxCombo: number;
  distance: number;
  coins: number;
  carSeconds: number;
  horseSeconds: number;
  rocketSeconds: number;
  trainRideSeconds: number;
  horsePickups: number;
  carPickups: number;
  rocketPickups: number;
  nitroActivations: number;
  unpassableHits: number;
  avgMusicEnergy: number;
  maxMusicEnergy: number;
  recoverySteps: number;
  hitsWhileDamaged: number;
  woundedSeconds: number;
}

export interface PlaytestFpsStats {
  samples: number;
  avg: number;
  min: number;
  p10: number;
}

export interface PlaytestSessionContext {
  buildVersion: string;
  buildSeq: number;
  gameplayRules: string;
  levelgenPreset: string;
  adrenalinePreset: string;
  fps: PlaytestFpsStats;
  userAgent: string;
}

export interface PlaytestSessionFile {
  version: 2;
  track: TrackMeta;
  session: {
    seed: number;
    startedAt: string;
    endedAt: string;
    durationSeconds: number;
    songProgressEnd: number;
    endReason: 'death' | 'manual' | 'song_end';
  };
  context: PlaytestSessionContext;
  survey: Record<string, number | string>;
  summary: PlaytestSummary;
  events: PlaytestEvent[];
}

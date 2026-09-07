import type { PlayerAction } from '@core/gameplay/actions';
import type { MusicState } from '@core/state/MusicState';

export interface ReplayInputEvent {
  atMs: number;
  action: PlayerAction;
}

export interface ReplayMusicSample {
  t: number;
  music: MusicState;
}

export interface ReplayData {
  version: 1;
  seed: number;
  durationSeconds: number;
  trackDurationSeconds?: number;
  inputs: ReplayInputEvent[];
  music: ReplayMusicSample[];
}

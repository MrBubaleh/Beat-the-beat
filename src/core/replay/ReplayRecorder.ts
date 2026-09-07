import type { PlayerAction } from '@core/gameplay/actions';
import type { MusicState } from '@core/state/MusicState';
import type { ReplayData, ReplayInputEvent, ReplayMusicSample } from './ReplayTypes';

export class ReplayRecorder {
  private inputs: ReplayInputEvent[] = [];
  private music: ReplayMusicSample[] = [];
  private _seed = 0;
  private trackDurationSeconds = 0;
  private recording = false;

  get isRecording(): boolean {
    return this.recording;
  }

  start(seed: number, trackDurationSeconds = 0): void {
    this._seed = seed;
    this.trackDurationSeconds = trackDurationSeconds;
    this.recording = true;
    this.inputs = [];
    this.music = [];
  }

  recordInput(atMs: number, action: PlayerAction): void {
    if (!this.recording) return;
    this.inputs.push({ atMs, action });
  }

  recordMusic(t: number, music: MusicState): void {
    if (!this.recording) return;
    this.music.push({ t, music });
  }

  finish(durationSeconds: number): ReplayData | null {
    if (!this.recording) return null;
    this.recording = false;
    return {
      version: 1,
      seed: this._seed,
      durationSeconds,
      ...(this.trackDurationSeconds > 0
        ? { trackDurationSeconds: this.trackDurationSeconds }
        : {}),
      inputs: this.inputs,
      music: this.music,
    };
  }
}

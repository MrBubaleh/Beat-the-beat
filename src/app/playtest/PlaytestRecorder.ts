import type { GameSnapshot } from '@core/gameplay/GameSim';
import type { PlaytestEvent, PlaytestSessionFile, PlaytestSummary, TrackMeta } from '@core/playtest/types';

const MAX_EVENTS = 500;
const HEARTBEAT_SECONDS = 15;

export class PlaytestRecorder {
  private recording = false;
  private track: TrackMeta | null = null;
  private seed = 0;
  private startedAt = '';
  private events: PlaytestEvent[] = [];
  private nextHeartbeatAt = HEARTBEAT_SECONDS;
  private energySum = 0;
  private energySamples = 0;
  private maxEnergy = 0;

  get isRecording(): boolean {
    return this.recording;
  }

  get eventCount(): number {
    return this.events.length;
  }

  start(track: TrackMeta, seed: number): void {
    this.recording = true;
    this.track = track;
    this.seed = seed;
    this.startedAt = new Date().toISOString();
    this.events = [];
    this.nextHeartbeatAt = HEARTBEAT_SECONDS;
    this.energySum = 0;
    this.energySamples = 0;
    this.maxEnergy = 0;
    this.push({
      e: 'session_start',
      t: 0,
      p: 0,
      seed,
    });
  }

  push(event: PlaytestEvent): void {
    if (!this.recording) return;
    if (this.events.length >= MAX_EVENTS) return;
    this.events.push(event);
  }

  sampleMusic(snapshot: GameSnapshot): void {
    if (!this.recording) return;
    this.energySum += snapshot.musicEnergy;
    this.energySamples += 1;
    this.maxEnergy = Math.max(this.maxEnergy, snapshot.musicEnergy);
  }

  maybeHeartbeat(snapshot: GameSnapshot, songProgress: number): void {
    if (!this.recording) return;
    const t = snapshot.player.gameTime;
    if (t < this.nextHeartbeatAt) return;
    this.nextHeartbeatAt += HEARTBEAT_SECONDS;
    this.push({
      e: 'heartbeat',
      t: round2(t),
      p: round3(songProgress),
      mode: snapshot.player.mode,
      lane: snapshot.player.lane,
      dmg: snapshot.player.damageState,
      phase: snapshot.phase,
      energy: round3(snapshot.musicEnergy),
      brightness: round3(snapshot.musicBrightness),
    });
  }

  finish(
    endReason: 'death' | 'manual' | 'song_end',
    snapshot: GameSnapshot,
    songProgress: number,
  ): Omit<PlaytestSessionFile, 'survey' | 'context'> | null {
    if (!this.recording || !this.track) return null;
    const endedAt = new Date().toISOString();
    const durationSeconds = snapshot.player.gameTime;
    this.push({
      e: 'session_end',
      t: round2(durationSeconds),
      p: round3(songProgress),
      reason: endReason,
    });
    const session: Omit<PlaytestSessionFile, 'survey' | 'context'> = {
      version: 2,
      track: this.track,
      session: {
        seed: this.seed,
        startedAt: this.startedAt,
        endedAt,
        durationSeconds: round2(durationSeconds),
        songProgressEnd: round3(songProgress),
        endReason,
      },
      summary: buildSummary(snapshot, this.events, this.energySum, this.energySamples, this.maxEnergy),
      events: [...this.events],
    };
    this.recording = false;
    this.track = null;
    this.events = [];
    return session;
  }

  cancel(): void {
    this.recording = false;
    this.track = null;
    this.events = [];
  }
}

function buildSummary(
  snapshot: GameSnapshot,
  events: PlaytestEvent[],
  energySum: number,
  energySamples: number,
  maxEnergy: number,
): PlaytestSummary {
  const unpassableHits = events.filter(
    (event) => event.e === 'hit' && event.passable && !event.passable.passable,
  ).length;
  return {
    hits: snapshot.runStats.hits,
    modeSwitches: snapshot.runStats.modeSwitches,
    maxCombo: snapshot.runStats.maxCombo,
    distance: round2(snapshot.player.distance),
    coins: snapshot.player.coins,
    carSeconds: round2(snapshot.runStats.carSeconds),
    horseSeconds: round2(snapshot.runStats.horseSeconds),
    rocketSeconds: round2(snapshot.runStats.rocketSeconds),
    trainRideSeconds: round2(snapshot.runStats.trainRideSeconds),
    horsePickups: snapshot.runStats.horsePickups,
    carPickups: snapshot.runStats.carPickups,
    rocketPickups: snapshot.runStats.rocketPickups,
    nitroActivations: snapshot.runStats.nitroActivations,
    unpassableHits,
    avgMusicEnergy: energySamples > 0 ? round3(energySum / energySamples) : 0,
    maxMusicEnergy: round3(maxEnergy),
    recoverySteps: snapshot.runStats.recoverySteps,
    hitsWhileDamaged: snapshot.runStats.hitsWhileDamaged,
    woundedSeconds: round2(snapshot.runStats.woundedSeconds),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

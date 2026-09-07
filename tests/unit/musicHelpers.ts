import type { MusicState } from '@core/state/MusicState';
import type { GameConfig } from '@core/config/schemas';

export function emptyMusic(): MusicState {
  return {
    audioTime: 0,
    energy: { value: 0, audioTime: 0 },
    beat: { value: false, audioTime: 0 },
    brightness: { value: 0, audioTime: 0 },
    silence: { value: false, audioTime: 0 },
  };
}

export interface MusicOverrides {
  energy?: number;
  beat?: boolean;
  brightness?: number;
  silence?: boolean;
  audioTime?: number;
}

export function makeMusic(overrides: MusicOverrides = {}): MusicState {
  return {
    audioTime: overrides.audioTime ?? 0,
    energy: { value: overrides.energy ?? 0, audioTime: 0 },
    beat: { value: overrides.beat ?? false, audioTime: 0 },
    brightness: { value: overrides.brightness ?? 0, audioTime: 0 },
    silence: { value: overrides.silence ?? false, audioTime: 0 },
  };
}

export function withoutRocketSpawn(game: GameConfig): GameConfig {
  return {
    ...game,
    rocket: {
      ...game.rocket,
      firstRocketMinSeconds: 10_000,
      spawnCooldownSeconds: 10_000,
      minModeSwitchSeconds: 10_000,
      rampPickupChance: 0,
      jumpPickupChance: 0,
      maxPickupsPerSong: 1,
    },
  };
}

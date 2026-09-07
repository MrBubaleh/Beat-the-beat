import type { GameConfig, LevelgenConfig } from '@core/config/schemas';
import type { Director } from '@core/director/types';
import type { PlayerAction } from '@core/gameplay/actions';
import { GameSim } from '@core/gameplay/GameSim';
import type { GameSnapshot } from '@core/gameplay/GameSim';
import type { MusicState } from '@core/state/MusicState';
import type { ReplayData } from './ReplayTypes';

const FIXED_DT = 1 / 60;

export interface ReplayRunOptions {
  game: GameConfig;
  levelgen: LevelgenConfig;
  director: Director;
}

export class ReplayRunner {
  constructor(private readonly opts: ReplayRunOptions) {}

  run(replay: ReplayData): GameSnapshot[] {
    const tick = { t: 0 };
    let inputIndex = 0;
    let musicIndex = 0;

    const sim = new GameSim({
      game: this.opts.game,
      levelgen: this.opts.levelgen,
      director: this.opts.director,
      seed: replay.seed,
      nowMs: () => tick.t * 1000,
      getSongProgress: () =>
        replay.trackDurationSeconds && replay.trackDurationSeconds > 0
          ? tick.t / replay.trackDurationSeconds
          : 0,
      consumeInput: () => {
        const ms = tick.t * 1000;
        const out: PlayerAction[] = [];
        while (inputIndex < replay.inputs.length && replay.inputs[inputIndex].atMs <= ms) {
          out.push(replay.inputs[inputIndex].action);
          inputIndex++;
        }
        return out;
      },
      getMusic: () => {
        while (musicIndex + 1 < replay.music.length && replay.music[musicIndex + 1].t <= tick.t) {
          musicIndex++;
        }
        return replay.music[musicIndex]?.music ?? emptyMusic();
      },
    });

    const snapshots: GameSnapshot[] = [];
    const steps = Math.round(replay.durationSeconds * 60);
    for (let i = 0; i < steps && !sim.gameOver; i++) {
      sim.fixedUpdate(FIXED_DT);
      tick.t += FIXED_DT;
      snapshots.push(structuredClone(sim.getSnapshot()));
    }
    return snapshots;
  }
}

function emptyMusic(): MusicState {
  return {
    audioTime: 0,
    energy: { value: 0, audioTime: 0 },
    beat: { value: false, audioTime: 0 },
    brightness: { value: 0, audioTime: 0 },
    silence: { value: false, audioTime: 0 },
  };
}

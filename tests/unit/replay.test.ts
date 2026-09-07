import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import { PassthroughDirector } from '@core/director/PassthroughDirector';
import { GameSim } from '@core/gameplay/GameSim';
import type { GameSnapshot } from '@core/gameplay/GameSim';
import type { PlayerAction } from '@core/gameplay/actions';
import { ReplayRecorder } from '@core/replay/ReplayRecorder';
import { ReplayRunner } from '@core/replay/ReplayRunner';
import type { ReplayData } from '@core/replay/ReplayTypes';
import { makeMusic, withoutRocketSpawn } from './musicHelpers';

describe('ReplayRecorder', () => {
  it('records inputs and music, finish returns replay data', () => {
    const recorder = new ReplayRecorder();
    recorder.start(123, 180);
    recorder.recordInput(1000, 'jump');
    recorder.recordMusic(0.5, makeMusic({ energy: 0.4 }));
    const data = recorder.finish(10);
    expect(data).not.toBeNull();
    expect(data!.seed).toBe(123);
    expect(data!.durationSeconds).toBe(10);
    expect(data!.trackDurationSeconds).toBe(180);
    expect(data!.inputs).toEqual([{ atMs: 1000, action: 'jump' }]);
    expect(data!.music[0].music.energy.value).toBe(0.4);
    expect(recorder.isRecording).toBe(false);
  });

  it('ignores events before start and finish returns null', () => {
    const recorder = new ReplayRecorder();
    recorder.recordInput(500, 'jump');
    expect(recorder.finish(1)).toBeNull();
  });
});

describe('ReplayRunner', () => {
  function makeReplay(seed = 7): ReplayData {
    return {
      version: 1,
      seed,
      durationSeconds: 10,
      inputs: [
        { atMs: 2000, action: 'laneRight' },
        { atMs: 5000, action: 'jump' },
      ],
      music: [
        { t: 0, music: makeMusic({ energy: 0.2 }) },
        { t: 5, music: makeMusic({ energy: 0.8 }) },
      ],
    };
  }

  function run(replay: ReplayData) {
    const runner = new ReplayRunner({
      game: withoutRocketSpawn(gameRaw as GameConfig),
      levelgen: levelgenRaw as LevelgenConfig,
      director: new PassthroughDirector(directorRaw as DirectorConfig),
    });
    return runner.run(replay);
  }

  it('is fully deterministic for identical replay data', () => {
    const a = run(makeReplay());
    const b = run(makeReplay());
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toStrictEqual(b[i]);
    }
  });

  it('differs when the seed changes', () => {
    const a = run(makeReplay());
    const other = run(makeReplay(99));
    const differs = other.some(
      (s, i) => JSON.stringify(s.obstacles) !== JSON.stringify(a[i]?.obstacles),
    );
    expect(differs).toBe(true);
  });

  it('differs when inputs change', () => {
    const a = run(makeReplay());
    const noInput = makeReplay();
    noInput.inputs = [];
    const c = run(noInput);
    const laneChanged = a.find((s) => s.player.lane !== 0);
    expect(laneChanged).toBeDefined();
    expect(c.some((s, i) => s.player.lane !== a[i]?.player.lane)).toBe(true);
  });
});

describe('live recording + replay integration', () => {
  it('records inputs in game-time domain and replays them faithfully', () => {
    const seed = 42;
    const FIXED_DT = 1 / 60;
    const scheduled: Record<number, PlayerAction[]> = {
      100: ['laneLeft'],
      300: ['jump'],
    };
    const recorder = new ReplayRecorder();
    const director = new PassthroughDirector(directorRaw as DirectorConfig);
    let tick = 0;

    const live = new GameSim({
      game: withoutRocketSpawn(gameRaw as GameConfig),
      levelgen: levelgenRaw as LevelgenConfig,
      director,
      seed,
      nowMs: () => 0,
      consumeInput: () => {
        const actions = scheduled[tick] ?? [];
        if (recorder.isRecording) {
          const tMs = live.playerSim.state.gameTime * 1000;
          for (const action of actions) recorder.recordInput(tMs, action);
        }
        return actions;
      },
      getMusic: () => {
        const music = makeMusic({ energy: 0.4 });
        if (recorder.isRecording) {
          recorder.recordMusic(live.playerSim.state.gameTime, music);
        }
        return music;
      },
    });
    recorder.start(seed);

    const liveSnapshots: GameSnapshot[] = [];
    for (tick = 0; tick < 900 && !live.gameOver; tick++) {
      live.fixedUpdate(FIXED_DT);
      liveSnapshots.push(structuredClone(live.getSnapshot()));
    }

    const data = recorder.finish(live.playerSim.state.gameTime);
    expect(data).not.toBeNull();
    expect(data!.inputs.length).toBeGreaterThan(0);

    const runner = new ReplayRunner({
      game: withoutRocketSpawn(gameRaw as GameConfig),
      levelgen: levelgenRaw as LevelgenConfig,
      director: new PassthroughDirector(directorRaw as DirectorConfig),
    });
    const replay = runner.run(data!);

    expect(replay).toHaveLength(liveSnapshots.length);
    for (let i = 0; i < replay.length; i++) {
      expect(replay[i]).toStrictEqual(liveSnapshots[i]);
    }
  });
});

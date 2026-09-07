import { describe, expect, it } from 'vitest';
import { createPlaytestExportBundle } from '../../../src/app/playtest/playtestStore';
import type { PlaytestSessionFile } from '../../../src/core/playtest/types';

const sessionStub = {
  version: 2,
  track: {
    fileName: 'track.mp3',
    artist: 'A',
    title: 'B',
    durationSeconds: 120,
    searchQuery: 'B A',
  },
  session: {
    seed: 1,
    startedAt: '2026-09-01T00:00:00.000Z',
    endedAt: '2026-09-01T00:01:00.000Z',
    durationSeconds: 60,
    songProgressEnd: 0.5,
    endReason: 'death',
  },
  context: {
    buildVersion: '0.1.0',
    buildSeq: 2,
    gameplayRules: 'destroy',
    levelgenPreset: 'mega-traffic',
    adrenalinePreset: 'default',
    fps: { samples: 10, avg: 60, min: 55, p10: 57 },
    userAgent: 'test',
  },
  survey: {},
  summary: {
    hits: 0,
    modeSwitches: 0,
    maxCombo: 0,
    distance: 0,
    coins: 0,
    carSeconds: 0,
    horseSeconds: 0,
    rocketSeconds: 0,
    trainRideSeconds: 0,
    horsePickups: 0,
    carPickups: 0,
    rocketPickups: 0,
    nitroActivations: 0,
    unpassableHits: 0,
    avgMusicEnergy: 0,
    maxMusicEnergy: 0,
    recoverySteps: 0,
    hitsWhileDamaged: 0,
    woundedSeconds: 0,
  },
  events: [],
} satisfies PlaytestSessionFile;

describe('playtest export bundle', () => {
  it('tags export with build sequence metadata', () => {
    const bundle = createPlaytestExportBundle(
      [{ ...sessionStub, storedAt: '2026-09-01T00:02:00.000Z', id: 1 }],
      '0.1.0',
      2,
    );
    expect(bundle.buildSeq).toBe(2);
    expect(bundle.buildVersion).toBe('0.1.0');
    expect(bundle.count).toBe(1);
    expect(bundle.sessions[0]?.context.buildSeq).toBe(2);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import game from '../../configs/game.default.json';
import audio from '../../configs/audio.default.json';
import { AudioSession } from '@audio/AudioSession';

const calls = vi.hoisted(() => ({
  rewind: vi.fn(), rate: vi.fn(), tone: vi.fn(), volume: vi.fn(), restart: vi.fn(),
}));
vi.mock('@audio/VideoFileAudioSource', () => ({
  VideoFileAudioSource: class {
    load = async () => {};
    loadUrl = async () => {};
    connect = () => ({ connect: vi.fn() });
    setPlaybackRate = calls.rate;
    setPreviewVisible = vi.fn();
    restart = async () => { calls.restart(); };
    rewind = calls.rewind;
    dispose = vi.fn();
    play = async () => {};
    pause = vi.fn();
  },
}));
vi.mock('@audio/AudioGraph', () => ({
  AudioGraph: class {
    musicBus = {};
    setTutorialTone = calls.tone;
    setMusicVolume = calls.volume;
    setMasterVolume = vi.fn();
    setTrackEndVolume = vi.fn();
    setPortalJelly = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock('@audio/AudioWorkletAnalyzer', () => ({
  AudioWorkletAnalyzer: class {
    start = async () => {};
    stop = vi.fn();
    restart = vi.fn();
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('AudioContext', class {
    currentTime = 0;
    state = 'running';
    close = async () => {};
  });
});
afterEach(() => vi.unstubAllGlobals());

async function loadedSession() {
  const session = new AudioSession(audio, game.tutorial);
  await session.loadFile(new File([], 'tutorial.wav'));
  return session;
}

describe('tutorial audio lifecycle', () => {
  it('applies rate floor and detune/EQ, restores normal playback without changing volume', async () => {
    const session = await loadedSession();
    session.setTutorialPlaybackScale(0.35);
    expect(calls.rate).toHaveBeenLastCalledWith(0.68);
    expect(calls.tone).toHaveBeenLastCalledWith(1, -70);
    session.setTutorialPlaybackScale(1);
    expect(calls.rate).toHaveBeenLastCalledWith(1);
    expect(calls.tone).toHaveBeenLastCalledWith(0, -70);
    expect(calls.volume).not.toHaveBeenCalled();
  });

  it('tracks intermediate scale and honors changed audio settings', async () => {
    const session = await loadedSession();
    session.setTutorialPlaybackScale(0.8);
    expect(calls.rate.mock.lastCall![0]).toBeCloseTo(0.827, 2);
    session.setTutorialConfig({ ...game.tutorial, audioPlaybackRatePower: 2, audioDetuneCents: -60 });
    expect(calls.rate.mock.lastCall![0]).toBeCloseTo(0.68);
    expect(calls.tone.mock.lastCall![1]).toBe(-60);
  });

  it('applies a scale set before loading and resets it on track restart', async () => {
    const session = new AudioSession(audio, game.tutorial);
    session.setTutorialPlaybackScale(0.35);
    await session.loadFile(new File([], 'tutorial.wav'));
    expect(calls.rate).toHaveBeenLastCalledWith(0.68);
    await session.restart();
    expect(calls.rate).toHaveBeenLastCalledWith(1);
    expect(calls.restart).toHaveBeenCalledOnce();
  });

  it('rewinds and clears tutorial audio before countdown generation without starting playback', async () => {
    const session = await loadedSession();
    session.setTutorialPlaybackScale(0.35);
    session.prepareRestart();
    expect(calls.rewind).toHaveBeenCalledOnce();
    expect(calls.restart).not.toHaveBeenCalled();
    expect(calls.rate).toHaveBeenLastCalledWith(1);
    expect(session.isPlaying).toBe(false);
  });

  it('restores normal rate on disposal and sanitizes invalid scales', async () => {
    const session = await loadedSession();
    session.setTutorialPlaybackScale(NaN);
    expect(calls.rate).toHaveBeenLastCalledWith(1);
    session.setTutorialPlaybackScale(-1);
    expect(calls.rate).toHaveBeenLastCalledWith(0.68);
    session.dispose();
    expect(calls.rate).toHaveBeenLastCalledWith(1);
  });
});

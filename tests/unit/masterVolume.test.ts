import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MASTER_VOLUME,
  MASTER_VOLUME_STORAGE_KEY,
  clampMasterVolume,
  loadStoredMasterVolume,
  storeMasterVolume,
} from '../../src/app/masterVolume';

describe('master volume', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clamps to 0..1 and falls back for non-finite values', () => {
    expect(clampMasterVolume(0.4)).toBe(0.4);
    expect(clampMasterVolume(-2)).toBe(0);
    expect(clampMasterVolume(4)).toBe(1);
    expect(clampMasterVolume(Number.NaN)).toBe(DEFAULT_MASTER_VOLUME);
  });

  it('reads and stores a clamped value', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });
    expect(loadStoredMasterVolume()).toBe(DEFAULT_MASTER_VOLUME);
    storeMasterVolume(1.8);
    expect(store.get(MASTER_VOLUME_STORAGE_KEY)).toBe('1');
    expect(loadStoredMasterVolume()).toBe(1);
    store.set(MASTER_VOLUME_STORAGE_KEY, '0.25');
    expect(loadStoredMasterVolume()).toBe(0.25);
  });
});

export const MASTER_VOLUME_STORAGE_KEY = 'runner.masterVolume';
export const DEFAULT_MASTER_VOLUME = 0.75;

export function clampMasterVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MASTER_VOLUME;
  return Math.max(0, Math.min(1, value));
}

export function loadStoredMasterVolume(): number {
  try {
    const stored = localStorage.getItem(MASTER_VOLUME_STORAGE_KEY);
    if (stored == null) return DEFAULT_MASTER_VOLUME;
    return clampMasterVolume(Number(stored));
  } catch {
    return DEFAULT_MASTER_VOLUME;
  }
}

export function storeMasterVolume(value: number): void {
  try {
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, String(clampMasterVolume(value)));
  } catch {
    // localStorage may be unavailable in tests
  }
}

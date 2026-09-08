import { describe, expect, it } from 'vitest';
import { keyCodeToAction } from '@input/InputAdapter';

describe('keyCodeToAction', () => {
  it('keeps arrows (and Space) as the primary mapping', () => {
    expect(keyCodeToAction('ArrowLeft')).toBe('laneLeft');
    expect(keyCodeToAction('ArrowRight')).toBe('laneRight');
    expect(keyCodeToAction('ArrowUp')).toBe('nitro');
    expect(keyCodeToAction('ArrowDown')).toBe('fastFall');
    expect(keyCodeToAction('Space')).toBe('nitro');
  });

  it('duplicates the mapping through WASD without changing meaning', () => {
    expect(keyCodeToAction('KeyA')).toBe('laneLeft');
    expect(keyCodeToAction('KeyD')).toBe('laneRight');
    expect(keyCodeToAction('KeyW')).toBe('nitro');
    expect(keyCodeToAction('KeyS')).toBe('fastFall');
  });

  it('ignores unrelated keys', () => {
    expect(keyCodeToAction('KeyR')).toBeNull();
    expect(keyCodeToAction('Escape')).toBeNull();
    expect(keyCodeToAction('Enter')).toBeNull();
  });
});

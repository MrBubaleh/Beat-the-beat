import { describe, expect, it } from 'vitest';
import { TutorialStorage } from '@app/TutorialStorage';

describe('TutorialStorage', () => {
  it('starts as novice on each new instance (page load)', () => {
    expect(new TutorialStorage().load()).toBe('novice');
  });

  it('keeps veteran only for the current page session', () => {
    const storage = new TutorialStorage();
    storage.save('veteran');
    expect(storage.load()).toBe('veteran');
    expect(new TutorialStorage().load()).toBe('novice');
  });

  it('can reset back to novice within the same session', () => {
    const storage = new TutorialStorage();
    storage.save('veteran');
    storage.save('novice');
    expect(storage.load()).toBe('novice');
  });
});

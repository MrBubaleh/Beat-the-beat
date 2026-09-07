import { describe, expect, it } from 'vitest';
import directorRaw from '../../configs/director.default.json';
import { PassthroughDirector } from '@core/director/PassthroughDirector';

describe('PassthroughDirector', () => {
  it('emits default intents and stays in calm phase', () => {
    const director = new PassthroughDirector(directorRaw);
    const output = director.update(1 / 60, 5);
    expect(output.phase).toBe('calm');
    expect(output.intents).toHaveLength(directorRaw.defaultIntents.length);
    expect(output.intents.some((i) => i.target === 'speed' && i.value === 1)).toBe(true);
  });

  it('records intents in memory with an issuedAt timestamp', () => {
    const director = new PassthroughDirector(directorRaw);
    director.update(1 / 60, 10);
    expect(director.memory.intents.length).toBeGreaterThan(0);
    expect(director.memory.intents.every((i) => i.issuedAt === 10)).toBe(true);
  });

  it('filters out unknown intent targets from config', () => {
    const director = new PassthroughDirector({
      ...directorRaw,
      defaultIntents: [
        ...directorRaw.defaultIntents,
        { target: 'notARealTarget', value: 1, priority: 0, tag: 'test' },
      ],
    });
    const output = director.update(1 / 60, 0);
    expect(output.intents.every((i) => (i.target as string) !== 'notARealTarget')).toBe(true);
  });
});

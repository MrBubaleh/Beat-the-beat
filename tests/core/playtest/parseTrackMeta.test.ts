import { describe, expect, it } from 'vitest';
import { parseTrackMeta } from '@core/playtest/parseTrackMeta';

describe('parseTrackMeta', () => {
  it('parses artist and title from hyphenated filename', () => {
    const meta = parseTrackMeta('Daft Punk - Harder Better Faster Stronger.mp4', 240);
    expect(meta.artist).toBe('Daft Punk');
    expect(meta.title).toBe('Harder Better Faster Stronger');
    expect(meta.searchQuery).toBe('Daft Punk Harder Better Faster Stronger');
    expect(meta.durationSeconds).toBe(240);
  });

  it('uses whole basename when separator is missing', () => {
    const meta = parseTrackMeta('slowambienttrack.webm', 180);
    expect(meta.artist).toBe('');
    expect(meta.title).toBe('slowambienttrack');
    expect(meta.searchQuery).toBe('slowambienttrack');
  });

  it('supports en-dash separator', () => {
    const meta = parseTrackMeta('Artist – Song Title.mp3', 200);
    expect(meta.artist).toBe('Artist');
    expect(meta.title).toBe('Song Title');
  });
});

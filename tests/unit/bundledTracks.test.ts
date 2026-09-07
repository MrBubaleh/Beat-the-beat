import { describe, expect, it } from 'vitest';
import {
  MAX_BUNDLED_TRACKS,
  bundledTrackKind,
  bundledTrackTitle,
  parseBundledTrackCatalog,
} from '../../src/app/bundledTracks';

describe('bundled track catalog', () => {
  it('keeps at most five valid media files and derives titles', () => {
    const tracks = Array.from({ length: 7 }, (_, i) => ({
      fileName: `track-${i}.mp4`,
      title: '',
      url: `/video/track-${i}.mp4`,
    }));
    const parsed = parseBundledTrackCatalog({ tracks });
    expect(parsed).toHaveLength(MAX_BUNDLED_TRACKS);
    expect(parsed[0]).toEqual({
      fileName: 'track-0.mp4',
      title: 'track-0',
      url: '/video/track-0.mp4',
      kind: 'video',
    });
    expect(bundledTrackTitle('my_song.wav')).toBe('my_song');
    expect(bundledTrackKind('clip.webm')).toBe('video');
    expect(bundledTrackKind('clip.mp3')).toBe('audio');
    expect(bundledTrackKind('notes.txt')).toBeNull();
  });

  it('rejects path traversal and unknown shapes', () => {
    expect(parseBundledTrackCatalog(null)).toEqual([]);
    expect(
      parseBundledTrackCatalog({
        tracks: [
            { fileName: '../secret.mp4', url: '/video/../secret.mp4' },
          { fileName: 'ok.wav' },
        ],
      }),
    ).toEqual([
      {
        fileName: 'ok.wav',
        title: 'ok',
        url: '/video/ok.wav',
        kind: 'audio',
      },
    ]);
  });
});

import type { TrackMeta } from './types';

const EXT_RE = /\.(mp4|webm|mkv|mov|avi|mp3|wav|m4a|ogg|flac)$/i;
const SPLIT_RE = /\s[-–—_|]\s/;

export function parseTrackMeta(fileName: string, durationSeconds: number): TrackMeta {
  const base = fileName.replace(EXT_RE, '').trim();
  const parts = base.split(SPLIT_RE).map((part) => part.trim()).filter(Boolean);
  let artist = '';
  let title = base;
  if (parts.length >= 2) {
    artist = parts[0];
    title = parts.slice(1).join(' - ');
  }
  const searchQuery = artist ? `${artist} ${title}`.trim() : title;
  return {
    fileName,
    artist,
    title,
    durationSeconds,
    searchQuery,
  };
}

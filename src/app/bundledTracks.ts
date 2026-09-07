export const BUNDLED_TRACKS_CATALOG_URL = '/video/catalog.json';
export const MAX_BUNDLED_TRACKS = 5;

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv', '.ogv']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac']);

export type BundledTrackKind = 'video' | 'audio';

export interface BundledTrack {
  fileName: string;
  title: string;
  url: string;
  kind: BundledTrackKind;
}

export function bundledTrackKind(fileName: string): BundledTrackKind | null {
  const ext = extensionOf(fileName);
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return null;
}

export function bundledTrackTitle(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base.length > 0 ? base : fileName;
}

export function parseBundledTrackCatalog(raw: unknown): BundledTrack[] {
  if (!raw || typeof raw !== 'object') return [];
  const tracks = (raw as { tracks?: unknown }).tracks;
  if (!Array.isArray(tracks)) return [];
  const parsed: BundledTrack[] = [];
  for (const item of tracks) {
    const track = parseTrack(item);
    if (!track) continue;
    parsed.push(track);
    if (parsed.length >= MAX_BUNDLED_TRACKS) break;
  }
  return parsed;
}

export async function fetchBundledTracks(
  url: string = BUNDLED_TRACKS_CATALOG_URL,
): Promise<BundledTrack[]> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return [];
    return parseBundledTrackCatalog(await response.json());
  } catch {
    return [];
  }
}

function parseTrack(raw: unknown): BundledTrack | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const fileName = typeof record.fileName === 'string' ? record.fileName.trim() : '';
  if (!fileName || fileName.includes('/') || fileName.includes('\\')) return null;
  const kind = bundledTrackKind(fileName);
  if (!kind) return null;
  const url =
    typeof record.url === 'string' && record.url.startsWith('/video/')
      ? record.url
      : `/video/${encodeURIComponent(fileName)}`;
  const title =
    typeof record.title === 'string' && record.title.trim().length > 0
      ? record.title.trim()
      : bundledTrackTitle(fileName);
  return { fileName, title, url, kind };
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return '';
  return fileName.slice(dot).toLowerCase();
}

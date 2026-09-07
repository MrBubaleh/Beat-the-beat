import type { PlaytestSessionFile } from '@core/playtest/types';

export function downloadPlaytestSession(session: PlaytestSessionFile): void {
  const blob = new Blob([JSON.stringify(session, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = buildFileName(session);
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildFileName(session: PlaytestSessionFile): string {
  const stamp = session.session.startedAt.slice(0, 10).replace(/-/g, '');
  const base =
    session.track.artist && session.track.title
      ? `${session.track.artist} - ${session.track.title}`
      : session.track.title || session.track.fileName;
  return `${sanitize(base)} - ${stamp}.playtest.json`;
}

function sanitize(value: string): string {
  return value
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

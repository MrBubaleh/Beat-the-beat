import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Connect, Plugin, ResolvedConfig } from 'vite';
import { bundledTrackKind, bundledTrackTitle, MAX_BUNDLED_TRACKS } from './src/app/bundledTracks';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.json': 'application/json',
};

export function videoStaticPlugin(): Plugin {
  let config!: ResolvedConfig;
  const videoDir = (): string => path.resolve(config.root, 'video');

  const ensureDir = async (): Promise<void> => {
    await mkdir(videoDir(), { recursive: true });
  };

  const catalogJson = async (): Promise<string> =>
    JSON.stringify({ tracks: await listBundledVideoFiles(videoDir()) });

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    void serveVideoRequest(req, res, next, videoDir(), catalogJson);
  };

  return {
    name: 'video-static',
    configResolved(resolved) {
      config = resolved;
    },
    async buildStart() {
      await ensureDir();
    },
    configureServer(server) {
      void ensureDir();
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    async writeBundle() {
      await ensureDir();
      const dest = path.resolve(config.root, config.build.outDir, 'video');
      await mkdir(dest, { recursive: true });
      const tracks = await listBundledVideoFiles(videoDir());
      await writeFile(path.join(dest, 'catalog.json'), JSON.stringify({ tracks }));
      await Promise.all(
        tracks.map((track) =>
          cp(path.join(videoDir(), track.fileName), path.join(dest, track.fileName)),
        ),
      );
    },
  };
}

export async function listBundledVideoFiles(
  dir: string,
): Promise<Array<{ fileName: string; title: string; url: string; kind: 'video' | 'audio' }>> {
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  const files: string[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const kind = bundledTrackKind(name);
    if (!kind) continue;
    const full = path.join(dir, name);
    const info = await stat(full);
    if (!info.isFile()) continue;
    files.push(name);
  }
  files.sort((a, b) => a.localeCompare(b, 'en'));
  return files.slice(0, MAX_BUNDLED_TRACKS).map((fileName) => ({
    fileName,
    title: bundledTrackTitle(fileName),
    url: `/video/${encodeURIComponent(fileName)}`,
    kind: bundledTrackKind(fileName)!,
  }));
}

async function serveVideoRequest(
  req: IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
  dir: string,
  catalogJson: () => Promise<string>,
): Promise<void> {
  const pathname = (req.url ?? '').split('?')[0];
  if (pathname === '/video/catalog.json') {
    try {
      const body = await catalogJson();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.statusCode = 500;
      res.end('{"tracks":[]}');
    }
    return;
  }
  if (!pathname.startsWith('/video/')) {
    next();
    return;
  }
  const rel = decodeURIComponent(pathname.slice('/video/'.length));
  const abs = resolveSafe(dir, rel);
  if (!abs) {
    res.statusCode = 404;
    res.end();
    return;
  }
  try {
    const info = statSync(abs);
    if (!info.isFile()) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const mime = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
    sendRange(abs, info.size, mime, req, res);
  } catch {
    res.statusCode = 404;
    res.end();
  }
}

function resolveSafe(root: string, rel: string): string | null {
  if (!rel || rel.includes('\0')) return null;
  const abs = path.resolve(root, rel);
  const relative = path.relative(path.resolve(root), abs);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return abs;
}

function sendRange(
  filePath: string,
  size: number,
  mime: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    createReadStream(filePath).pipe(res);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.statusCode = 416;
    res.end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || end >= size) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    res.end();
    return;
  }
  res.writeHead(206, {
    'Content-Type': mime,
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  });
  createReadStream(filePath, { start, end }).pipe(res);
}

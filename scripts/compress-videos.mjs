#!/usr/bin/env node
import { copyFile, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const videoDir = path.join(root, 'video');
const backupDir = path.join(videoDir, '_originals');
const CRF = process.env.VIDEO_CRF ?? '30';
const AUDIO_KBPS = process.env.VIDEO_AUDIO_KBPS ?? '96';

function runFfmpeg(input, output) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      [
        '-y', '-i', input,
        '-c:v', 'libx264', '-crf', CRF, '-preset', 'slow',
        '-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`,
        '-movflags', '+faststart',
        output,
      ],
      { stdio: 'inherit' },
    );
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });
}

async function main() {
  await mkdir(backupDir, { recursive: true });
  const names = (await readdir(videoDir)).filter((n) => n.toLowerCase().endsWith('.mp4'));
  let beforeTotal = 0;
  let afterTotal = 0;
  for (const name of names.sort()) {
    const src = path.join(videoDir, name);
    const backup = path.join(backupDir, name);
    const tmp = path.join(videoDir, `_tmp_${name}`);
    const info = await stat(src);
    beforeTotal += info.size;
    if (!existsSync(backup)) await copyFile(src, backup);
    await runFfmpeg(backup, tmp);
    const outInfo = await stat(tmp);
    afterTotal += outInfo.size;
    await rename(tmp, src);
    console.log(`${name}: ${(info.size / 1e6).toFixed(1)} → ${(outInfo.size / 1e6).toFixed(1)} MB`);
  }
  console.log(`Total: ${(beforeTotal / 1e6).toFixed(1)} → ${(afterTotal / 1e6).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

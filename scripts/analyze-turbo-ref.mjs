import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || 'sound/turbo-nfs-hot-pursuit-lvl-3.mp3';
const abs = join(root, file);
const raw = readFileSync(abs);
const mime = extname(abs).toLowerCase() === '.wav' ? 'audio/wav' : 'audio/mpeg';
const b64 = raw.toString('base64');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const result = await page.evaluate(async ({ b64, mime }) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const ctx = new OfflineAudioContext(2, 44100, 44100);
  const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
  const sr = buf.sampleRate;
  const n = buf.length;
  const dur = n / sr;
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;

  const bands = [
    ['sub', 20, 80],
    ['bass', 80, 250],
    ['lowMid', 250, 800],
    ['mid', 800, 2500],
    ['highMid', 2500, 6000],
    ['air', 6000, 16000],
  ];

  function goertzelPower(x, i0, i1, freq) {
    const w = 2 * Math.PI * freq / sr;
    const c = 2 * Math.cos(w);
    let s0 = 0, s1 = 0, s2 = 0;
    for (let i = i0; i < i1; i++) {
      s0 = x[i] + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return s1 * s1 + s2 * s2 - c * s1 * s2;
  }

  const hop = Math.round(0.05 * sr);
  const win = Math.round(0.08 * sr);
  const frames = [];
  let peak = 0;
  let acc = 0;
  let corrAcc = 0;
  let sideAcc = 0;
  for (let i = 0; i < n; i++) {
    const aL = Math.abs(L[i]);
    const aR = Math.abs(R[i]);
    peak = Math.max(peak, aL, aR);
    acc += L[i] * L[i] + R[i] * R[i];
    corrAcc += L[i] * R[i];
    const mid = 0.5 * (L[i] + R[i]);
    const side = 0.5 * (L[i] - R[i]);
    sideAcc += side * side;
  }
  for (let t0 = 0; t0 + win < n; t0 += hop) {
    const t1 = t0 + win;
    let eL = 0, eR = 0, zc = 0;
    for (let i = t0; i < t1; i++) {
      eL += L[i] * L[i];
      eR += R[i] * R[i];
      if (i > t0 && ((L[i] >= 0) !== (L[i - 1] >= 0))) zc++;
    }
    const mix = new Float32Array(t1 - t0);
    for (let i = t0; i < t1; i++) mix[i - t0] = 0.5 * (L[i] + R[i]);
    const bandE = {};
    for (const [name, lo, hi] of bands) {
      const f0 = Math.sqrt(lo * hi);
      bandE[name] = goertzelPower(mix, 0, mix.length, f0);
    }
    const centroid =
      (80 * bandE.sub + 160 * bandE.bass + 450 * bandE.lowMid + 1400 * bandE.mid + 3800 * bandE.highMid + 9000 * bandE.air) /
      (bandE.sub + bandE.bass + bandE.lowMid + bandE.mid + bandE.highMid + bandE.air + 1e-12);
    frames.push({
      t: t0 / sr,
      rms: Math.sqrt((eL + eR) / (2 * (t1 - t0))),
      peak: (() => { let p = 0; for (let i = t0; i < t1; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i])); return p; })(),
      zcHz: (zc * sr) / (2 * (t1 - t0)),
      centroid,
      bands: bandE,
    });
  }

  const W = 1200, H = 420;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.fillStyle = '#0b0d12';
  g.fillRect(0, 0, W, H);

  const fftN = 1024;
  const specHop = Math.floor(n / W);
  const magMax = new Float32Array(fftN / 2);
  const spec = [];
  function fftMag(input) {
    const re = new Float32Array(fftN);
    const im = new Float32Array(fftN);
    for (let i = 0; i < fftN; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftN - 1));
      let rev = 0;
      let x = i;
      for (let s = fftN >> 1; s > 0; s >>= 1) {
        rev = (rev << 1) | (x & 1);
        x >>= 1;
      }
      re[rev] = (input[i] || 0) * w;
    }
    for (let len = 2; len <= fftN; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr0 = Math.cos(ang), wi0 = Math.sin(ang);
      for (let i = 0; i < fftN; i += len) {
        let wr = 1, wi = 0;
        for (let j = 0; j < len / 2; j++) {
          const ur = re[i + j], ui = im[i + j];
          const vr = re[i + j + len / 2] * wr - im[i + j + len / 2] * wi;
          const vi = re[i + j + len / 2] * wr + im[i + j + len / 2] * wi;
          re[i + j] = ur + vr; im[i + j] = ui + vi;
          re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
          const nwr = wr * wr0 - wi * wi0;
          wi = wr * wi0 + wi * wr0;
          wr = nwr;
        }
      }
    }
    const mag = new Float32Array(fftN / 2);
    for (let k = 0; k < fftN / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    return mag;
  }

  for (let x = 0; x < W; x++) {
    const i0 = Math.min(n - fftN, x * specHop);
    const slice = new Float32Array(fftN);
    for (let i = 0; i < fftN; i++) slice[i] = 0.5 * (L[i0 + i] + R[i0 + i]);
    const mag = fftMag(slice);
    spec.push(mag);
    for (let k = 0; k < mag.length; k++) magMax[k] = Math.max(magMax[k], mag[k]);
  }

  for (let x = 0; x < W; x++) {
    const mag = spec[x];
    for (let y = 0; y < H; y++) {
      const freqRatio = 1 - y / H;
      const hz = 20 * Math.pow(sr / 2 / 20, freqRatio);
      const k = Math.min(mag.length - 1, Math.round(hz * fftN / sr));
      const db = 20 * Math.log10((mag[k] + 1e-12) / (magMax[k] + 1e-12));
      const tcol = Math.max(0, Math.min(1, (db + 60) / 60));
      const r = Math.floor(20 + 220 * Math.pow(tcol, 0.7));
      const gg = Math.floor(10 + 180 * Math.pow(tcol, 1.4));
      const b = Math.floor(40 + 80 * (1 - tcol) + 40 * tcol);
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  g.fillStyle = '#fff';
  g.font = '12px sans-serif';
  g.fillText(`${dur.toFixed(3)}s  sr=${sr}  peak=${peak.toFixed(3)}  rms=${Math.sqrt(acc / (2 * n)).toFixed(3)}`, 12, 16);

  return {
    duration: dur,
    sampleRate: sr,
    channels: buf.numberOfChannels,
    peak,
    rms: Math.sqrt(acc / (2 * n)),
    correlation: corrAcc / (n * (peak * peak + 1e-12)),
    sideRatio: sideAcc / (acc * 0.25 + 1e-12),
    frames,
    png: canvas.toDataURL('image/png'),
  };
}, { b64, mime });
await browser.close();

const png = Buffer.from(result.png.split(',')[1], 'base64');
const outDir = join(root, '.tmp', 'sfx');
mkdirSync(outDir, { recursive: true });
const tag = basename(abs, extname(abs));
writeFileSync(join(outDir, `${tag}-spec.png`), png);

const slim = {
  duration: result.duration,
  sampleRate: result.sampleRate,
  channels: result.channels,
  peak: result.peak,
  rms: result.rms,
  correlation: result.correlation,
  sideRatio: result.sideRatio,
  envelope: result.frames.map(f => ({
    t: +f.t.toFixed(3),
    rms: +f.rms.toFixed(4),
    peak: +f.peak.toFixed(4),
    zcHz: +f.zcHz.toFixed(1),
    centroid: +f.centroid.toFixed(0),
  })),
};
writeFileSync(join(outDir, `${tag}.json`), JSON.stringify(slim, null, 2));
console.log(JSON.stringify({
  duration: result.duration,
  sampleRate: result.sampleRate,
  channels: result.channels,
  peak: result.peak,
  rms: result.rms,
  corr: result.correlation,
  side: result.sideRatio,
  frames: result.frames.length,
}, null, 2));

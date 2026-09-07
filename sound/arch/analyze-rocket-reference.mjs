import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const input = new URL(process.argv[2] || './turbo-nfs-hot-pursuit-lvl-3.mp3', import.meta.url);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(async (base64) => {
    const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const context = new OfflineAudioContext(2, 1, 44100);
    const decoded = await context.decodeAudioData(raw.buffer);
    const bands = [[25, 120], [120, 450], [450, 1200], [1200, 3000], [3000, 6500], [6500, 14000]];
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c));
    const db = x => 20 * Math.log10(Math.max(1e-10, x));
    const measure = (data, start, end) => {
      let sum = 0, peak = 0;
      const a = Math.round(start * decoded.sampleRate);
      const b = Math.min(data[0].length, Math.round(end * decoded.sampleRate));
      for (const ch of data) for (let i = a; i < b; i++) {
        sum += ch[i] * ch[i]; peak = Math.max(peak, Math.abs(ch[i]));
      }
      return { rmsDb: +db(Math.sqrt(sum / ((b - a) * data.length))).toFixed(2), peak: +peak.toFixed(5) };
    };
    const windows = [];
    for (let a = 0; a < decoded.duration; a += 0.25) {
      windows.push({ start: a, ...measure(channels, a, a + 0.25) });
    }
    const spectrum = [];
    for (const [lo, hi] of bands) {
      const offline = new OfflineAudioContext(2, decoded.length, decoded.sampleRate);
      const source = offline.createBufferSource(); source.buffer = decoded;
      const hp = offline.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = lo; hp.Q.value = Math.SQRT1_2;
      const lp = offline.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = hi; lp.Q.value = Math.SQRT1_2;
      source.connect(hp).connect(lp).connect(offline.destination); source.start();
      const audio = await offline.startRendering();
      const data = [audio.getChannelData(0), audio.getChannelData(1)];
      spectrum.push({ hz: [lo, hi], ...measure(data, 0, decoded.duration), windows: windows.map(w => measure(data, w.start, w.start + 0.25).rmsDb) });
    }
    let lr = 0, ll = 0, rr = 0;
    for (let i = 0; i < decoded.length; i++) {
      const l = channels[0][i], r = channels[channels.length - 1][i];
      lr += l * r; ll += l * l; rr += r * r;
    }
    return { duration: decoded.duration, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels, ...measure(channels, 0, decoded.duration), correlation: lr / Math.sqrt(ll * rr), windows, spectrum };
  }, readFileSync(input).toString('base64'));
  writeFileSync(new URL(process.argv[2] ? './rocket-cinematic-analysis.json' : './rocket-reference-analysis.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, windows: result.windows.filter(w => w.start % 1 === 0), spectrum: result.spectrum.map(b => ({ hz: b.hz, rmsDb: b.rmsDb, cruiseDb: b.windows[28] })) }, null, 2));
} finally {
  await browser.close();
}

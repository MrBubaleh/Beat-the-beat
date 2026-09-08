import { renderComparison, comparisonReport, comparisonWavBuffer, COMPARISON_REFERENCE_GAIN } from './SfxComparison';
import type { Comparison, ComparisonId } from './SfxComparison';
import { sfxConfigSchema } from '@core/sfx/config';
import configRaw from '../../configs/sfx.default.json';
import { SfxDirector } from '@core/sfx/SfxDirector';
import { SFX_IDS } from '@core/sfx/types';
import type { SfxId, SfxFrame, SfxEvent } from '@core/sfx/types';
import { AudioGraph } from '@audio/AudioGraph';
import { SfxEngine } from '@audio/sfx/SfxEngine';
import { SfxScenario, SFX_DEMO_SECONDS } from '@audio/sfx/SfxScenario';
import { renderSfxDemo, renderSfxPatch, encodeWav } from '@audio/sfx/SfxOffline';

if (!import.meta.env.DEV) throw new Error('Audio lab is available only on the development server');
const config = sfxConfigSchema.parse(configRaw);
const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
let ctx: AudioContext | null = null;
let graph: AudioGraph | null = null;
let engine: SfxEngine | null = null;
const director = new SfxDirector(config);
let scenario: SfxScenario | null = null;
let started = 0;
let mode: 'all' | 'car' | 'horse' | 'rocket' = 'all';
let sequence = 0;
let trackUrl = '';
let lastInput: SfxFrame | null = null;
const music = element<HTMLAudioElement>('music');
let comparisonSource: AudioBufferSourceNode | null = null;
let comparisonGain: GainNode | null = null;
let comparisonToken = 0;
let cacheKey = '';
const comparisons = new Map<ComparisonId, Promise<Comparison>>();
function stopComparison() {
  comparisonToken++;
  const source = comparisonSource;
  const amp = comparisonGain;
  comparisonSource = null; comparisonGain = null;
  if (source && amp && ctx) {
    source.onended = () => { source.disconnect(); amp.disconnect(); };
    amp.gain.cancelAndHoldAtTime(ctx.currentTime);
    amp.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.012);
    source.stop(ctx.currentTime + 0.02);
  }
}
async function pairFor(id: ComparisonId) {
  const key = JSON.stringify(config);
  if (key !== cacheKey) { comparisons.clear(); cacheKey = key; }
  let pending = comparisons.get(id);
  if (!pending) {
    pending = renderComparison(structuredClone(config), id);
    comparisons.set(id, pending);
    pending.catch(() => { if (comparisons.get(id) === pending) comparisons.delete(id); });
  }
  return pending;
}
async function compare(id: ComparisonId, version: 'before' | 'after') {
  stop();
  const ticket = comparisonToken;
  await ensure();
  if (ticket !== comparisonToken || document.hidden) return;
  if (!config.enabled) { element('compareStatus').textContent = 'Включите игровые звуки для прослушивания.'; return; }
  element('compareStatus').textContent = 'Готовлю обе версии…';
  try {
    const pair = await pairFor(id);
    if (ticket !== comparisonToken) return;
    const matched = element<HTMLInputElement>('matchLevel').checked;
    const source = ctx!.createBufferSource(); source.buffer = pair[version].buffer;
    const amp = ctx!.createGain(); amp.gain.value = (matched ? pair.gains[version === 'before' ? 0 : 1] : 1) * config.masterGain / COMPARISON_REFERENCE_GAIN;
    source.connect(amp); amp.connect(graph!.sfxBus);
    comparisonSource = source; comparisonGain = amp;
    source.onended = () => {
      source.disconnect(); amp.disconnect();
      if (comparisonSource === source) { comparisonSource = null; comparisonGain = null; }
    };
    source.start();
    element('compareStatus').textContent = (version === 'before' ? 'A · Прежний' : 'B · Новый') +
      (matched ? ' — уровень выровнен. Сравните характер, фактуру и развитие.' : ' — исходный игровой баланс.');
    element('measurements').textContent = JSON.stringify(comparisonReport(pair), null, 2);
  } catch (error) { if (ticket === comparisonToken) element('compareStatus').textContent = String(error); }
}
function downloadWav(buffer: AudioBuffer, name: string) {
  const url = URL.createObjectURL(new Blob([encodeWav(buffer)], { type: 'audio/wav' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function downloadComparison(id: ComparisonId) {
  await ensure();
  const pair = await pairFor(id);
  downloadWav(comparisonWavBuffer(ctx!, pair, element<HTMLInputElement>('matchLevel').checked, config.masterGain / COMPARISON_REFERENCE_GAIN), 'sfx-' + id + '-A-B.wav');
}

async function ensure() {
  if (!ctx) {
    ctx = new AudioContext();
    graph = new AudioGraph(ctx);
    graph.setMusicVolume(0.8);
    ctx.createMediaElementSource(music).connect(graph.musicBus);
    engine = new SfxEngine(ctx, graph.sfxBus, config, graph.rocketSampleBus);
  }
  await ctx.resume();
}
function stop() {
  stopComparison();
  scenario = null; director.reset(); engine?.silence();
  element('status').textContent = 'SFX остановлены';
}
async function play(selected: typeof mode = 'all') {
  await ensure(); stop();
  mode = selected; scenario = new SfxScenario(); started = ctx!.currentTime;
  element('status').textContent = selected === 'all' ? 'Машина → нитро → конь → ракета → завершение' : 'Профиль: ' + selected;
}
async function patch(id: SfxId) {
  await ensure();
  stopComparison();
  if (scenario) { scenario.trigger(id); return; }
  if (!lastInput) lastInput = new SfxScenario().step(0).frame;
  const state = { ...lastInput.state, gameOver: id === 'gameOver' };
  const input: SfxFrame = { state, phase: id === 'gameOver' ? 'gameOver' : 'running', tutorialScale: 1 };
  const event: SfxEvent = { id, run: 90, sequence: ++sequence, gameTime: state.gameTime,
    mode: id === 'hoof' ? 'horse' : state.mode, speed: state.speed, pan: 0, strength: 0.75, count: 1 };
  if (!scenario) director.reset();
  engine!.apply(director.tick([event], input, ctx!.currentTime).filter(c => c.type !== 'beds'));
}
const labels: Record<SfxId, string> = {
  hit:'Удар',canister:'Баллон нитро',smash:'Разрушение',coin:'Монета',
  nitroReady:'Нитро готово',nitroStart:'Нитро: запуск',nitroEnd:'Нитро: выход',nitroDry:'Нитро: пустой чих',
  rocketPrepare:'Ракета: подготовка',rocketLaunch:'Ракета: взлёт',rocketEnd:'Ракета: спад',
  jump:'Прыжок',land:'Приземление',slideStart:'Подкат: вход',slideEnd:'Подкат: выход',
  lane:'Перестроение',nearMiss:'Близкий проход',combo:'Достижение комбо',mode:'Смена режима',
  gameOver:'Завершение',hoof:'Копыто',fullRepair:'Полное восстановление',
};
for (const id of SFX_IDS) {
  if (['rocketPrepare', 'rocketLaunch', 'rocketEnd'].includes(id)) continue;
  const button = document.createElement('button'); button.textContent = labels[id];
  button.dataset.reworked = String(['hit','canister','smash','coin','hoof'].includes(id));
  button.dataset.patch = id; button.onclick = () => { void patch(id); };
  element('patches').appendChild(button);
}
for (const [id, label] of [['car','Машина'],['horse','Конь'],['rocket','Ракета']] as const) {
  const button = document.createElement('button'); button.textContent = label;
  button.onclick = () => { void play(id); }; element('modes').appendChild(button);
}
const selectedComparison = () => element<HTMLSelectElement>('compareSound').value as ComparisonId;
element('compareBefore').onclick = () => { void compare(selectedComparison(), 'before'); };
element('compareAfter').onclick = () => { void compare(selectedComparison(), 'after'); };
element('compareDownload').onclick = () => {
  void downloadComparison(selectedComparison()).catch(error => { element('compareStatus').textContent = String(error); });
};
element('compareSound').onchange = stopComparison;
element('matchLevel').onchange = stopComparison;
element('demo').onclick = () => { void play(); };
element('stop').onclick = stop;
element<HTMLInputElement>('volume').oninput = e => {
  stopComparison();
  config.masterGain = Number((e.target as HTMLInputElement).value);
  engine?.configure(config); director.configure(config);
};
element<HTMLInputElement>('enabled').onchange = e => {
  stopComparison();
  config.enabled = (e.target as HTMLInputElement).checked;
  engine?.configure(config); director.configure(config);
};
element<HTMLInputElement>('musicVolume').oninput = e => graph?.setMusicVolume(Number((e.target as HTMLInputElement).value));
element<HTMLInputElement>('track').onchange = async e => {
  const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
  await ensure(); music.pause();
  if (trackUrl) URL.revokeObjectURL(trackUrl);
  trackUrl = URL.createObjectURL(file); music.src = trackUrl;
};
element<HTMLButtonElement>('render').onclick = async () => {
  const button = element<HTMLButtonElement>('render'); button.disabled = true;
  element('status').textContent = 'Офлайн-рендер синтеза…';
  try {
    const result = await renderSfxDemo(config);
    element('measurements').textContent = JSON.stringify({ signal: result.metrics, resources: result.diagnostics }, null, 2);
    const url = URL.createObjectURL(new Blob([encodeWav(result.buffer)], { type: 'audio/wav' }));
    const link = document.createElement('a'); link.href = url; link.download = 'runner-sfx-demo.wav'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    element('status').textContent = 'Демо готово. WAV содержит игровые звуки без музыкального трека.';
  } catch (error) { element('status').textContent = String(error); }
  finally { button.disabled = false; }
};
let lastDiagnostics = 0;
function update() {
  const now = ctx?.currentTime ?? 0;
  if (scenario && ctx && engine) {
    const elapsed = now - started;
    const offset = mode === 'horse' ? 8 : mode === 'rocket' ? 14 : 0;
    const duration = mode === 'all' ? SFX_DEMO_SECONDS : mode === 'car' ? 8 : 6;
    const input = scenario.step(offset + elapsed);
    lastInput = input.frame;
    engine.apply(director.tick(input.events, input.frame, now));
    if (elapsed >= duration) stop();
  }
  if (now - lastDiagnostics > 0.2) {
    element('diagnostics').textContent = JSON.stringify({ director: director.diagnostics, engine: engine?.diagnostics }, null, 2);
    lastDiagnostics = now;
  }
  requestAnimationFrame(update);
}
requestAnimationFrame(update);
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
window.addEventListener('pagehide', () => { stop(); engine?.dispose(); graph?.dispose(); void ctx?.close(); });
Object.assign(window, { sfxLab: {
  play, stop, patch, compare, downloadComparison,
  renderComparison: async (id: ComparisonId) => comparisonReport(await pairFor(id)),
  diagnostics: () => ({ director: director.diagnostics, engine: engine?.diagnostics, comparisonPlaying: comparisonSource !== null }),
  renderPatch: async (id: SfxId) => {
    const r = await renderSfxPatch(config, id); return { metrics: r.metrics, diagnostics: r.diagnostics };
  },
  renderDemo: async () => {
    const r = await renderSfxDemo(config); return { metrics: r.metrics, diagnostics: r.diagnostics };
  },
} });

import type { SfxConfig } from '@core/sfx/config';
import type { SfxCommand } from '@core/sfx/types';

type RocketCommand = Extract<SfxCommand, { type: 'rocket' }>;
const url = new URL('../../../sound/TURBO BOOST sound effect.mp3', import.meta.url).href;
let bytes: Promise<ArrayBuffer> | null = null;

export class RocketSample {
  readonly ready: Promise<void>;
  private buffer: AudioBuffer | null = null;
  private voice: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private pending: RocketCommand | null = null;
  private fading = false;
  private completed = false;
  private disposed = false;
  error = '';

  constructor(private ctx: BaseAudioContext, private destination: AudioNode, private config: SfxConfig['rocketSample']) {
    bytes ??= fetch(url).then(r => { if (!r.ok) throw new Error('Rocket turbo: HTTP ' + r.status); return r.arrayBuffer(); });
    this.ready = bytes.then(data => ctx.decodeAudioData(data.slice(0))).then(buffer => {
      if (this.disposed) return;
      this.buffer = buffer;
      if (this.pending) this.update(this.pending, ctx.currentTime);
    }).catch(error => { this.error = String(error); });
  }

  get nodes(): number { return this.voice ? 2 : 0; }
  configure(config: SfxConfig['rocketSample']): void { this.config = config; }

  update(command: RocketCommand, at: number): void {
    if (this.disposed) return;
    const previous = this.pending;
    this.pending = command;
    if (command.phase === 'off') {
      if (previous?.phase !== 'off') {
        if (this.voice) {
          if (!this.fading) {
            this.fadeOut(at, this.config.fadeOutMs / 1000);
          }
        } else {
          this.pending = command;
        }
      }
      return;
    }
    if (command.phase === 'fall') {
      if (!this.fading) this.fadeOut(at, this.config.fadeOutMs / 1000);
      return;
    }
    if (!this.buffer || this.completed) return;
    if (this.voice && !this.fading) {
      this.voice.gain.gain.setValueAtTime(this.config.gain, at);
      return;
    }
    this.destroy();
    if (command.offset >= this.buffer.duration) { this.completed = true; return; }
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    const gain = this.ctx.createGain();
    const peak = Math.max(this.config.gain, 0.0002);
    gain.gain.setValueAtTime(peak, at);
    source.connect(gain);
    gain.connect(this.destination);
    this.voice = { source, gain };
    this.fading = false;
    source.onended = () => {
      if (this.voice?.source !== source) return;
      this.completed = !this.fading;
      source.disconnect();
      gain.disconnect();
      this.voice = null;
    };
    source.start(at, Math.max(0, command.offset));
  }

  silence(at: number): void {
    this.pending = null;
    this.completed = false;
    this.fadeOut(at, 0.02);
  }

  private fadeOut(at: number, duration: number): void {
    this.fading = true;
    if (!this.voice) return;
    const voice = this.voice;
    const tail = Math.max(duration, 0.02);
    voice.gain.gain.cancelAndHoldAtTime(at);
    const current = Math.max(voice.gain.gain.value, 0.0001);
    voice.gain.gain.setValueAtTime(current, at);
    if (tail <= 0.05) {
      voice.gain.gain.linearRampToValueAtTime(0, at + tail);
    } else {
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, at + tail);
    }
    voice.source.stop(at + tail + 0.04);
  }

  private destroy(): void {
    if (!this.voice) return;
    this.voice.source.onended = null;
    this.voice.source.stop();
    this.voice.source.disconnect();
    this.voice.gain.disconnect();
    this.voice = null;
  }

  dispose(): void { this.disposed = true; this.pending = null; this.destroy(); }
}

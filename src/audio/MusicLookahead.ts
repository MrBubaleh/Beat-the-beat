import { fallbackForecast, type MusicCue, type MusicForecast, type MusicPlanningConfig } from '@core/gameplay/musicPlanning';

export class MusicLookahead {
  private cues: MusicCue[] = [];
  private energy: { time: number; value: number }[] = [];
  private initialEnergy: { time: number; value: number }[] = [];
  private until = 0;
  private initialCues: MusicCue[] = [];
  private initialUntil = 0;
  private serial = 0;
  private worker: Worker | null = null;
  private generation = 0;
  private buffer: AudioBuffer | null = null;
  private cursor = 0;
  private working = false;
  private finish: (() => void) | null = null;
  status = 'fallback';

  constructor(private config: MusicPlanningConfig) {}

  async prepare(ctx: AudioContext, data: () => Promise<ArrayBuffer>, duration: number, progress: (message: string) => void): Promise<void> {
    this.dispose();
    const generation = this.generation;
    if (!this.config.enabled || duration > this.config.maxDecodedSeconds) return;
    progress('Анализируем ритм — готовим музыку и трассу…');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>(resolve => {
      timer = setTimeout(() => {
        if (generation === this.generation) { this.dispose(); this.status = 'fallback: timeout'; }
        resolve();
      }, this.config.preparationSeconds * 1000);
    });
    const prepare = async () => {
      try {
        const bytes = await data();
        if (generation !== this.generation) return;
        if (bytes.byteLength > this.config.maxFileMB * 1024 * 1024) throw new Error('file budget');
        const buffer = await ctx.decodeAudioData(bytes);
        if (generation !== this.generation) return;
        if (buffer.duration > this.config.maxDecodedSeconds) throw new Error('duration budget');
        this.buffer = buffer;
        this.worker = new Worker(new URL('./rhythm.worker.ts', import.meta.url), { type: 'module' });
        await new Promise<void>(resolve => {
          this.finish = resolve;
          this.worker!.onmessage = (event: MessageEvent<{ cues: MusicCue[]; until: number; serial: number; energy: { time: number; value: number }[] }>) => {
            if (generation !== this.generation) return;
            if (event.data.serial !== this.serial) return;
            const known = new Set(this.cues.map(cue => cue.id));
            this.cues.push(...event.data.cues.filter(cue => !known.has(cue.id) && cue.time >= this.until));
            this.cues.sort((a, b) => a.time - b.time);
            this.energy.push(...event.data.energy.filter(frame => frame.time >= this.until));
            this.until = event.data.until;
            if (!this.initialUntil) { this.initialUntil = this.until; this.initialCues = [...this.cues]; this.initialEnergy = [...this.energy]; }
            this.working = false;
            this.status = 'decoded';
            this.finish?.();
            this.finish = null;
            progress('Ритм готов — заводим двигатель');
          };
          this.worker!.onerror = () => { this.dispose(); this.status = 'fallback: worker'; };
          this.advance(0);
        });
      } catch {
        if (generation === this.generation) { this.dispose(); this.status = 'fallback: decode'; }
      }
    };
    await Promise.race([prepare(), deadline]);
    clearTimeout(timer);
    if (this.status.startsWith('fallback')) progress('Трек готов — запускаем обычный ритм');
  }

  forecast(now: number, rate: number): MusicForecast {
    this.cues = this.cues.filter(cue => cue.time >= now - 2);
    this.energy = this.energy.filter(frame => frame.time >= now - 2);
    this.advance(now);
    if (this.until < now + 5 || this.cues.filter(c => c.time > now && c.time < now + 8).length < 3) {
      return fallbackForecast(now, this.config.lookaheadSeconds, this.config.fallbackBpm, rate);
    }
    return { now, availableUntil: this.until, source: 'decoded', rate,
      energy: this.energy.filter(frame => frame.time >= now - 0.5 && frame.time <= now + this.config.lookaheadSeconds),
      cues: this.cues.filter(cue => cue.time >= now - 0.12 && cue.time <= now + this.config.lookaheadSeconds) };
  }

  private advance(now: number): void {
    if (!this.buffer || !this.worker || this.working || this.cursor >= this.buffer.duration || this.until > now + this.config.lookaheadSeconds) return;
    const offset = Math.max(0, this.cursor - 4);
    const until = Math.min(this.buffer.duration, this.cursor + this.config.lookaheadSeconds);
    const sampleRate = 12000;
    const samples = new Float32Array(Math.ceil((until - offset) * sampleRate));
    const channel = this.buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = channel[Math.min(channel.length - 1, Math.floor((offset + i / sampleRate) * this.buffer.sampleRate))];
    this.working = true;
    this.cursor = until;
    this.worker.postMessage({ samples, sampleRate, offset, until, serial: this.serial }, [samples.buffer]);
  }

  restart(): void {
    this.serial++;
    this.working = false;
    this.cursor = this.initialUntil;
    this.until = this.initialUntil;
    this.cues = [...this.initialCues];
    this.energy = [...this.initialEnergy];
    this.advance(0);
  }

  dispose(): void {
    this.generation++;
    this.initialCues = [];
    this.energy = [];
    this.initialEnergy = [];
    this.initialUntil = 0;
    this.worker?.terminate();
    this.worker = null;
    this.buffer = null;
    this.cues = [];
    this.until = 0;
    this.cursor = 0;
    this.working = false;
    this.finish?.();
    this.finish = null;
    this.status = 'fallback';
  }
}

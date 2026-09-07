const bytesCache = new Map<string, Promise<ArrayBuffer>>();
const bufferCache = new Map<string, Promise<AudioBuffer>>();

function loadBuffer(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  let buffer = bufferCache.get(url);
  if (!buffer) {
    let bytes = bytesCache.get(url);
    if (!bytes) {
      bytes = fetch(url).then((response) => {
        if (!response.ok) throw new Error(`MP3 load failed: ${response.status} ${url}`);
        return response.arrayBuffer();
      });
      bytesCache.set(url, bytes);
    }
    buffer = bytes.then((data) => ctx.decodeAudioData(data.slice(0)));
    bufferCache.set(url, buffer);
  }
  return buffer;
}

export class Mp3OneShot {
  readonly ready: Promise<void>;
  private buffer: AudioBuffer | null = null;
  private pendingAt: number | null = null;
  private disposed = false;
  error = '';

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly destination: AudioNode,
    url: string,
    private gain = 1,
  ) {
    this.ready = loadBuffer(ctx, url)
      .then((buffer) => {
        if (this.disposed) return;
        this.buffer = buffer;
        if (this.pendingAt !== null) {
          this.playNow(this.pendingAt);
          this.pendingAt = null;
        }
      })
      .catch((error) => {
        this.error = String(error);
      });
  }

  setGain(value: number): void {
    this.gain = value;
  }

  play(at: number): void {
    if (this.disposed) return;
    if (!this.buffer) {
      this.pendingAt = at;
      return;
    }
    this.playNow(at);
  }

  private playNow(at: number): void {
    if (!this.buffer || this.disposed) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(Math.max(this.gain, 0.0001), at);
    source.connect(amp);
    amp.connect(this.destination);
    source.start(at);
    source.onended = () => {
      source.disconnect();
      amp.disconnect();
    };
  }

  dispose(): void {
    this.disposed = true;
    this.pendingAt = null;
  }
}

import type { IAudioSource } from './types';

export class VideoFileAudioSource implements IAudioSource {
  private readonly video: HTMLVideoElement;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private objectUrl: string | null = null;
  private loaded = false;
  private previewVisible = true;

  constructor() {
    this.video = document.createElement('video');
    this.video.style.cssText =
      'position:fixed;top:64px;left:16px;width:180px;z-index:6;display:none;' +
      'background:#000;border-radius:6px;pointer-events:none;';
    this.video.playsInline = true;
    document.body.appendChild(this.video);
  }

  getVideoElement(): HTMLVideoElement {
    return this.video;
  }

  setPlaybackRate(rate: number): void {
    this.video.preservesPitch = true;
    this.video.playbackRate = rate;
  }

  setPreviewVisible(visible: boolean): void {
    this.previewVisible = visible;
    this.syncPreviewDisplay();
  }

  private syncPreviewDisplay(): void {
    this.video.style.display = this.loaded && this.previewVisible ? 'block' : 'none';
  }

  async load(file: File): Promise<void> {
    this.revokeObjectUrl();
    this.objectUrl = URL.createObjectURL(file);
    await this.loadSrc(this.objectUrl, file.name);
  }

  async loadUrl(url: string, fileName: string): Promise<void> {
    this.revokeObjectUrl();
    await this.loadSrc(url, fileName);
  }

  private revokeObjectUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  private async loadSrc(src: string, fileName: string): Promise<void> {
    this.video.src = src;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error(`Не удалось открыть файл: ${fileName}`)); }, 15000);
      const onMeta = (): void => {
        cleanup();
        resolve();
      };
      const onError = (): void => {
        cleanup();
        reject(new Error(`не удалось загрузить '${fileName}'`));
      };
      const cleanup = (): void => {
        clearTimeout(timeout);
        this.video.removeEventListener('loadedmetadata', onMeta);
        this.video.removeEventListener('error', onError);
      };
      this.video.addEventListener('loadedmetadata', onMeta);
      this.video.addEventListener('error', onError);
    });
    this.loaded = true;
    this.syncPreviewDisplay();
  }

  get currentTime(): number {
    return Number.isFinite(this.video.currentTime) ? this.video.currentTime : 0;
  }

  get duration(): number {
    return Number.isFinite(this.video.duration) ? this.video.duration : 0;
  }

  get ended(): boolean {
    return this.video.ended;
  }

  connect(ctx: AudioContext): AudioNode {
    if (!this.sourceNode) {
      this.sourceNode = ctx.createMediaElementSource(this.video);
    }
    return this.sourceNode;
  }

  async play(): Promise<void> {
    await this.video.play();
  }

  rewind(): void {
    this.video.pause();
    this.video.currentTime = 0;
  }

  async restart(): Promise<void> {
    this.rewind();
    await this.video.play();
  }

  pause(): void {
    this.video.pause();
  }

  dispose(): void {
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.revokeObjectUrl();
    this.loaded = false;
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    this.video.remove();
  }
}

import type { MusicState } from '@core/state/MusicState';

interface TimelineSample {
  t: number;
  v: number;
}

interface TimelineMarker {
  t: number;
  kind: 'beat' | 'silenceStart' | 'silenceEnd' | 'phase';
  label?: string;
}

export class EventTimeline {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx2d: CanvasRenderingContext2D;
  private readonly root: HTMLDivElement;
  private now = 0;
  private readonly energy: TimelineSample[] = [];
  private readonly markers: TimelineMarker[] = [];
  private prevBeat = false;
  private prevSilence = false;
  private prevPhase: string | null = null;
  private visible = false;
  private readonly maxSamples = 2000;
  private readonly maxMarkers = 500;

  constructor(
    container: HTMLElement,
    private readonly zoomSeconds: number,
  ) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;left:8px;right:8px;bottom:8px;height:96px;z-index:25;display:none;' +
      'background:rgba(0,0,0,.5);border-radius:6px;';
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width:100%;height:100%;display:block;';
    this.root.appendChild(this.canvas);
    container.appendChild(this.root);
    this.ctx2d = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT') {
        this.visible = !this.visible;
        this.root.style.display = this.visible ? 'block' : 'none';
      }
    });
  }

  update(dt: number, music: MusicState, phase: string): void {
    this.now += dt;
    this.energy.push({ t: this.now, v: numValue(music.energy.value) });
    if (this.energy.length > this.maxSamples) this.energy.shift();

    const beat = music.beat.value === true;
    if (beat && !this.prevBeat) this.markers.push({ t: this.now, kind: 'beat' });
    this.prevBeat = beat;

    const silence = music.silence.value === true;
    if (silence && !this.prevSilence) this.markers.push({ t: this.now, kind: 'silenceStart' });
    else if (!silence && this.prevSilence) this.markers.push({ t: this.now, kind: 'silenceEnd' });
    this.prevSilence = silence;

    if (phase !== this.prevPhase) {
      this.markers.push({ t: this.now, kind: 'phase', label: phase });
      this.prevPhase = phase;
    }
    while (this.markers.length > this.maxMarkers) this.markers.shift();

    this.draw();
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.root.remove();
  }

  private readonly resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  private draw(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const c = this.ctx2d;
    c.clearRect(0, 0, w, h);
    const start = this.now - this.zoomSeconds;
    const x = (t: number): number => w * (1 - (this.now - t) / this.zoomSeconds);

    c.beginPath();
    c.strokeStyle = '#7bd';
    let started = false;
    for (const s of this.energy) {
      if (s.t < start) continue;
      const px = x(s.t);
      const py = h - s.v * (h - 8);
      if (!started) {
        c.moveTo(px, py);
        started = true;
      } else {
        c.lineTo(px, py);
      }
    }
    c.stroke();

    for (const m of this.markers) {
      if (m.t < start) continue;
      const px = x(m.t);
      if (m.kind === 'beat') {
        c.fillStyle = '#ff6';
        c.fillRect(px - 1, 0, 2, 8);
      } else if (m.kind === 'silenceStart' || m.kind === 'silenceEnd') {
        c.fillStyle = m.kind === 'silenceStart' ? 'rgba(120,120,160,.35)' : 'rgba(120,120,160,.6)';
        c.fillRect(px, 0, 1, h);
      } else if (m.kind === 'phase') {
        c.fillStyle = '#fa7';
        c.fillRect(px - 1, h - 10, 2, 10);
        if (m.label) {
          c.font = '10px monospace';
          c.fillText(m.label, px + 3, h - 3);
        }
      }
    }
  }
}

function numValue(v: number | boolean): number {
  return typeof v === 'number' ? v : v ? 1 : 0;
}

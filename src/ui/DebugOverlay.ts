import type { MusicState } from '@core/state/MusicState';
import type { FxSwitches } from '@app/fxSwitches';

export interface OverlayOptions {
  showFps: boolean;
  showStates: boolean;
  showIntents: boolean;
}

export interface OverlayInfo {
  fps: number;
  frameMs: number;
  draws: number;
  objects: number;
  seed: number;
  latencyOffset: number;
  music: MusicState;
  speed: number;
  distance: number;
  lane: number;
  mode: string;
  phase: string;
  vfx: number;
  intents: string;
  replay: string;
  wound: string;
  combo: string;
  pulse: number;
  strongPulse: number;
  turbo: number;
  nitro: number;
  fx: string;
  musicPattern: string;
  musicScene: string;
  requestedDensity: number;
  effectiveDensity: number;
  coinFrequency: number;
}

const FX_KEYS: (keyof FxSwitches)[] = [
  'fog',
  'sky',
  'vignette',
  'fov',
  'blur',
  'shake',
  'wind',
  'pulse',
];

export class DebugOverlay {
  private readonly root: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private readonly switches: FxSwitches;
  private visible = false;
  private readonly opts: OverlayOptions;

  constructor(container: HTMLElement, opts: OverlayOptions, switches: FxSwitches) {
    this.opts = opts;
    this.switches = switches;
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;top:50px;left:16px;z-index:30;font:12px/1.5 monospace;color:#9df;' +
      'background:rgba(0,0,0,.55);padding:8px 12px;border-radius:6px;display:none;';
    container.appendChild(this.root);

    this.textEl = document.createElement('div');
    this.textEl.style.cssText = 'white-space:pre;';
    this.root.appendChild(this.textEl);

    this.buildFxPanel();

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'block' : 'none';
  }

  update(info: OverlayInfo): void {
    if (!this.visible) return;
    const lines: string[] = [];

    if (this.opts.showFps) {
      lines.push(
        `fps ${info.fps.toFixed(0)}  frame ${info.frameMs.toFixed(1)} ms  ` +
          `draws ${info.draws}  obj ${info.objects}`,
      );
    }

    if (this.opts.showStates) {
      const m = info.music;
      lines.push(`seed ${info.seed}  latency ${(info.latencyOffset * 1000).toFixed(0)} ms`);
      lines.push(`speed ${info.speed.toFixed(1)}  dist ${info.distance.toFixed(0)}  lane ${info.lane}  mode ${info.mode}`);
      lines.push(
        `phase ${info.phase}  vfx ${info.vfx.toFixed(2)}  pulse ${info.pulse.toFixed(2)}` +
          `  strong ${info.strongPulse.toFixed(2)}  turbo ${info.turbo.toFixed(2)}` +
          `  nitro ${info.nitro.toFixed(0)}%` +
          `  wound ${info.wound}  combo ${info.combo}  replay ${info.replay}`,
      );
      lines.push(`fx  ${info.fx}`);
      lines.push(
        `music pattern ${info.musicPattern}  density ${info.requestedDensity.toFixed(2)}` +
          `→${info.effectiveDensity.toFixed(2)}  coins x${info.coinFrequency.toFixed(2)}`,
      );
      lines.push(`scene ${info.musicScene}`);
      lines.push(
        `energy ${num(m.energy.value)}  beat ${bool(m.beat.value)}  ` +
          `bright ${num(m.brightness.value)}  silence ${bool(m.silence.value)}  ` +
          `audioTime ${m.audioTime.toFixed(2)}s`,
      );
    }

    if (this.opts.showIntents) {
      lines.push(`intents ${info.intents}`);
    }

    this.textEl.textContent = lines.join('\n');
  }

  dispose(): void {
    this.root.remove();
  }

  private buildFxPanel(): void {
    const panel = document.createElement('div');
    panel.style.cssText =
      'margin-top:6px;border-top:1px solid rgba(153,221,255,.25);padding-top:4px;';
    const caption = document.createElement('div');
    caption.textContent = 'VFX toggles (uncheck to isolate)';
    caption.style.cssText = 'opacity:.7;margin-bottom:2px;';
    panel.appendChild(caption);
    for (const key of FX_KEYS) {
      panel.appendChild(this.makeCheck(key));
    }
    this.root.appendChild(panel);
  }

  private makeCheck(key: keyof FxSwitches): HTMLLabelElement {
    const label = document.createElement('label');
    label.style.cssText = 'display:flex;gap:6px;align-items:center;cursor:pointer;';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.switches[key];
    input.addEventListener('change', () => {
      this.switches[key] = input.checked;
    });
    label.appendChild(input);
    label.appendChild(document.createTextNode(key));
    return label;
  }
}

function num(value: number | boolean): string {
  return typeof value === 'number' ? value.toFixed(2) : String(value);
}

function bool(value: number | boolean): string {
  return value === true ? 'yes' : value === false ? 'no' : String(value);
}

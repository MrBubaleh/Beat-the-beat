import type { BundledTrack } from '@app/bundledTracks';
import { VolumeSlider } from './VolumeSlider';

export interface MainMenuOptions {
  volume: number;
  onVolumeChange: (value: number) => void;
  onSelectTrack: (track: BundledTrack) => void;
  onPickFile: () => void;
}

export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly volume: VolumeSlider;
  private readonly opts: MainMenuOptions;
  private busy = false;

  constructor(container: HTMLElement, opts: MainMenuOptions) {
    this.opts = opts;
    this.root = document.createElement('div');
    this.root.className = 'menu-root';
    container.appendChild(this.root);

    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    this.root.appendChild(panel);

    const title = document.createElement('h1');
    title.className = 'menu-title';
    title.textContent = 'меню';
    panel.appendChild(title);

    this.listEl = document.createElement('div');
    this.listEl.className = 'menu-tracks';
    panel.appendChild(this.listEl);

    const hints = document.createElement('div');
    hints.className = 'menu-hints';
    const hintsDesktop = document.createElement('div');
    hintsDesktop.className = 'menu-hints-desktop';
    hintsDesktop.textContent = '← → — полосы · ↑ — нитро · ↓ — подкат · WASD — тоже работает';
    const hintsTouch = document.createElement('div');
    hintsTouch.className = 'menu-hints-touch';
    hintsTouch.textContent = 'свайпы: ← → — полосы · ↑ — нитро · ↓ — подкат';
    hints.append(hintsDesktop, hintsTouch);
    panel.appendChild(hints);

    const footer = document.createElement('div');
    footer.className = 'menu-footer';
    this.volume = new VolumeSlider({
      value: opts.volume,
      onChange: (value) => opts.onVolumeChange(value),
    });
    footer.appendChild(this.volume.root);
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'menu-status';
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'polite');
    footer.appendChild(this.statusEl);
    panel.appendChild(footer);
    this.setTracks([]);
  }

  setTracks(tracks: readonly BundledTrack[]): void {
    this.listEl.replaceChildren();
    for (const track of tracks) {
      this.listEl.appendChild(this.makeTrackCard(track));
    }
    this.listEl.appendChild(this.makeFileButton());
  }

  setVolume(value: number): void {
    this.volume.setValue(value);
  }

  setBusy(busy: boolean, message = ''): void {
    this.busy = busy;
    this.root.classList.toggle('is-preparing', busy);
    this.statusEl.textContent = message;
    this.statusEl.classList.toggle('is-error', false);
    this.syncBusyState();
  }

  setError(message: string): void {
    this.busy = false;
    this.statusEl.textContent = message;
    this.statusEl.classList.toggle('is-error', true);
    this.root.classList.remove('is-preparing');
    this.syncBusyState();
  }

  show(): void {
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.busy = false;
    this.statusEl.textContent = '';
    this.statusEl.classList.remove('is-error');
    this.syncBusyState();
    this.root.classList.remove('is-preparing');
    this.root.style.display = 'none';
  }

  get isOpen(): boolean {
    return this.root.style.display !== 'none';
  }

  private syncBusyState(): void {
    for (const button of this.listEl.querySelectorAll('button')) {
      button.classList.toggle('is-busy', this.busy);
    }
  }

  private makeTrackCard(track: BundledTrack): HTMLButtonElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'menu-card';
    const preview = document.createElement('div');
    preview.className = 'menu-preview';
    if (track.kind === 'video') {
      const video = document.createElement('video');
      video.src = track.url;
      video.preload = 'metadata';
      video.playsInline = true;
      video.volume = 0;
      video.addEventListener('loadeddata', () => {
        if (video.readyState >= 2 && video.currentTime < 0.05) {
          video.currentTime = Math.min(1, Math.max(0.1, video.duration * 0.08 || 0.1));
        }
      });
      card.addEventListener('pointerenter', () => {
        void video.play().catch(() => undefined);
      });
      card.addEventListener('pointerleave', () => {
        video.pause();
      });
      preview.appendChild(video);
    } else {
      preview.textContent = 'аудио';
    }
    const name = document.createElement('div');
    name.className = 'menu-card-title';
    name.textContent = track.title;
    card.append(preview, name);
    card.addEventListener('click', () => {
      if (this.busy) return;
      this.opts.onSelectTrack(track);
    });
    return card;
  }

  private makeFileButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-file';
    button.textContent = 'свой файл';
    button.addEventListener('click', () => {
      if (this.busy) return;
      this.opts.onPickFile();
    });
    return button;
  }
}

import type { AudioSession } from '@audio/AudioSession';

export interface LevelgenPresetOption {
  id: string;
  label: string;
}

export interface GameplayRulesOption {
  id: string;
  label: string;
}

export interface AdrenalinePresetOption {
  id: string;
  label: string;
}

export interface AudioControlsOptions {
  onLoaded?: () => Promise<void> | void;
  onPlayRequested?: () => Promise<void> | void;
  onLoadStart?: () => void;
  onError?: (message: string) => void;
  onExportPlaytests?: () => void;
  getPlaytestLogCount?: () => number;
  getLogActive?: () => boolean;
  getLogEventCount?: () => number;
  levelgenPresets?: readonly LevelgenPresetOption[];
  getLevelgenPresetId?: () => string;
  onLevelgenPresetChange?: (id: string) => void;
  gameplayRules?: readonly GameplayRulesOption[];
  getGameplayRulesId?: () => string;
  onGameplayRulesChange?: (id: string) => void;
  adrenalinePresets?: readonly AdrenalinePresetOption[];
  getAdrenalinePresetId?: () => string;
  onAdrenalinePresetChange?: (id: string) => void;
  cameraPresets?: readonly LevelgenPresetOption[];
  getCameraPresetId?: () => string;
  onCameraPresetChange?: (id: string) => void;
  getContactShadowEnabled?: () => boolean;
  onContactShadowChange?: (enabled: boolean) => void;
  visible?: boolean;
}

export class AudioControls {
  private readonly root: HTMLDivElement;
  private readonly fileInput: HTMLInputElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly statusEl: HTMLDivElement;
  private readonly logBtn: HTMLButtonElement;
  private readonly levelgenSelect: HTMLSelectElement | null;
  private readonly gameplayRulesSelect: HTMLSelectElement | null;
  private readonly adrenalinePresetSelect: HTMLSelectElement | null;
  private readonly cameraPresetSelect: HTMLSelectElement | null;
  private readonly contactShadowCheck: HTMLInputElement | null;

  constructor(
    container: HTMLElement,
    private readonly session: AudioSession,
    private readonly opts: AudioControlsOptions = {},
  ) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;top:12px;right:16px;z-index:50;display:flex;gap:8px;align-items:center;' +
      'font:13px/1.2 monospace;color:#cfe;background:rgba(0,0,0,.45);padding:6px 10px;border-radius:6px;';
    container.appendChild(this.root);
    if (opts.visible === false) this.root.style.display = 'none';

    const label = document.createElement('label');
    label.style.cssText = 'cursor:pointer;text-decoration:underline;';
    label.textContent = 'Выбрать видео';
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'video/*,audio/*';
    this.fileInput.style.display = 'none';
    this.fileInput.addEventListener('change', () => {
      void this.onFile();
    });
    label.appendChild(this.fileInput);
    this.root.appendChild(label);

    this.playBtn = document.createElement('button');
    this.playBtn.textContent = '▶';
    this.playBtn.disabled = true;
    this.playBtn.style.cssText = 'cursor:pointer;font-size:13px;';
    this.playBtn.addEventListener('click', () => {
      void this.onPlay();
    });
    this.root.appendChild(this.playBtn);

    this.logBtn = document.createElement('button');
    this.logBtn.textContent = '⬇ logs';
    this.logBtn.title = 'Экспорт playtest-логов из браузера (IndexedDB)';
    this.logBtn.style.cssText = 'cursor:pointer;font-size:13px;';
    this.logBtn.addEventListener('click', () => {
      this.opts.onExportPlaytests?.();
    });
    this.root.appendChild(this.logBtn);

    this.statusEl = document.createElement('div');
    this.statusEl.textContent = '—';
    this.root.appendChild(this.statusEl);

    if (opts.cameraPresets && opts.cameraPresets.length > 0) {
      const cameraLabel = document.createElement('label');
      cameraLabel.style.cssText =
        'display:flex;align-items:center;gap:4px;user-select:none;';
      cameraLabel.title = 'Пресет камеры (сравнение feel)';
      const cameraCaption = document.createElement('span');
      cameraCaption.textContent = 'камера';
      this.cameraPresetSelect = document.createElement('select');
      this.cameraPresetSelect.style.cssText =
        'cursor:pointer;font:13px/1.2 monospace;color:#cfe;background:rgba(0,0,0,.35);' +
        'border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:1px 4px;';
      for (const preset of opts.cameraPresets) {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.label;
        this.cameraPresetSelect.appendChild(option);
      }
      const selectedCameraId =
        opts.getCameraPresetId?.() ?? opts.cameraPresets[0].id;
      this.cameraPresetSelect.value = selectedCameraId;
      this.cameraPresetSelect.addEventListener('change', () => {
        this.opts.onCameraPresetChange?.(this.cameraPresetSelect!.value);
      });
      cameraLabel.append(cameraCaption, this.cameraPresetSelect);
      this.root.appendChild(cameraLabel);
    } else {
      this.cameraPresetSelect = null;
    }

    if (opts.getContactShadowEnabled && opts.onContactShadowChange) {
      const shadowLabel = document.createElement('label');
      shadowLabel.style.cssText =
        'display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;';
      shadowLabel.title = 'Контактная тень под игроком';
      this.contactShadowCheck = document.createElement('input');
      this.contactShadowCheck.type = 'checkbox';
      this.contactShadowCheck.checked = opts.getContactShadowEnabled();
      this.contactShadowCheck.addEventListener('change', () => {
        this.opts.onContactShadowChange?.(this.contactShadowCheck!.checked);
      });
      shadowLabel.append(this.contactShadowCheck);
      shadowLabel.append('тень');
      this.root.appendChild(shadowLabel);
    } else {
      this.contactShadowCheck = null;
    }

    if (opts.levelgenPresets && opts.levelgenPresets.length > 0) {
      const presetLabel = document.createElement('label');
      presetLabel.style.cssText =
        'display:flex;align-items:center;gap:4px;user-select:none;';
      presetLabel.title = 'Пресет генератора уровня (перезапуск забега)';
      const presetCaption = document.createElement('span');
      presetCaption.textContent = 'сложность';
      this.levelgenSelect = document.createElement('select');
      this.levelgenSelect.style.cssText =
        'cursor:pointer;font:13px/1.2 monospace;color:#cfe;background:rgba(0,0,0,.35);' +
        'border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:1px 4px;';
      for (const preset of opts.levelgenPresets) {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.label;
        this.levelgenSelect.appendChild(option);
      }
      const selectedId = opts.getLevelgenPresetId?.() ?? opts.levelgenPresets[0].id;
      this.levelgenSelect.value = selectedId;
      this.levelgenSelect.addEventListener('change', () => {
        this.opts.onLevelgenPresetChange?.(this.levelgenSelect!.value);
      });
      presetLabel.append(presetCaption, this.levelgenSelect);
      this.root.appendChild(presetLabel);
    } else {
      this.levelgenSelect = null;
    }

    if (opts.gameplayRules && opts.gameplayRules.length > 0) {
      const rulesLabel = document.createElement('label');
      rulesLabel.style.cssText =
        'display:flex;align-items:center;gap:4px;user-select:none;';
      rulesLabel.title = 'Правила забега (перезапуск уровня)';
      const rulesCaption = document.createElement('span');
      rulesCaption.textContent = 'режим';
      this.gameplayRulesSelect = document.createElement('select');
      this.gameplayRulesSelect.style.cssText =
        'cursor:pointer;font:13px/1.2 monospace;color:#cfe;background:rgba(0,0,0,.35);' +
        'border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:1px 4px;';
      for (const rules of opts.gameplayRules) {
        const option = document.createElement('option');
        option.value = rules.id;
        option.textContent = rules.label;
        this.gameplayRulesSelect.appendChild(option);
      }
      const selectedRulesId =
        opts.getGameplayRulesId?.() ?? opts.gameplayRules[0].id;
      this.gameplayRulesSelect.value = selectedRulesId;
      this.gameplayRulesSelect.addEventListener('change', () => {
        this.opts.onGameplayRulesChange?.(this.gameplayRulesSelect!.value);
      });
      rulesLabel.append(rulesCaption, this.gameplayRulesSelect);
      this.root.appendChild(rulesLabel);
    } else {
      this.gameplayRulesSelect = null;
    }

    if (opts.adrenalinePresets && opts.adrenalinePresets.length > 0) {
      const adrenLabel = document.createElement('label');
      adrenLabel.style.cssText =
        'display:flex;align-items:center;gap:4px;user-select:none;';
      adrenLabel.title = 'Пресет баланса адреналина (перезапуск забега)';
      const adrenCaption = document.createElement('span');
      adrenCaption.textContent = 'adren';
      this.adrenalinePresetSelect = document.createElement('select');
      this.adrenalinePresetSelect.style.cssText =
        'cursor:pointer;font:13px/1.2 monospace;color:#cfe;background:rgba(0,0,0,.35);' +
        'border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:1px 4px;';
      for (const preset of opts.adrenalinePresets) {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.label;
        this.adrenalinePresetSelect.appendChild(option);
      }
      const selectedAdrenId =
        opts.getAdrenalinePresetId?.() ?? opts.adrenalinePresets[0].id;
      this.adrenalinePresetSelect.value = selectedAdrenId;
      this.adrenalinePresetSelect.addEventListener('change', () => {
        this.opts.onAdrenalinePresetChange?.(this.adrenalinePresetSelect!.value);
      });
      adrenLabel.append(adrenCaption, this.adrenalinePresetSelect);
      this.root.appendChild(adrenLabel);
    } else {
      this.adrenalinePresetSelect = null;
    }
  }

  private async onFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    this.statusEl.textContent = 'loading…';
    this.opts.onLoadStart?.();
    try {
      await this.session.loadFile(file);
      this.statusEl.textContent = `loaded: ${file.name}`;
      this.playBtn.disabled = false;
      if (this.opts.onLoaded) {
        await this.opts.onLoaded();
      } else {
        await this.session.play();
      }
      this.statusEl.textContent = 'playing';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.statusEl.textContent = `error: ${message}`;
      this.opts.onError?.(message);
    }
  }

  private async onPlay(): Promise<void> {
    try {
      if (this.opts.onPlayRequested) {
        await this.opts.onPlayRequested();
      } else {
        await this.session.play();
      }
      this.statusEl.textContent = 'playing';
    } catch (err) {
      this.statusEl.textContent = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  openFilePicker(): void {
    this.fileInput.click();
  }

  setStatus(status: string): void {
    this.statusEl.textContent = status;
  }

  syncLogButton(): void {
    const stored = this.opts.getPlaytestLogCount?.() ?? 0;
    const active = this.opts.getLogActive?.() ?? false;
    const events = this.opts.getLogEventCount?.() ?? 0;
    if (active) {
      this.logBtn.textContent = `⬇ logs (${stored}) · ${events}`;
      this.logBtn.style.color = '#8fdcff';
      return;
    }
    this.logBtn.textContent = stored > 0 ? `⬇ logs (${stored})` : '⬇ logs';
    this.logBtn.style.color = '';
  }

  setLevelgenPresetId(id: string): void {
    if (this.levelgenSelect) this.levelgenSelect.value = id;
  }

  setGameplayRulesId(id: string): void {
    if (this.gameplayRulesSelect) this.gameplayRulesSelect.value = id;
  }

  setAdrenalinePresetId(id: string): void {
    if (this.adrenalinePresetSelect) this.adrenalinePresetSelect.value = id;
  }

  setCameraPresetId(id: string): void {
    if (this.cameraPresetSelect) this.cameraPresetSelect.value = id;
  }

  dispose(): void {
    this.root.remove();
  }
}

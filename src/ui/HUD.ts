import type { GameSnapshot } from '@core/gameplay/GameSim';
import { shouldShowAdrenalineBar } from '@core/gameplay/gameplayRules';
import { adrenalineBarVisualPercent } from './adrenalineBarVisual';
import { VolumeSlider } from './VolumeSlider';

export interface RunResults {
  score: number;
  distance: number;
  coins: number;
  maxCombo: number;
  smashes: number;
  tricks: number;
  trainRideSeconds: number;
  carSeconds: number;
  horseSeconds: number;
  modeSwitches: number;
  horseOffers: number;
  carOffers: number;
  horsePickups: number;
  carPickups: number;
  horseJumpClears: number;
  horseSlideClears: number;
  hits: number;
  nitroActivations: number;
  blasterSaves: number;
  maxHorseMomentum: number;
}

export interface HUDOptions {
  onResume?: () => void;
  onRestart?: () => void;
  onChooseFile?: () => void;
  showRunCounters?: boolean;
  getMasterVolume?: () => number;
  onMasterVolumeChange?: (value: number) => void;
}

export class HUD {
  private readonly root: HTMLDivElement;
  private readonly scoreEl: HTMLDivElement;
  private readonly pointsEl: HTMLDivElement;
  private readonly comboEl: HTMLDivElement;
  private readonly smashEl: HTMLDivElement;
  private readonly nitroWrap: HTMLDivElement;
  private readonly nitroFillEl: HTMLDivElement;
  private readonly adrenalineWrap: HTMLDivElement;
  private readonly adrenalineFillEl: HTMLDivElement;
  private readonly adrenalineLabel: HTMLDivElement;
  private readonly horseMeterWrap: HTMLDivElement;
  private readonly horseMeterLabel: HTMLDivElement;
  private readonly horseMeterSegments: HTMLDivElement[] = [];
  private readonly overlayEl: HTMLDivElement;
  private readonly trackWrap: HTMLDivElement;
  private readonly trackFillEl: HTMLDivElement;
  private readonly trackTimeEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly pauseEl: HTMLDivElement;
  private readonly pauseVolume: VolumeSlider | null;
  private readonly resultsEl: HTMLDivElement;
  private readonly resultsStatsEl: HTMLDivElement;
  private readonly nitroHintEl: HTMLDivElement;
  private scoreDisplay = 0;
  private scoreAnim: number | null = null;
  private prevCombo = 0;
  private smashAnim: Animation | null = null;
  private nitroHintShown = false;
  private nitroHintTimer: number | null = null;
  private prevAdrenalineFill = 0;
  private prevNitroFill = 0;
  private adrenalineFlashAnim: Animation | null = null;
  private nitroFlashAnim: Animation | null = null;
  private adrenalineBorderBase = '1px solid rgba(70,210,110,.55)';
  private adrenalineFillShadowBase = 'none';
  private adrenalineWrapShadowBase = 'none';
  private adrenalineFlashShadow = '0 0 14px rgba(80,255,130,.85)';
  private adrenalineFlashBorderPeak = '1px solid rgba(120,255,150,.95)';
  private nitroFillShadowBase = 'none';
  private endRunBlocking = false;
  private readonly opts: HUDOptions;
  private readonly showRunCounters: boolean;

  constructor(container: HTMLElement, opts: HUDOptions = {}) {
    this.opts = opts;
    this.showRunCounters = opts.showRunCounters !== false;
    this.root = document.createElement('div');
    this.root.className = 'hud-root';
    this.root.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:10;color:#cfe;';
    container.appendChild(this.root);

    this.scoreEl = document.createElement('div');
    this.scoreEl.className = 'hud-score';
    this.scoreEl.style.cssText = 'position:absolute;';
    this.scoreEl.style.display = this.showRunCounters ? '' : 'none';
    this.root.appendChild(this.scoreEl);

    this.pointsEl = document.createElement('div');
    this.pointsEl.className = 'hud-points';
    this.pointsEl.style.cssText = 'position:absolute;';
    this.root.appendChild(this.pointsEl);

    this.comboEl = document.createElement('div');
    this.comboEl.className = 'hud-combo';
    this.comboEl.style.cssText = 'position:absolute;';
    this.root.appendChild(this.comboEl);

    this.smashEl = document.createElement('div');
    this.smashEl.className = 'hud-smash';
    this.smashEl.style.cssText = 'position:absolute;display:none;';
    this.smashEl.textContent = 'SMASH';
    this.root.appendChild(this.smashEl);

    this.nitroWrap = document.createElement('div');
    this.nitroWrap.className = 'hud-meter';
    this.nitroWrap.style.display = 'none';
    const label = document.createElement('div');
    label.className = 'hud-meter-label';
    label.textContent = 'NITRO';
    this.nitroWrap.appendChild(label);
    this.nitroFillEl = document.createElement('div');
    this.nitroFillEl.style.cssText =
      'height:100%;width:0%;background:linear-gradient(90deg,#1e7fd0,#3fd0ff);' +
      'border-radius:3px;transition:width .1s linear;';
    this.nitroWrap.appendChild(this.nitroFillEl);
    this.root.appendChild(this.nitroWrap);

    this.adrenalineWrap = document.createElement('div');
    this.adrenalineWrap.className = 'hud-meter hud-meter-adren';
    this.adrenalineWrap.style.display = 'none';
    this.adrenalineLabel = document.createElement('div');
    this.adrenalineLabel.className = 'hud-meter-label';
    this.adrenalineLabel.textContent = 'ADREN';
    this.adrenalineWrap.appendChild(this.adrenalineLabel);
    this.adrenalineFillEl = document.createElement('div');
    this.adrenalineFillEl.style.cssText =
      'height:100%;width:0%;background:linear-gradient(90deg,#1aab4f,#55e878);' +
      'border-radius:3px;transition:width .1s linear,background .2s linear;';
    this.adrenalineWrap.appendChild(this.adrenalineFillEl);
    this.root.appendChild(this.adrenalineWrap);

    this.horseMeterWrap = document.createElement('div');
    this.horseMeterWrap.className = 'hud-meter hud-meter-horse';
    this.horseMeterLabel = document.createElement('div');
    this.horseMeterLabel.className = 'hud-meter-label';
    this.horseMeterLabel.textContent = 'MOMENTUM';
    this.horseMeterWrap.appendChild(this.horseMeterLabel);
    for (let i = 0; i < 4; i++) {
      const segment = document.createElement('div');
      segment.style.cssText =
        'height:100%;flex:1;border-radius:2px;background:rgba(255,180,80,.14);' +
        'transition:background .12s linear,box-shadow .12s linear,transform .12s ease-out;';
      this.horseMeterSegments.push(segment);
      this.horseMeterWrap.appendChild(segment);
    }
    this.root.appendChild(this.horseMeterWrap);

    this.trackWrap = document.createElement('div');
    this.trackWrap.className = 'hud-track';
    this.trackWrap.style.cssText = 'position:absolute;display:none;overflow:visible;';
    this.trackFillEl = document.createElement('div');
    this.trackFillEl.style.cssText =
      'height:100%;width:0%;border-radius:5px;background:linear-gradient(90deg,#35cfff,#78ffcf);' +
      'box-shadow:0 0 10px rgba(53,207,255,.7);';
    this.trackWrap.appendChild(this.trackFillEl);
    this.trackTimeEl = document.createElement('div');
    this.trackTimeEl.style.cssText =
      'position:absolute;top:11px;left:50%;transform:translateX(-50%);white-space:nowrap;' +
      'font-size:12px;color:#dff;text-shadow:0 1px 4px #000;';
    this.trackWrap.appendChild(this.trackTimeEl);
    this.root.appendChild(this.trackWrap);

    this.nitroHintEl = document.createElement('div');
    this.nitroHintEl.className = 'hud-nitro-hint';
    this.nitroHintEl.style.cssText = 'position:absolute;display:none;';
    this.nitroHintEl.textContent = 'Нажми пробел для нитро';
    this.root.appendChild(this.nitroHintEl);

    this.countdownEl = document.createElement('div');
    this.countdownEl.className = 'hud-countdown';
    this.countdownEl.style.cssText =
      'position:absolute;inset:0;display:none;align-items:center;justify-content:center;';
    this.root.appendChild(this.countdownEl);

    this.pauseEl = document.createElement('div');
    this.pauseEl.className = 'hud-pause';
    this.pauseEl.style.cssText =
      'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;color:#dff;' +
      'pointer-events:auto;';
    const pauseTitle = document.createElement('div');
    pauseTitle.className = 'hud-pause-title';
    pauseTitle.textContent = 'Пауза';
    const pauseHint = document.createElement('span');
    pauseHint.className = 'hud-pause-hint';
    pauseHint.textContent = 'Esc — продолжить';
    pauseTitle.appendChild(pauseHint);
    this.pauseEl.appendChild(pauseTitle);
    if (opts.getMasterVolume && opts.onMasterVolumeChange) {
      this.pauseVolume = new VolumeSlider({
        value: opts.getMasterVolume(),
        onChange: (value) => opts.onMasterVolumeChange?.(value),
      });
      this.pauseEl.appendChild(this.pauseVolume.root);
    } else {
      this.pauseVolume = null;
    }
    const pauseActions = document.createElement('div');
    pauseActions.className = 'hud-run-actions';
    pauseActions.appendChild(this.makeButton('Продолжить', () => opts.onResume?.()));
    pauseActions.appendChild(this.makeButton('Заново', () => opts.onRestart?.()));
    pauseActions.appendChild(this.makeButton('Другой трек', () => opts.onChooseFile?.()));
    this.pauseEl.appendChild(pauseActions);
    this.root.appendChild(this.pauseEl);

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'hud-gameover';
    this.overlayEl.style.cssText =
      'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;' +
      'color:#f88;background:rgba(0,0,0,.4);pointer-events:auto;gap:18px;';
    const gameOverTitle = document.createElement('div');
    gameOverTitle.className = 'hud-gameover-title';
    gameOverTitle.textContent = 'GAME OVER';
    const gameOverHint = document.createElement('div');
    gameOverHint.className = 'hud-pause-hint';
    gameOverHint.textContent = 'Любая клавиша — заново';
    const gameOverActions = document.createElement('div');
    gameOverActions.className = 'hud-run-actions';
    gameOverActions.appendChild(this.makeButton('Заново', () => opts.onRestart?.()));
    gameOverActions.appendChild(this.makeButton('Другой трек', () => opts.onChooseFile?.()));
    this.overlayEl.appendChild(gameOverTitle);
    this.overlayEl.appendChild(gameOverHint);
    this.overlayEl.appendChild(gameOverActions);
    this.root.appendChild(this.overlayEl);

    this.resultsEl = document.createElement('div');
    this.resultsEl.className = 'hud-results';
    this.resultsEl.style.cssText =
      'position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,8,18,.82);pointer-events:auto;';
    const panel = document.createElement('div');
    panel.className = 'hud-results-panel';
    const title = document.createElement('div');
    title.className = 'hud-results-title';
    title.textContent = 'ТРЕК ЗАВЕРШЁН';
    panel.appendChild(title);
    this.resultsStatsEl = document.createElement('div');
    this.resultsStatsEl.className = 'hud-results-stats';
    panel.appendChild(this.resultsStatsEl);
    const actions = document.createElement('div');
    actions.className = 'hud-results-actions';
    actions.appendChild(this.makeButton('Повторить', () => opts.onRestart?.()));
    actions.appendChild(this.makeButton('Другой трек', () => opts.onChooseFile?.()));
    panel.appendChild(actions);
    this.resultsEl.appendChild(panel);
    this.root.appendChild(this.resultsEl);
  }

  update(snapshot: GameSnapshot, suppressNitroHint = false): void {
    if (this.showRunCounters) {
      this.scoreEl.textContent =
        `м ${String(snapshot.scoreMeters).padStart(4, '0')}  ● ${snapshot.scoreCoins}` +
        `  [${snapshot.phase}]`;
    }

    if (snapshot.scoreTotal !== this.scoreDisplay) {
      this.countUp(this.pointsEl, snapshot.scoreTotal);
    }

    const combo = snapshot.combo;
    const multiplier = snapshot.comboMultiplier;
    if (combo > this.prevCombo) {
      if (snapshot.comboSmash) this.showSmash(multiplier);
    }
    this.comboEl.style.display = 'none';
    this.prevCombo = combo;

    const nitroActive = snapshot.player.isAbilityActive;
    const adrenalineMode = shouldShowAdrenalineBar(snapshot.gameplayRules);
    this.adrenalineWrap.style.display = adrenalineMode ? 'flex' : 'none';
    if (adrenalineMode) {
      const adrenalineActual = Math.max(
        0,
        Math.min(100, (snapshot.player.adrenaline / snapshot.adrenalineMax) * 100),
      );
      const adrenalineFill = adrenalineBarVisualPercent(adrenalineActual);
      this.adrenalineFillEl.style.width = `${adrenalineFill}%`;
      if (adrenalineFill > this.prevAdrenalineFill + 0.05) {
        this.flashAdrenalineBar();
      } else if (adrenalineFill < this.prevAdrenalineFill - 0.05) {
        this.flashAdrenalineBarDamage();
      }
      if (adrenalineMode && snapshot.coinPickups.length > 0) {
        this.flashAdrenalineBar();
      }
      this.prevAdrenalineFill = adrenalineFill;
      this.applyAdrenalineBarStyle(adrenalineFill);
    }
    const nitroFill = Math.max(0, Math.min(100, (snapshot.player.nitroCharge / snapshot.nitroMaxFill) * 100));
    const nitroFull = nitroFill >= 100;
    this.nitroWrap.style.display = snapshot.player.mode === 'car' ? 'flex' : 'none';
    const horseMode = snapshot.player.mode === 'horse';
    const overdrive = snapshot.player.horseOverdriveRemaining > 0;
    const blasterReady = snapshot.player.horseMomentum >= 0.75;
    this.horseMeterWrap.style.display = horseMode ? 'flex' : 'none';
    this.horseMeterLabel.textContent = overdrive
      ? `OVERDRIVE ${snapshot.player.horseOverdriveRemaining.toFixed(1)}s`
      : blasterReady
        ? 'SHIELD READY'
        : 'MOMENTUM';
    this.horseMeterLabel.style.color = overdrive ? '#7dffff' : '#ffd27a';
    for (let i = 0; i < this.horseMeterSegments.length; i++) {
      const segment = this.horseMeterSegments[i];
      const fill = Math.max(0, Math.min(1, snapshot.player.horseMomentum * this.horseMeterSegments.length - i));
      const lastSegment = i === this.horseMeterSegments.length - 1;
      const fillColor = overdrive
        ? '#70efff'
        : lastSegment
          ? '#69dfff'
          : '#ffd06a';
      const emptyColor = lastSegment ? 'rgba(70,210,255,.2)' : 'rgba(255,180,80,.14)';
      const percent = `${fill * 100}%`;
      segment.style.background =
        `linear-gradient(90deg,${fillColor} 0%,${fillColor} ${percent},${emptyColor} ${percent},${emptyColor} 100%)`;
      segment.style.border = lastSegment ? '1px solid rgba(90,220,255,.7)' : '1px solid transparent';
      segment.style.boxShadow = fill > 0.01
        ? overdrive
          ? '0 0 18px rgba(80,240,255,.95)'
          : i === this.horseMeterSegments.length - 2
            ? '0 0 14px rgba(100,220,255,.85)'
            : '0 0 10px rgba(255,190,80,.7)'
        : 'none';
      segment.style.transform = overdrive && fill > 0.01 ? 'scaleY(1.18)' : 'scaleY(1)';
    }
    this.nitroFillEl.style.width = `${nitroFill}%`;
    if (nitroFill > this.prevNitroFill + 0.05) {
      this.flashNitroBar();
    }
    if (snapshot.salvationFlash > 0) {
      this.flashNitroBarSalvation(snapshot.salvationFlash);
    }
    this.prevNitroFill = nitroFill;
    this.applyNitroBarStyle(nitroFull, nitroActive);
    this.nitroWrap.style.opacity = nitroActive
      ? '1'
      : nitroFull
        ? String(0.7 + 0.3 * (0.5 + 0.5 * Math.sin(performance.now() / 130)))
        : '0.32';
    if (
      (nitroActive || snapshot.player.mode !== 'car' || suppressNitroHint) &&
      this.nitroHintEl.style.display !== 'none'
    ) {
      if (this.nitroHintTimer !== null) window.clearTimeout(this.nitroHintTimer);
      this.nitroHintTimer = null;
      this.nitroHintEl.style.display = 'none';
    }
    if (
      snapshot.player.mode === 'car' &&
      nitroFull &&
      !nitroActive &&
      !this.nitroHintShown &&
      !suppressNitroHint
    ) {
      this.showNitroHint();
    }
    this.overlayEl.style.display =
      snapshot.player.gameOver && !this.endRunBlocking ? 'flex' : 'none';
  }

  setEndRunBlocking(blocking: boolean): void {
    this.endRunBlocking = blocking;
    if (blocking) this.overlayEl.style.display = 'none';
  }

  updateTrack(currentSeconds: number, durationSeconds: number): void {
    if (durationSeconds <= 0) {
      this.trackWrap.style.display = 'none';
      return;
    }
    const current = Math.max(0, Math.min(durationSeconds, currentSeconds));
    this.trackWrap.style.display = 'block';
    this.trackFillEl.style.width = `${(current / durationSeconds) * 100}%`;
    this.trackTimeEl.textContent = `${formatTime(current)} / ${formatTime(durationSeconds)}`;
  }

  showCountdown(label: string | null): void {
    this.countdownEl.style.display = label === null ? 'none' : 'flex';
    this.countdownEl.textContent = label ?? '';
  }

  setPaused(paused: boolean): void {
    this.pauseEl.style.display = paused ? 'flex' : 'none';
    if (paused) {
      this.pauseVolume?.setValue(this.opts.getMasterVolume?.() ?? 1);
    }
  }

  setHidden(hidden: boolean): void {
    this.root.style.display = hidden ? 'none' : '';
  }

  setMasterVolume(value: number): void {
    this.pauseVolume?.setValue(value);
  }

  showResults(results: RunResults | null): void {
    this.resultsEl.style.display = results ? 'flex' : 'none';
    if (!results) return;
    this.resultsStatsEl.innerHTML =
      `Очки: <b>${results.score}</b><br>` +
      `Дистанция: <b>${Math.floor(results.distance)} м</b><br>` +
      `Монеты: <b>${results.coins}</b><br>` +
      `Максимальное комбо: <b>${results.maxCombo}</b><br>` +
      `Разрушено: <b>${results.smashes}</b><br>` +
      `Трюки: <b>${results.tricks}</b><br>` +
      `На поездах: <b>${results.trainRideSeconds.toFixed(1)} с</b><br>` +
      `Машина / конь: <b>${results.carSeconds.toFixed(1)} / ${results.horseSeconds.toFixed(1)} с</b><br>` +
      `Смены формы: <b>${results.modeSwitches}</b><br>` +
      `Предложено 🐎/🚗: <b>${results.horseOffers}/${results.carOffers}</b>, собрано: ` +
      `<b>${results.horsePickups}/${results.carPickups}</b><br>` +
      `Конь — прыжки / подкаты: <b>${results.horseJumpClears}/${results.horseSlideClears}</b><br>` +
      `Удары: <b>${results.hits}</b>, нитро: <b>${results.nitroActivations}</b>, ` +
      `спасения бластером: <b>${results.blasterSaves}</b><br>` +
      `Макс. разгон коня: <b>${Math.round(results.maxHorseMomentum * 100)}%</b>`;
  }

  resetRun(): void {
    this.scoreDisplay = 0;
    this.prevCombo = 0;
    this.prevAdrenalineFill = 0;
    this.prevNitroFill = 0;
    this.nitroHintShown = false;
    if (this.nitroHintTimer !== null) window.clearTimeout(this.nitroHintTimer);
    this.nitroHintTimer = null;
    this.nitroHintEl.style.display = 'none';
    this.endRunBlocking = false;
    this.overlayEl.style.display = 'none';
    this.showResults(null);
    this.setPaused(false);
  }

  private showSmash(multiplier: number): void {
    const el = this.smashEl;
    if (this.smashAnim !== null) this.smashAnim.cancel();
    const scale = 1 + Math.min(0.55, (multiplier - 1) * 0.18);
    const fontSize = 30 + Math.min(14, (multiplier - 1) * 5);
    const glow = Math.min(1, 0.55 + (multiplier - 1) * 0.12);
    el.style.fontSize = `${fontSize}px`;
    el.style.color = multiplier >= 4 ? '#9af5ff' : multiplier >= 2 ? '#7de8ff' : '#6fe3ff';
    el.style.textShadow = `0 0 ${12 + multiplier * 3}px rgba(80,220,255,${glow})`;
    el.style.display = 'block';
    this.smashAnim = el.animate(
      [
        { transform: 'translateX(-50%) scale(0.5)', opacity: 0 },
        { transform: `translateX(-50%) scale(${1.2 * scale})`, opacity: 1 },
        { transform: `translateX(-50%) scale(${1.05 * scale})`, opacity: 1 },
        { transform: `translateX(-50%) scale(${1.4 * scale})`, opacity: 0 },
      ],
      { duration: 380, easing: 'ease-out' },
    );
    this.smashAnim.onfinish = () => {
      el.style.display = 'none';
      this.smashAnim = null;
    };
  }

  private applyAdrenalineBarStyle(visualFill: number): void {
    if (visualFill < 25) {
      this.adrenalineFillEl.style.background = 'linear-gradient(90deg,#b83220,#ff5a42)';
      this.adrenalineBorderBase = '1px solid rgba(255,95,70,.72)';
      this.adrenalineLabel.style.color = '#ff8a72';
      this.adrenalineFlashBorderPeak = '1px solid rgba(255,120,90,.95)';
      this.adrenalineFlashShadow = '0 0 16px rgba(255,70,40,.9)';
      const pulse = 0.76 + 0.24 * (0.5 + 0.5 * Math.sin(performance.now() / 130));
      this.adrenalineFillEl.style.opacity = String(pulse);
      this.adrenalineFillShadowBase =
        `0 0 ${12 + pulse * 10}px rgba(255,70,40,${0.3 + pulse * 0.25})`;
      this.adrenalineWrapShadowBase =
        `0 0 14px rgba(255,70,40,${0.14 + pulse * 0.1})`;
      this.adrenalineFillEl.style.boxShadow = this.adrenalineFillShadowBase;
      this.adrenalineWrap.style.border = this.adrenalineBorderBase;
      this.adrenalineWrap.style.boxShadow = this.adrenalineWrapShadowBase;
      return;
    }
    if (visualFill < 50) {
      this.adrenalineFillEl.style.background = 'linear-gradient(90deg,#c9a012,#ffe066)';
      this.adrenalineBorderBase = '1px solid rgba(255,205,70,.68)';
      this.adrenalineLabel.style.color = '#ffe08a';
      this.adrenalineFlashBorderPeak = '1px solid rgba(255,220,100,.95)';
      this.adrenalineFlashShadow = '0 0 14px rgba(255,200,55,.85)';
      const pulse = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(performance.now() / 145));
      this.adrenalineFillEl.style.opacity = String(pulse);
      this.adrenalineFillShadowBase =
        `0 0 ${10 + pulse * 8}px rgba(255,200,55,${0.22 + pulse * 0.18})`;
      this.adrenalineWrapShadowBase =
        `0 0 12px rgba(255,200,55,${0.12 + pulse * 0.08})`;
      this.adrenalineFillEl.style.boxShadow = this.adrenalineFillShadowBase;
      this.adrenalineWrap.style.border = this.adrenalineBorderBase;
      this.adrenalineWrap.style.boxShadow = this.adrenalineWrapShadowBase;
      return;
    }
    this.adrenalineFillEl.style.background = 'linear-gradient(90deg,#1aab4f,#55e878)';
    this.adrenalineBorderBase = '1px solid rgba(70,210,110,.55)';
    this.adrenalineLabel.style.color = '#7dffa8';
    this.adrenalineFlashBorderPeak = '1px solid rgba(120,255,150,.95)';
    this.adrenalineFlashShadow = '0 0 14px rgba(80,255,130,.85)';
    this.adrenalineFillEl.style.opacity = '1';
    this.adrenalineFillShadowBase = 'none';
    this.adrenalineWrapShadowBase = 'none';
    this.adrenalineFillEl.style.boxShadow = this.adrenalineFillShadowBase;
    this.adrenalineWrap.style.border = this.adrenalineBorderBase;
    this.adrenalineWrap.style.boxShadow = this.adrenalineWrapShadowBase;
  }

  private applyNitroBarStyle(nitroFull: boolean, nitroActive: boolean): void {
    this.nitroFillEl.style.background = nitroActive
      ? 'linear-gradient(90deg,#45c8ff,#9ff4ff)'
      : nitroFull
        ? 'linear-gradient(90deg,#2eb0ff,#6ee8ff)'
        : 'linear-gradient(90deg,#1e7fd0,#3fd0ff)';
    this.nitroWrap.style.border = nitroFull || nitroActive
      ? '1px solid rgba(140,235,255,.82)'
      : '1px solid rgba(120,200,255,.5)';
    this.nitroWrap.style.boxShadow = nitroFull || nitroActive
      ? '0 0 16px rgba(80,220,255,.35)'
      : 'none';
    if (nitroFull && !nitroActive) {
      const pulse = 0.84 + 0.16 * (0.5 + 0.5 * Math.sin(performance.now() / 118));
      this.nitroFillEl.style.transform = `scaleY(${0.96 + pulse * 0.12})`;
      this.nitroFillEl.style.filter = `brightness(${1.08 + pulse * 0.18})`;
      this.nitroFillShadowBase =
        `0 0 ${18 + pulse * 14}px rgba(90,235,255,${0.72 + pulse * 0.28})`;
      this.nitroFillEl.style.boxShadow = this.nitroFillShadowBase;
      return;
    }
    this.nitroFillEl.style.transform = nitroActive ? 'scaleY(1.06)' : 'scaleY(1)';
    this.nitroFillEl.style.filter = nitroActive ? 'brightness(1.22)' : 'brightness(1)';
    this.nitroFillShadowBase = nitroActive
      ? '0 0 26px rgba(100,240,255,1), 0 0 10px rgba(180,250,255,.95)'
      : 'none';
    this.nitroFillEl.style.boxShadow = this.nitroFillShadowBase;
  }

  private flashAdrenalineBar(): void {
    this.flashBar(
      this.adrenalineFillEl,
      this.adrenalineWrap,
      'adrenaline',
      this.adrenalineFlashShadow,
      'brightness(1.35)',
      this.adrenalineFlashBorderPeak,
      this.adrenalineFillShadowBase,
      this.adrenalineWrapShadowBase,
    );
  }

  private flashAdrenalineBarDamage(): void {
    this.flashBar(
      this.adrenalineFillEl,
      this.adrenalineWrap,
      'adrenaline',
      this.adrenalineFlashShadow,
      'brightness(1.2)',
      this.adrenalineFlashBorderPeak,
      this.adrenalineFillShadowBase,
      this.adrenalineWrapShadowBase,
    );
  }

  private flashNitroBar(): void {
    this.flashBar(
      this.nitroFillEl,
      this.nitroWrap,
      'nitro',
      '0 0 14px rgba(80,220,255,.85)',
      'brightness(1.35)',
      undefined,
      this.nitroFillShadowBase,
      'none',
    );
  }

  private flashNitroBarSalvation(strength: number): void {
    const pulse = Math.min(1, Math.max(0, strength / 0.55));
    this.flashBar(
      this.nitroFillEl,
      this.nitroWrap,
      'nitro',
      `0 0 ${18 + pulse * 22}px rgba(120,255,220,${0.75 + pulse * 0.25})`,
      `brightness(${1.25 + pulse * 0.55})`,
      '1px solid rgba(180,255,240,.95)',
      this.nitroFillShadowBase,
      'none',
    );
  }

  private flashBar(
    fillEl: HTMLDivElement,
    wrapEl: HTMLDivElement,
    kind: 'adrenaline' | 'nitro',
    peakShadow: string,
    peakFilter = 'brightness(1.35)',
    peakBorder?: string,
    restoreFillShadow = 'none',
    restoreWrapShadow = 'none',
  ): void {
    const anim = kind === 'adrenaline' ? this.adrenalineFlashAnim : this.nitroFlashAnim;
    if (anim !== null) anim.cancel();
    const borderPeak =
      peakBorder ??
      (kind === 'adrenaline'
        ? this.adrenalineFlashBorderPeak
        : '1px solid rgba(140,220,255,.95)');
    const borderBase =
      kind === 'adrenaline'
        ? this.adrenalineBorderBase
        : '1px solid rgba(120,200,255,.5)';
    const nextAnim = fillEl.animate(
      [
        { opacity: 1, boxShadow: peakShadow, filter: peakFilter },
        { opacity: 1, boxShadow: restoreFillShadow, filter: 'brightness(1)' },
      ],
      { duration: 120, easing: 'ease-out' },
    );
    wrapEl.animate(
      [
        { border: borderPeak, boxShadow: peakShadow },
        { border: borderBase, boxShadow: restoreWrapShadow },
      ],
      { duration: 120, easing: 'ease-out' },
    );
    nextAnim.onfinish = () => {
      if (kind === 'adrenaline') this.adrenalineFlashAnim = null;
      else this.nitroFlashAnim = null;
    };
    if (kind === 'adrenaline') this.adrenalineFlashAnim = nextAnim;
    else this.nitroFlashAnim = nextAnim;
  }

  private showNitroHint(): void {
    this.nitroHintShown = true;
    this.nitroHintEl.style.display = 'block';
    this.nitroHintEl.animate(
      [
        { transform: 'translateX(-50%) scale(.85)', opacity: 0 },
        { transform: 'translateX(-50%) scale(1.08)', opacity: 1 },
        { transform: 'translateX(-50%) scale(1)', opacity: 1 },
      ],
      { duration: 320, easing: 'ease-out' },
    );
    this.nitroHintTimer = window.setTimeout(() => {
      this.nitroHintEl.style.display = 'none';
      this.nitroHintTimer = null;
    }, 3200);
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hud-action';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private pop(el: HTMLDivElement, scale: number): void {
    el.animate(
      [
        { transform: 'translateX(-50%) scale(1)', opacity: 1 },
        { transform: `translateX(-50%) scale(${scale})`, opacity: 1 },
        { transform: 'translateX(-50%) scale(1)', opacity: 1 },
      ],
      { duration: 220, easing: 'ease-out' },
    );
  }

  private countUp(el: HTMLDivElement, target: number): void {
    const from = this.scoreDisplay;
    this.scoreDisplay = target;
    if (this.scoreAnim !== null) {
      cancelAnimationFrame(this.scoreAnim);
      this.scoreAnim = null;
    }
    this.pop(el, 1.2);
    const duration = 260;
    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(from + (target - from) * eased));
      if (t < 1) {
        this.scoreAnim = requestAnimationFrame(step);
      } else {
        this.scoreAnim = null;
        el.textContent = String(target);
      }
    };
    this.scoreAnim = requestAnimationFrame(step);
  }
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

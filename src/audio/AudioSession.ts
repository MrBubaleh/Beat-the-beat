import { SfxDirector } from '@core/sfx/SfxDirector';
import type { SfxConfig } from '@core/sfx/config';
import type { SfxEvent, SfxFrame } from '@core/sfx/types';
import { SfxEngine } from './sfx/SfxEngine';
import { LevelSamples } from './sfx/LevelSamples';
import type { TutorialConfig } from '@core/tutorial/TutorialController';
import type { AudioConfig } from '@core/config/schemas';
import type { DamageState } from '@core/gameplay/health';
import type { RocketPhase } from '@core/gameplay/rocket';
import type { MusicState } from '@core/state/MusicState';
import { AudioClock } from './AudioClock';
import {
  AudioGraph,
  type MusicMixConfig,
  type RocketAudioConfig,
} from './AudioGraph';
import { AudioWorkletAnalyzer } from './AudioWorkletAnalyzer';
import type { VideoDisplayMode } from '@app/videoDisplay';
import { VideoFileAudioSource } from './VideoFileAudioSource';

import { MusicLookahead } from './MusicLookahead';
import { MUSIC_PLANNING_DEFAULTS, type MusicPlanningConfig } from '@core/gameplay/musicPlanning';

export class AudioSession {
  private lookahead = new MusicLookahead(MUSIC_PLANNING_DEFAULTS);
  private planningConfig = MUSIC_PLANNING_DEFAULTS;
  onPreparationProgress: (message: string) => void = () => undefined;


  configureMusicPlanning(config: MusicPlanningConfig): void {
    this.lookahead.dispose();
    this.planningConfig = config;
    this.lookahead = new MusicLookahead(config);
  }
  private sfxConfig: SfxConfig | null = null;
  private sfxDirector: SfxDirector | null = null;
  private sfxEngine: SfxEngine | null = null;
  private levelSamples: LevelSamples | null = null;
  private sfxFailure: string | null = null;
  private ctx: AudioContext | null = null;
  private clock: AudioClock | null = null;
  private graph: AudioGraph | null = null;
  private source: VideoFileAudioSource | null = null;
  private analyzer: AudioWorkletAnalyzer | null = null;
  private sourceConnected = false;
  private ready = false;
  private damageStressSmoothed = 0;
  private nitroBoostSmoothed = 0;
  private rocketMuffleSmoothed = 0;
  private rocketTurboSmoothed = 0;
  private rocketSampleDuckActive = false;
  private rocketReleaseElapsed = 0;
  private lastRocketAudio: RocketAudioConfig | null = null;
  private nitroClearElapsed = 0;
  private nitroActivePrev = false;
  private tutorialScale = 1;
  private portalJellyT = -1;

  private readonly config: AudioConfig;
  private playing = false;
  private displayMode: VideoDisplayMode = 'horizon';
  private loadedFileName: string | null = null;
  private masterVolume = 1;

  constructor(config: AudioConfig, private tutorialConfig: TutorialConfig) {
    this.config = config;
  }

  get isReady(): boolean {
    return this.ready;
  }

  get isPlaying(): boolean {
    return this.playing && !this.source?.ended;
  }

  get trackTime(): number {
    return this.source?.currentTime ?? 0;
  }

  get trackDuration(): number {
    return this.source?.duration ?? 0;
  }

  get loadedTrackFileName(): string | null {
    return this.loadedFileName;
  }

  get hasEnded(): boolean {
    return this.ready && Boolean(this.source?.ended);
  }

  get latencyOffset(): number {
    return this.clock?.latencyOffset ?? 0;
  }

  getVideoDisplayMode(): VideoDisplayMode {
    return this.displayMode;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.ready ? this.source?.getVideoElement() ?? null : null;
  }

  setVideoDisplayMode(mode: VideoDisplayMode): void {
    this.displayMode = mode;
    this.source?.setPreviewVisible(mode === 'preview');
  }

  async loadFile(file: File): Promise<void> {
    await this.loadFromSource(file.name, (source) => source.load(file));
    await this.lookahead.prepare(this.ctx!, async () => {
      if (file.size > this.planningConfig.maxFileMB * 1024 * 1024) throw new Error('file budget');
      return file.arrayBuffer();
    }, this.trackDuration, this.onPreparationProgress);
  }

  async loadUrl(url: string, fileName: string): Promise<void> {
    await this.loadFromSource(fileName, (source) => source.loadUrl(url, fileName));
    await this.lookahead.prepare(this.ctx!, async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('track fetch');
      if (Number(response.headers.get('content-length')) > this.planningConfig.maxFileMB * 1024 * 1024) throw new Error('file budget');
      return response.arrayBuffer();
    }, this.trackDuration, this.onPreparationProgress);
  }

  async play(): Promise<void> {
    if (!this.ready || !this.source || !this.ctx) return;
    await this.resume();
    await this.source.play();
    this.playing = true;
  }

  pause(): void {
    this.sfxEngine?.silence();
    this.source?.pause();
    this.playing = false;
  }

  prepareRestart(): void {
    this.resetSfx();
    this.pause();
    this.source?.rewind();
    this.lookahead.restart();
    this.clock?.restart();
    this.analyzer?.restart();
    this.setTutorialPlaybackScale(1);
    this.graph?.setTrackEndVolume(1);
    this.portalJellyT = -1;
    this.graph?.setPortalJelly(0);
  }

  async restart(): Promise<void> {
    this.resetSfx();
    if (!this.ready || !this.source || !this.ctx) return;
    await this.resume();
    this.lookahead.restart();
    this.clock?.restart();
    this.analyzer?.restart();
    this.setTutorialPlaybackScale(1);
    await this.source.restart();
    this.playing = true;
    this.damageStressSmoothed = 0;
    this.nitroBoostSmoothed = 0;
    this.rocketMuffleSmoothed = 0;
    this.rocketTurboSmoothed = 0;
    this.nitroClearElapsed = 0;
    this.nitroActivePrev = false;
    this.portalJellyT = -1;
    this.graph?.setPortalJelly(0);
    this.graph?.setTrackEndVolume(1);
  }

  configureSfx(config: SfxConfig): void {
    this.sfxConfig = config;
    if (!this.sfxDirector) this.sfxDirector = new SfxDirector(config);
    else this.sfxDirector.configure(config);
    this.sfxEngine?.configure(config);
    this.levelSamples?.configure(config.levelSamples);
    this.sfxFailure = null;
  }

  private ensureLevelSamples(): LevelSamples | null {
    if (!this.ctx || !this.graph || !this.sfxConfig) return null;
    if (!this.levelSamples) {
      this.levelSamples = new LevelSamples(
        this.ctx,
        this.graph.sfxBus,
        this.sfxConfig.levelSamples,
      );
    }
    return this.levelSamples;
  }

  async playEngineStart(): Promise<void> {
    this.ensureContext();
    this.ensurePipeline();
    if (!this.ctx) return;
    await this.resume();
    const samples = this.ensureLevelSamples();
    if (!samples) return;
    await samples.ready;
    samples.playEngineStart(this.ctx.currentTime);
  }

  preloadLevelSamples(): void {
    this.ensureContext();
    this.ensurePipeline();
    this.ensureLevelSamples();
  }

  resetSfx(): void {
    this.sfxEngine?.silence();
    this.sfxDirector?.reset();
  }

  getSfxDiagnostics() {
    return { director: this.sfxDirector?.diagnostics, engine: this.sfxEngine?.diagnostics, failure: this.sfxFailure };
  }

  updateSfx(events: readonly SfxEvent[], frame: SfxFrame): void {
    if (!this.ctx || !this.graph || !this.sfxConfig || !this.sfxDirector || this.sfxFailure) return;
    const audible = this.ctx.state === 'running';
    const current = audible ? frame : { ...frame, phase: 'idle' as const };
    try {
      if (!this.sfxEngine && this.sfxConfig.enabled && audible && (frame.phase === 'running' || frame.phase === 'gameOver')) {
        this.sfxEngine = new SfxEngine(
          this.ctx,
          this.graph.sfxBus,
          this.sfxConfig,
          this.graph.rocketSampleBus,
          this.ensureLevelSamples() ?? undefined,
        );
      }
      this.sfxEngine?.apply(this.sfxDirector.tick(events, current, this.ctx.currentTime));
    } catch (error) {
      this.sfxFailure = error instanceof Error ? error.message : String(error);
      this.sfxEngine?.dispose();
      this.sfxEngine = null;
    }
  }

  getMusicState(): MusicState {
    const live = this.analyzer?.getLatestState() ?? emptyMusicState();
    if (!this.planningConfig.enabled) return live;
    const now = Math.max(0, this.trackTime - this.latencyOffset);
    const rate = Math.max(this.tutorialConfig.audioMinPlaybackRate,
      this.tutorialScale ** this.tutorialConfig.audioPlaybackRatePower) / Math.max(0.01, this.tutorialScale);
    const forecast = this.lookahead.forecast(now, rate);
    const cue = forecast.source === 'decoded' ? forecast.cues.filter(c => c.time <= now && now - c.time < 0.09).at(-1) : undefined;
    const beat = this.isPlaying && cue !== undefined;

    return { ...live, audioTime: now, forecast,
      energy: { value: forecast.energy?.filter(frame => frame.time <= now).at(-1)?.value ?? live.energy.value, audioTime: now },
      beat: forecast.source === 'decoded' ? { value: beat, audioTime: cue?.time ?? now } : live.beat };

  }

  setTutorialConfig(config: TutorialConfig): void {
    this.tutorialConfig = config;
    this.setTutorialPlaybackScale(this.tutorialScale);
  }

  setTutorialPlaybackScale(scale: number): void {
    const cfg = this.tutorialConfig;
    this.tutorialScale = Number.isFinite(scale) ? Math.max(0, Math.min(1, scale)) : 1;
    const rate = Math.max(cfg.audioMinPlaybackRate, this.tutorialScale ** cfg.audioPlaybackRatePower);
    const blend = cfg.slowMoScale < 1
      ? Math.max(0, Math.min(1, (1 - this.tutorialScale) / (1 - cfg.slowMoScale)))
      : 0;
    this.source?.setPlaybackRate(rate);
    this.graph?.setTutorialTone(blend, cfg.audioDetuneCents);
  }

  setMusicVolume(value: number): void {
    this.graph?.setMusicVolume(value);
  }

  setMasterVolume(value: number): void {
    const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
    this.masterVolume = clamped;
    this.graph?.setMasterVolume(clamped);
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  setTrackEndFade(remainingSeconds: number, fadeSeconds: number): void {
    if (fadeSeconds <= 0) {
      this.graph?.setTrackEndVolume(1);
      return;
    }
    const multiplier = Math.max(0, Math.min(1, remainingSeconds / fadeSeconds));
    this.graph?.setTrackEndVolume(multiplier);
  }

  triggerPortalJelly(): void {
    this.portalJellyT = 0;
  }

  setMusicMix(
    damageState: DamageState,
    nitroActive: boolean,
    cfg: MusicMixConfig,
    dt = 1 / 60,
    rocket?: {
      active: boolean;
      phase: RocketPhase;
      anticipationFx: number;
      boostPulse: number;
      audio: RocketAudioConfig;
    },
    greenSmashFx = 0,
  ): void {
    if (nitroActive && !this.nitroActivePrev) {
      this.nitroClearElapsed = 0;
    }
    this.nitroActivePrev = nitroActive;

    const woundStress =
      damageState === 'critical'
        ? 1
        : damageState === 'damaged'
          ? cfg.damagedStress
          : 0;

    if (nitroActive) {
      this.nitroClearElapsed += dt;
    } else {
      this.nitroClearElapsed = 0;
    }

    const clearProgress = nitroActive
      ? Math.min(1, this.nitroClearElapsed / Math.max(cfg.clearSeconds, 0.001))
      : 0;
    const targetStress = nitroActive ? woundStress * (1 - clearProgress) : woundStress;

    const rising = targetStress > this.damageStressSmoothed + 0.001;
    const releaseTau = nitroActive && targetStress < this.damageStressSmoothed
      ? Math.max(cfg.clearSeconds / 4.5, cfg.releaseSeconds)
      : cfg.releaseSeconds;
    const tau = rising ? cfg.attackSeconds : releaseTau;
    const alpha = 1 - Math.exp(-dt / Math.max(tau, 0.001));
    this.damageStressSmoothed += (targetStress - this.damageStressSmoothed) * alpha;
    this.graph?.setDamageStress(this.damageStressSmoothed, cfg);

    const needsDamageClear = woundStress > 0.001;
    const nitroBoostTarget = nitroActive
      ? (needsDamageClear ? smoothstep(0.9, 1, clearProgress) : 1)
      : Math.max(0, greenSmashFx * 0.78);
    const nitroAlpha = 1 - Math.exp(-dt / 0.09);
    this.nitroBoostSmoothed +=
      (nitroBoostTarget - this.nitroBoostSmoothed) * nitroAlpha;
    this.graph?.setNitroBoost(this.nitroBoostSmoothed, cfg);

    const rocketCfg = rocket?.audio;
    let targetMuffle = 0;
    let targetTurbo = 0;
    if (rocket?.active && rocketCfg) {
      if (rocket.phase === 'anticipation') {
        targetMuffle = rocketCfg.muffleMax * smoothstep01(rocket.anticipationFx);
      } else if (
        rocket.phase === 'launch' ||
        rocket.phase === 'plateau' ||
        rocket.phase === 'cruise'
      ) {
        targetMuffle = rocketCfg.muffleMax;
        targetTurbo =
          rocket.phase === 'launch'
            ? Math.max(0.92, rocket.boostPulse)
            : rocket.phase === 'plateau'
              ? 0.88
              : 0.78;
      } else if (rocket.phase === 'fall') {
        targetMuffle = 0;
        targetTurbo = Math.max(0, rocket.boostPulse * 0.35);
      }
    }

    const rocketAudioForTau = rocketCfg ?? this.lastRocketAudio;
    const muffleRising = targetMuffle > this.rocketMuffleSmoothed + 0.001;
    const muffleTau = rocketAudioForTau
      ? muffleRising
        ? rocketAudioForTau.muffleAttackSeconds
        : rocketAudioForTau.muffleReleaseSeconds
      : 0.12;
    const turboTau = rocketAudioForTau
      ? targetTurbo > this.rocketTurboSmoothed + 0.001
        ? rocketAudioForTau.turboSnapSeconds
        : rocketAudioForTau.turboReleaseSeconds
      : 0.12;
    const muffleAlpha = 1 - Math.exp(-dt / Math.max(muffleTau, 0.001));
    const turboAlpha = 1 - Math.exp(-dt / Math.max(turboTau, 0.001));
    this.rocketMuffleSmoothed +=
      (targetMuffle - this.rocketMuffleSmoothed) * muffleAlpha;
    this.rocketTurboSmoothed +=
      (targetTurbo - this.rocketTurboSmoothed) * turboAlpha;
    const sampleActive = Boolean(
      rocket?.active && rocket.phase !== 'none',
    );
    if (sampleActive && rocketCfg) {
      this.lastRocketAudio = rocketCfg;
      this.rocketSampleDuckActive = true;
      this.rocketReleaseElapsed = 0;
    } else if (!rocket?.active && this.rocketSampleDuckActive && this.lastRocketAudio) {
      this.rocketReleaseElapsed += dt;
      const releaseCfg = this.lastRocketAudio;
      if (this.rocketReleaseElapsed > releaseCfg.sampleMusicReleaseSeconds * 3.5) {
        this.rocketSampleDuckActive = false;
        this.lastRocketAudio = null;
        this.rocketReleaseElapsed = 0;
      }
    }

    const mixCfg = rocketCfg ?? this.lastRocketAudio;
    const needsRocketMix = Boolean(
      mixCfg && (rocket?.active || this.rocketSampleDuckActive),
    );
    if (needsRocketMix && mixCfg) {
      this.graph?.setRocketMix(
        this.rocketMuffleSmoothed,
        this.rocketTurboSmoothed,
        sampleActive,
        mixCfg,
      );
    } else if (!this.rocketSampleDuckActive) {
      this.graph?.setRocketMix(0, 0, false, {
        muffleMax: 0,
        muffleMinHz: 320,
        muffleAttackSeconds: 0.2,
        muffleReleaseSeconds: 0.2,
        turboShelfGainDb: 0,
        turboGainBoost: 0,
        turboSnapSeconds: 0.05,
        turboReleaseSeconds: 0.2,
        sampleMusicGain: 1,
        sampleMusicAttackSeconds: 0.55,
        sampleMusicReleaseSeconds: 0.75,
      });
    }

    if (this.portalJellyT >= 0) {
      this.portalJellyT += dt;
      const progress = Math.min(1, this.portalJellyT / 0.24);
      const amount = Math.exp(-progress * 5.2) * (1 - progress * 0.28);
      this.graph?.setPortalJelly(amount);
      if (progress >= 1) this.portalJellyT = -1;
    } else {
      this.graph?.setPortalJelly(0);
    }
  }

  dispose(): void {
    this.sfxEngine?.dispose();
    this.sfxEngine = null;
    this.sfxDirector?.reset();
    this.levelSamples?.dispose();
    this.levelSamples = null;
    this.setTutorialPlaybackScale(1);
    this.source?.dispose();
    this.source = null;
    this.sourceConnected = false;
    this.analyzer?.stop();
    this.analyzer = null;
    this.graph?.dispose();
    this.graph = null;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.clock = null;
    this.ready = false;
    this.playing = false;
    this.damageStressSmoothed = 0;
    this.nitroBoostSmoothed = 0;
    this.rocketMuffleSmoothed = 0;
    this.rocketTurboSmoothed = 0;
    this.nitroClearElapsed = 0;
    this.nitroActivePrev = false;
    this.portalJellyT = -1;
  }

  private ensureContext(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.clock = new AudioClock(this.ctx, this.config.latencyOffsetMs / 1000);
    }
  }

  private async loadFromSource(
    fileName: string,
    load: (source: VideoFileAudioSource) => Promise<void>,
  ): Promise<void> {
    this.resetSfx();
    this.pause();
    this.ready = false;
    this.loadedFileName = fileName;
    this.ensureContext();
    if (!this.source) this.source = new VideoFileAudioSource();
    await load(this.source);
    this.clock = new AudioClock(this.source, this.config.latencyOffsetMs / 1000);
    this.ensurePipeline();
    await this.analyzer!.start(this.graph!.musicBus, this.clock!);
    this.setTutorialPlaybackScale(this.tutorialScale);
    if (!this.sourceConnected) {
      const node = this.source.connect(this.ctx!);
      node.connect(this.graph!.musicBus);
      this.sourceConnected = true;
    }
    await this.resume();
    this.ready = true;
    this.setVideoDisplayMode(this.displayMode);
    this.preloadLevelSamples();
  }

  private ensurePipeline(): void {
    if (!this.graph || !this.analyzer) {
      this.graph = new AudioGraph(this.ctx!);
      this.graph.setMasterVolume(this.masterVolume);
      this.analyzer = new AudioWorkletAnalyzer(this.ctx!, this.config);

    }
  }

  private async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(edge1 - edge0, 1e-6)));
  return t * t * (3 - 2 * t);
}

function smoothstep01(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function emptyMusicState(): MusicState {
  return {
    audioTime: 0,
    energy: { value: 0, audioTime: 0 },
    beat: { value: false, audioTime: 0 },
    brightness: { value: 0, audioTime: 0 },
    silence: { value: false, audioTime: 0 },
  };
}

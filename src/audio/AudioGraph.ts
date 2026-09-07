export interface DamageAudioConfig {
  maxWet: number;
  minHz: number;
  maxGainReduction: number;
  attackSeconds: number;
  releaseSeconds: number;
  damagedStress: number;
}

export interface NitroAudioConfig {
  clearSeconds: number;
  shelfGainDb: number;
  shelfFrequencyHz: number;
  gainBoost: number;
}

export interface RocketAudioConfig {
  muffleMax: number;
  muffleMinHz: number;
  muffleAttackSeconds: number;
  muffleReleaseSeconds: number;
  turboShelfGainDb: number;
  turboGainBoost: number;
  turboSnapSeconds: number;
  turboReleaseSeconds: number;
  sampleMusicGain: number;
  sampleMusicAttackSeconds: number;
  sampleMusicReleaseSeconds: number;
}

export type MusicMixConfig = DamageAudioConfig & NitroAudioConfig;

export class AudioGraph {
  readonly musicBus: GainNode;
  readonly sfxBus: GainNode;
  readonly rocketSampleBus: GainNode;
  readonly master: DynamicsCompressorNode;
  readonly outputGain: GainNode;
  readonly analyserIn: GainNode;
  private readonly damageFilter: BiquadFilterNode;
  private readonly rocketMuffleFilter: BiquadFilterNode;
  private readonly rocketTurboShelf: BiquadFilterNode;
  private readonly rocketTurboGain: GainNode;
  private readonly nitroShelf: BiquadFilterNode;
  private readonly nitroGain: GainNode;
  private readonly portalJellyFilter: BiquadFilterNode;
  private readonly musicMasterGain: GainNode;
  private readonly trackEndGain: GainNode;
  private readonly tutorialShelf: BiquadFilterNode;
  private readonly sfxDamageFilter: BiquadFilterNode;
  private readonly sfxDamageGain: GainNode;
  private readonly rocketDamageFilter: BiquadFilterNode;
  private readonly rocketDamageGain: GainNode;
  private damageMusicGain = 1;

  constructor(private readonly ctx: AudioContext) {
    this.musicBus = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.rocketSampleBus = this.ctx.createGain();
    this.rocketSampleBus.gain.value = 1;
    this.analyserIn = this.ctx.createGain();
    this.damageFilter = this.ctx.createBiquadFilter();
    this.damageFilter.type = 'lowpass';
    this.damageFilter.frequency.value = 20000;
    this.damageFilter.Q.value = 0.7;
    this.rocketMuffleFilter = this.ctx.createBiquadFilter();
    this.rocketMuffleFilter.type = 'lowpass';
    this.rocketMuffleFilter.frequency.value = 20000;
    this.rocketMuffleFilter.Q.value = 0.85;
    this.rocketTurboShelf = this.ctx.createBiquadFilter();
    this.rocketTurboShelf.type = 'highshelf';
    this.rocketTurboShelf.frequency.value = 2800;
    this.rocketTurboShelf.gain.value = 0;
    this.rocketTurboGain = this.ctx.createGain();
    this.rocketTurboGain.gain.value = 1;
    this.nitroShelf = this.ctx.createBiquadFilter();
    this.nitroShelf.type = 'highshelf';
    this.nitroShelf.frequency.value = 2600;
    this.nitroShelf.gain.value = 0;
    this.nitroGain = this.ctx.createGain();
    this.nitroGain.gain.value = 1;
    this.portalJellyFilter = this.ctx.createBiquadFilter();
    this.portalJellyFilter.type = 'lowpass';
    this.portalJellyFilter.frequency.value = 20000;
    this.portalJellyFilter.Q.value = 0.9;
    this.musicMasterGain = this.ctx.createGain();
    this.musicMasterGain.gain.value = 1;
    this.tutorialShelf = this.ctx.createBiquadFilter();
    this.tutorialShelf.type = 'highshelf';
    this.tutorialShelf.frequency.value = 3200;
    this.tutorialShelf.gain.value = 0;
    this.sfxDamageFilter = this.ctx.createBiquadFilter();
    this.sfxDamageFilter.type = 'lowpass';
    this.sfxDamageFilter.frequency.value = 20000;
    this.sfxDamageFilter.Q.value = 0.7;
    this.sfxDamageGain = this.ctx.createGain();
    this.sfxDamageGain.gain.value = 1;
    this.rocketDamageFilter = this.ctx.createBiquadFilter();
    this.rocketDamageFilter.type = 'lowpass';
    this.rocketDamageFilter.frequency.value = 20000;
    this.rocketDamageFilter.Q.value = 0.7;
    this.rocketDamageGain = this.ctx.createGain();
    this.rocketDamageGain.gain.value = 1;
    this.trackEndGain = this.ctx.createGain();
    this.trackEndGain.gain.value = 1;
    this.master = this.ctx.createDynamicsCompressor();
    this.master.threshold.value = -1;
    this.master.knee.value = 0;
    this.master.ratio.value = 20;
    this.master.attack.value = 0.003;
    this.master.release.value = 0.25;

    this.musicBus.connect(this.analyserIn);
    this.musicBus.connect(this.damageFilter);
    this.damageFilter.connect(this.rocketMuffleFilter);
    this.rocketMuffleFilter.connect(this.rocketTurboShelf);
    this.rocketTurboShelf.connect(this.rocketTurboGain);
    this.rocketTurboGain.connect(this.nitroShelf);
    this.nitroShelf.connect(this.nitroGain);
    this.nitroGain.connect(this.portalJellyFilter);
    this.portalJellyFilter.connect(this.musicMasterGain);
    this.musicMasterGain.connect(this.trackEndGain);
    this.trackEndGain.connect(this.tutorialShelf);
    this.tutorialShelf.connect(this.master);
    this.sfxBus.connect(this.sfxDamageFilter);
    this.sfxDamageFilter.connect(this.sfxDamageGain);
    this.sfxDamageGain.connect(this.master);
    this.rocketSampleBus.connect(this.rocketDamageFilter);
    this.rocketDamageFilter.connect(this.rocketDamageGain);
    this.rocketDamageGain.connect(this.master);
    this.outputGain = this.ctx.createGain();
    this.outputGain.gain.value = 1;
    this.master.connect(this.outputGain);
    this.outputGain.connect(this.ctx.destination);
  }

  setTutorialTone(blend: number, detuneCents: number): void {
    const now = this.ctx.currentTime;
    this.tutorialShelf.detune.setTargetAtTime(detuneCents * blend, now, 0.02);
    this.tutorialShelf.gain.setTargetAtTime(-3 * blend, now, 0.02);
  }

  setMusicVolume(value: number): void {
    this.musicBus.gain.value = value;
  }

  setMasterVolume(value: number): void {
    const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
    this.outputGain.gain.value = clamped;
  }

  setTrackEndVolume(multiplier: number): void {
    const clamped = Math.max(0, Math.min(1, multiplier));
    const now = this.ctx.currentTime;
    this.trackEndGain.gain.setTargetAtTime(clamped, now, 0.08);
  }

  setDamageStress(stress: number, cfg: DamageAudioConfig): void {
    const clamped = Math.max(0, Math.min(1, stress));
    const freq =
      clamped <= 0
        ? 20000
        : Math.exp(
            Math.log(Math.max(80, cfg.minHz)) * clamped +
              Math.log(20000) * (1 - clamped),
          );
    const now = this.ctx.currentTime;
    const filterTau = clamped > 0 ? cfg.attackSeconds * 0.55 : cfg.releaseSeconds;
    const gainTau = clamped > 0 ? cfg.attackSeconds * 0.5 : cfg.releaseSeconds * 0.85;
    this.damageFilter.frequency.setTargetAtTime(freq, now, filterTau);
    this.damageFilter.Q.setTargetAtTime(0.7 + clamped * 1.35, now, filterTau);
    this.sfxDamageFilter.frequency.setTargetAtTime(freq, now, filterTau);
    this.sfxDamageFilter.Q.setTargetAtTime(0.7 + clamped * 1.35, now, filterTau);
    this.rocketDamageFilter.frequency.setTargetAtTime(freq, now, filterTau);
    this.rocketDamageFilter.Q.setTargetAtTime(0.7 + clamped * 1.35, now, filterTau);
    this.damageMusicGain = 1 - clamped * cfg.maxGainReduction;
    this.musicMasterGain.gain.setTargetAtTime(
      this.damageMusicGain,
      now,
      gainTau,
    );
    this.sfxDamageGain.gain.setTargetAtTime(this.damageMusicGain, now, gainTau);
    this.rocketDamageGain.gain.setTargetAtTime(this.damageMusicGain, now, gainTau);
  }

  setRocketMix(
    muffle: number,
    turbo: number,
    sampleActive: boolean,
    cfg: RocketAudioConfig,
  ): void {
    const muffleClamped = Math.max(0, Math.min(1, muffle));
    const turboClamped = Math.max(0, Math.min(1, turbo));
    const now = this.ctx.currentTime;
    const muffleFreq = muffleClamped <= 0 ? 20000 : Math.exp(
      Math.log(Math.max(80, cfg.muffleMinHz)) * muffleClamped + Math.log(20000) * (1 - muffleClamped),
    );
    const muffleTau = muffleClamped > 0 ? cfg.muffleAttackSeconds : cfg.muffleReleaseSeconds;
    const turboTau = turboClamped > 0 ? cfg.turboSnapSeconds * 0.35 : cfg.turboReleaseSeconds;
    this.rocketMuffleFilter.frequency.setTargetAtTime(muffleFreq, now, muffleTau);
    this.rocketMuffleFilter.Q.setTargetAtTime(0.85 + muffleClamped * 1.1, now, muffleTau);
    this.rocketTurboShelf.gain.setTargetAtTime(turboClamped * cfg.turboShelfGainDb, now, turboTau);
    this.rocketTurboGain.gain.setTargetAtTime(1 + turboClamped * cfg.turboGainBoost, now, turboTau);
    const rocketMusicGain = sampleActive ? cfg.sampleMusicGain : 1;
    const musicTau = sampleActive
      ? Math.max(muffleTau, turboTau, cfg.sampleMusicAttackSeconds)
      : Math.max(muffleTau, turboTau, cfg.sampleMusicReleaseSeconds);
    this.musicMasterGain.gain.setTargetAtTime(
      this.damageMusicGain * rocketMusicGain,
      now,
      musicTau,
    );
  }

  setNitroBoost(boost: number, cfg: NitroAudioConfig): void {
    const clamped = Math.max(0, Math.min(1, boost));
    const now = this.ctx.currentTime;
    this.nitroShelf.frequency.setTargetAtTime(cfg.shelfFrequencyHz, now, 0.12);
    this.nitroShelf.gain.setTargetAtTime(clamped * cfg.shelfGainDb, now, 0.08);
    this.nitroGain.gain.setTargetAtTime(1 + clamped * cfg.gainBoost, now, 0.08);
  }

  setPortalJelly(amount: number): void {
    const clamped = Math.max(0, Math.min(1, amount));
    const now = this.ctx.currentTime;
    const freq = clamped <= 0
      ? 20000
      : Math.exp(Math.log(1400) * clamped + Math.log(20000) * (1 - clamped));
    const tau = clamped > 0.05 ? 0.03 : 0.08;
    this.portalJellyFilter.frequency.setTargetAtTime(freq, now, tau);
    this.portalJellyFilter.Q.setTargetAtTime(0.9 + clamped * 0.7, now, tau);
  }

  dispose(): void {
    this.musicBus.disconnect();
    this.sfxBus.disconnect();
    this.rocketSampleBus.disconnect();
    this.analyserIn.disconnect();
    this.damageFilter.disconnect();
    this.rocketMuffleFilter.disconnect();
    this.rocketTurboShelf.disconnect();
    this.rocketTurboGain.disconnect();
    this.nitroShelf.disconnect();
    this.nitroGain.disconnect();
    this.portalJellyFilter.disconnect();
    this.musicMasterGain.disconnect();
    this.trackEndGain.disconnect();
    this.tutorialShelf.disconnect();
    this.sfxDamageFilter.disconnect();
    this.sfxDamageGain.disconnect();
    this.rocketDamageFilter.disconnect();
    this.rocketDamageGain.disconnect();
    this.master.disconnect();
    this.outputGain.disconnect();
  }
}

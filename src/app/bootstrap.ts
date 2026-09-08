import { GameContext } from './GameContext';
import { GameLoop } from './GameLoop';
import { isTutorialRampFlight, TutorialController } from '@core/tutorial/TutorialController';
import type { TutorialSnapshot } from '@core/tutorial/TutorialController';
import { TutorialStorage } from './TutorialStorage';
import { GameScene } from '@render/GameScene';
import { createConfigStore } from '@core/config/ConfigLoader';
import type { ConfigStore } from '@core/config/ConfigStore';
import type { LevelgenConfig } from '@core/config/schemas';
import {
  getLevelgenPresetMeta,
  isLevelgenPresetId,
  levelgenPresetUiLabel,
  listLevelgenPresetsForUi,
  resolveBootLevelgenPresetId,
  resolveLevelgenPreset,
  storeLevelgenPresetId,
  type LevelgenPresetId,
} from '@core/config/levelgenPresets';
import {
  ADRENALINE_PRESETS,
  getAdrenalinePresetMeta,
  isAdrenalinePresetId,
  resolveBootAdrenalinePresetId,
  resolveGameWithAdrenalinePreset,
  storeAdrenalinePresetId,
  type AdrenalinePresetId,
} from '@core/config/adrenalinePresets';
import {
  GAMEPLAY_RULES_PRESETS,
  isGameplayRulesId,
  loadStoredGameplayRulesId,
  storeGameplayRulesId,
  type GameplayRulesId,
} from '@core/gameplay/gameplayRules';
import { isDevUiEnabled } from '@app/devUi';
import { installConfigHotUpdate } from '@app/configHotReload';
import { ActiveDirector } from '@core/director/ActiveDirector';
import { GameSim } from '@core/gameplay/GameSim';
import type { GameSnapshot } from '@core/gameplay/GameSim';
import type { MusicState } from '@core/state/MusicState';
import { AudioSession } from '@audio/AudioSession';
import { InputAdapter } from '@input/InputAdapter';
import { InputBuffer } from '@input/InputBuffer';
import { ReplayRecorder } from '@core/replay/ReplayRecorder';
import { ReplayRunner } from '@core/replay/ReplayRunner';
import type { ReplayData } from '@core/replay/ReplayTypes';
import { AudioControls } from '@ui/AudioControls';
import { DebugOverlay } from '@ui/DebugOverlay';
import { EventTimeline } from '@ui/EventTimeline';
import { HUD } from '@ui/HUD';
import { MainMenu } from '@ui/MainMenu';
import { showToast } from '@ui/toast';
import { createFxSwitches } from '@app/fxSwitches';
import {
  CAMERA_PRESET_OPTIONS,
  createVisualLabSettings,
  isCameraPresetId,
} from '@app/visualLab';
import { PlaytestRecorder } from '@app/playtest/PlaytestRecorder';
import { APP_BUILD_SEQ, APP_BUILD_VERSION } from '@app/buildInfo';
import { fetchBundledTracks, type BundledTrack } from '@app/bundledTracks';
import { loadStoredMasterVolume, storeMasterVolume } from '@app/masterVolume';
import {
  attachSurveyToSession,
  clearPlaytestSessions,
  countPlaytestSessions,
  downloadPlaytestSessionsExport,
  listPlaytestSessions,
  savePlaytestSession,
} from '@app/playtest/playtestStore';
import { parseTrackMeta } from '@core/playtest/parseTrackMeta';
import { FpsTracker } from '@core/playtest/fpsStats';
import { PLAYTEST_SURVEY_CONFIG } from '@core/playtest/surveyConfig';
import type { PlaytestSurveyAnswers } from '@core/playtest/surveyConfig';
import type { PlaytestSessionFile } from '@core/playtest/types';
import { EndRunPanel } from '@ui/EndRunPanel';
import type { RunResults } from '@ui/HUD';
import { levelIntroCountdownLabel } from '@core/gameplay/levelIntro';

export const CONFIG_KEY = 'config';
export const SCENE_KEY = 'scene';
export const LOOP_KEY = 'loop';
export const AUDIO_KEY = 'audio';

export interface AppServices {
  context: GameContext;
  config: ConfigStore;
  scene: GameScene;
  loop: GameLoop;
  sim: GameSim;
  audio: AudioSession;
}

export function bootstrap(container: HTMLElement): AppServices {
  const context = new GameContext();

  const config = createConfigStore();
  for (const bootError of config.bootErrors) {
    showToast(`config '${bootError.key}' is invalid, using fallback`, 'error');
  }
  context.provide(CONFIG_KEY, config);

  const gameCfg = config.get('game');
  const devUi = isDevUiEnabled();
  let activeLevelgenPresetId = resolveBootLevelgenPresetId(devUi);
  const resolveActiveLevelgen = (): LevelgenConfig =>
    resolveLevelgenPreset(activeLevelgenPresetId, config.get('levelgen'));
  let levelgenCfg = resolveActiveLevelgen();
  let activeGameplayRulesId = loadStoredGameplayRulesId();
  let activeAdrenalinePresetId = resolveBootAdrenalinePresetId(devUi);
  const resolveActiveGame = () =>
    resolveGameWithAdrenalinePreset(activeAdrenalinePresetId, config.get('game'));
  let resolvedGameCfg = resolveActiveGame();
  const directorCfg = config.get('director');
  const audioCfg = config.get('audio');

  const inputBuffer = new InputBuffer(gameCfg.input.bufferMs);
  const inputAdapter = new InputAdapter(inputBuffer);
  void inputAdapter;
  const director = new ActiveDirector(directorCfg);

  const recorder = new ReplayRecorder();
  const playtest = new PlaytestRecorder();
  const fpsTracker = new FpsTracker();
  const endRunPanel = new EndRunPanel(container);
  let pendingPlaytestDraft: Omit<PlaytestSessionFile, 'survey' | 'context'> | null = null;
  let lastRunResults: RunResults | null = null;
  let lastEndReason: 'death' | 'song_end' | null = null;
  let storedPlaytestCount = 0;
  let lastFpsStats = fpsTracker.finish();
  let lastReplay: ReplayData | null = null;
  let playback: { snapshots: GameSnapshot[]; startedAt: number } | null = null;
  let runPhase: RunPhase = 'menu';
  let gameOverRestartAllowedAt = 0;
  const GAME_OVER_RESTART_DELAY_MS = 2000;
  let countdownSequence = 0;
  let introMusicStarted = false;
  let introGoHideTimer: number | null = null;

  const musicPlanningEnabled = resolvedGameCfg.musicPlanning.enabled && new URLSearchParams(location.search).get('music') !== 'legacy';
  const requestedSeed = new URLSearchParams(location.search).get('seed');
  const sim = new GameSim({
    musicPlanningEnabled,
    seed: requestedSeed !== null && /^\d+$/.test(requestedSeed) ? Number(requestedSeed) >>> 0 : undefined,
    game: resolvedGameCfg,
    levelgen: levelgenCfg,
    gameplayRules: activeGameplayRulesId,
    director,
    consumeInput: (now) => {
      if (runPhase !== 'running') return [];
      const actions = inputBuffer.consume(now);
      if (recorder.isRecording) {
        const tMs = sim.playerSim.state.gameTime * 1000;
        for (const action of actions) recorder.recordInput(tMs, action);
      }
      return actions;
    },
    nowMs: () => performance.now(),
    getSongProgress: () =>
      audio.trackDuration > 0 ? audio.trackTime / audio.trackDuration : 0,
    getTrackTime: () => audio.trackTime,
    getTrackDuration: () => audio.trackDuration,
    onPlaytestEvent: (event) => playtest.push(event),
    getMusic: () => {
      const music = audio.isPlaying ? audio.getMusicState() : neutralMusic();
      if (recorder.isRecording) recorder.recordMusic(sim.playerSim.state.gameTime, music);
      return music;
    },
  });

  const fxSwitches = createFxSwitches();
  const visualLab = createVisualLabSettings();

  const scene = new GameScene(
    container,
    {
      fov: gameCfg.camera.fov,
      positionY: gameCfg.camera.positionY,
      positionZ: gameCfg.camera.positionZ,
      lookY: gameCfg.camera.lookY,
      positionYFollow: gameCfg.camera.positionYFollow,
      lookYFollow: gameCfg.camera.lookYFollow,
    },
    gameCfg,
    levelgenCfg,
    fxSwitches,
    visualLab,
  );
  context.provide(SCENE_KEY, scene);
  scene.setPlayerHidden(true);
  sim.setGhost(true);

  const audio = new AudioSession(audioCfg, resolvedGameCfg.tutorial);
  audio.configureMusicPlanning({ ...resolvedGameCfg.musicPlanning, enabled: musicPlanningEnabled });
  audio.configureSfx(config.get('sfx'));
  audio.setMasterVolume(loadStoredMasterVolume());
  sim.sfxEvents.setCapacity(config.get('sfx').queueCapacity);
  const tutorialStorage = new TutorialStorage();
  const tutorial = new TutorialController(resolvedGameCfg, tutorialStorage.load());
  sim.setSkillMomentumEligible(tutorial.status === 'veteran');
  let tutorialIntent = tutorial.suspend();
  let tutorialSnapshot: TutorialSnapshot | undefined;
  let tutorialMode = sim.playerSim.state.mode;
  context.provide(AUDIO_KEY, audio);
  let audioControls: AudioControls;
  let mainMenu: MainMenu;
  const applyLevelgenPreset = (id: LevelgenPresetId): void => {
    if (id === activeLevelgenPresetId) return;
    activeLevelgenPresetId = id;
    storeLevelgenPresetId(id);
    levelgenCfg = resolveActiveLevelgen();
    sim.applyLevelgen(levelgenCfg);
    scene.setLevelgen(levelgenCfg);
    audioControls.setLevelgenPresetId(id);
    showToast(`генератор: ${getLevelgenPresetMeta(id).label}`, 'success');
    if (audio.isReady) {
      void startSongRun();
      return;
    }
    restartSimulation();
    scene.reset();
    hud.resetRun();
  };
  const applyAdrenalinePreset = (id: AdrenalinePresetId): void => {
    if (id === activeAdrenalinePresetId) return;
    activeAdrenalinePresetId = id;
    storeAdrenalinePresetId(id);
    resolvedGameCfg = resolveActiveGame();
    sim.applyAdrenalineConfig(resolvedGameCfg.adrenaline);
    audioControls.setAdrenalinePresetId(id);
    showToast(`адреналин: ${getAdrenalinePresetMeta(id).label}`, 'success');
    if (audio.isReady) {
      void startSongRun();
      return;
    }
    restartSimulation();
    scene.reset();
    hud.resetRun();
  };
  const applyGameplayRules = (id: GameplayRulesId): void => {
    if (id === activeGameplayRulesId) return;
    activeGameplayRulesId = id;
    storeGameplayRulesId(id);
    sim.setGameplayRules(id);
    audioControls.setGameplayRulesId(id);
    const label =
      GAMEPLAY_RULES_PRESETS.find((preset) => preset.id === id)?.label ?? id;
    showToast(`режим: ${label}`, 'success');
    if (audio.isReady) {
      void startSongRun();
      return;
    }
    restartSimulation();
    scene.reset();
    hud.resetRun();
  };
  const hud = new HUD(container, {
    showRunCounters: devUi,
    getMasterVolume: () => audio.getMasterVolume(),
    onMasterVolumeChange: (value) => {
      applyMasterVolume(value);
    },
    onPause: () => {
      if (runPhase === 'running' && !playback) pauseRun();
    },
    onResume: () => {
      void resumeRun();
    },
    onRestart: () => {
      void startSongRun();
    },
    onChooseFile: () => {
      enterMenu();
    },
  });
  hud.setHidden(true);
  const applyVideoDisplayMode = (): void => {
    audio.setVideoDisplayMode('horizon');
    scene.setHorizonVideo(audio.getVideoElement(), true);
  };

  audioControls = new AudioControls(container, audio, {
    visible: devUi,
    onExportPlaytests: () => {
      void exportPlaytestLogs();
    },
    getPlaytestLogCount: () => storedPlaytestCount,
    getLogActive: () => playtest.isRecording,
    getLogEventCount: () => playtest.eventCount,
    levelgenPresets: listLevelgenPresetsForUi(devUi).map((preset) => ({
      id: preset.id,
      label: levelgenPresetUiLabel(preset, devUi),
    })),
    getLevelgenPresetId: () => activeLevelgenPresetId,
    onLevelgenPresetChange: (id) => {
      if (!isLevelgenPresetId(id)) {
        showToast(`неизвестный пресет: ${id}`, 'error');
        audioControls.setLevelgenPresetId(activeLevelgenPresetId);
        return;
      }
      applyLevelgenPreset(id);
    },
    gameplayRules: devUi
      ? GAMEPLAY_RULES_PRESETS.map((preset) => ({
          id: preset.id,
          label: preset.label,
        }))
      : undefined,
    getGameplayRulesId: () => activeGameplayRulesId,
    onGameplayRulesChange: (id) => {
      if (!isGameplayRulesId(id)) {
        showToast(`неизвестный режим: ${id}`, 'error');
        audioControls.setGameplayRulesId(activeGameplayRulesId);
        return;
      }
      applyGameplayRules(id);
    },
    adrenalinePresets: devUi
      ? ADRENALINE_PRESETS.map((preset) => ({
          id: preset.id,
          label: `dev: ${preset.label}`,
        }))
      : undefined,
    getAdrenalinePresetId: () => activeAdrenalinePresetId,
    onAdrenalinePresetChange: (id) => {
      if (!isAdrenalinePresetId(id)) {
        showToast(`неизвестный пресет адреналина: ${id}`, 'error');
        audioControls.setAdrenalinePresetId(activeAdrenalinePresetId);
        return;
      }
      applyAdrenalinePreset(id);
    },
    cameraPresets: devUi
      ? CAMERA_PRESET_OPTIONS.map((preset) => ({
          id: preset.id,
          label: preset.label,
        }))
      : undefined,
    getCameraPresetId: () => visualLab.cameraPresetId,
    onCameraPresetChange: (id) => {
      if (!isCameraPresetId(id)) {
        showToast(`неизвестный пресет камеры: ${id}`, 'error');
        audioControls.setCameraPresetId(visualLab.cameraPresetId);
        return;
      }
      scene.setCameraPreset(id);
      audioControls.setCameraPresetId(id);
      showToast(`камера: ${CAMERA_PRESET_OPTIONS.find((p) => p.id === id)?.label ?? id}`, 'success');
    },
    getContactShadowEnabled: devUi ? () => visualLab.contactShadow : undefined,
    onContactShadowChange: devUi
      ? (enabled) => {
          scene.setContactShadowEnabled(enabled);
        }
      : undefined,
    onLoaded: async () => {
      applyVideoDisplayMode();
      leaveMenu();
      audioControls.setStatus('countdown');
      await startSongRun();
    },
    onLoadStart: () => {
      enterMenu();
      mainMenu.setBusy(true, 'Загружаем трек…');
    },
    onError: (message) => {
      if (mainMenu.isOpen) mainMenu.setError(message);
    },
    onPlayRequested: async () => {
      if (runPhase === 'paused') {
        await resumeRun();
      } else {
        await audio.play();
      }
    },
  });
  applyVideoDisplayMode();
  mainMenu = new MainMenu(container, {
    volume: audio.getMasterVolume(),
    onVolumeChange: (value) => {
      applyMasterVolume(value);
    },
    onSelectTrack: (track) => {
      void startBundledTrack(track);
    },
    onPickFile: () => {
      audioControls.openFilePicker();
    },
  });
  void fetchBundledTracks().then((tracks) => {
    mainMenu.setTracks(tracks);
  });
  const noviceButton = document.createElement('button');
  noviceButton.type = 'button';
  noviceButton.textContent = 'новичок';
  noviceButton.style.cssText =
    'position:fixed;bottom:12px;left:16px;z-index:30;pointer-events:auto;cursor:pointer;' +
    'font:12px/1.2 monospace;color:#cfe;background:rgba(0,0,0,.55);' +
    'border:1px solid #60786d;border-radius:4px;padding:5px 8px;';
  noviceButton.addEventListener('click', () => {
    tutorialStorage.save('novice');
    tutorial.resetRun('novice', tutorialSnapshot);
    tutorialIntent = tutorial.suspend();
    audio.setTutorialPlaybackScale(1);
    noviceButton.blur();
  });
  container.appendChild(noviceButton);
  if (!devUi) noviceButton.style.display = 'none';
  installConfigHotUpdate(config, {
    onUpdate: (key, applied) => {
      if (key === 'sfx' && applied) {
        audio.configureSfx(config.get('sfx'));
        sim.sfxEvents.setCapacity(config.get('sfx').queueCapacity);
      }
      showToast(`config '${key}': ${applied ? 'applied' : 'rejected'}`, applied ? 'success' : 'error');
      if (key === 'levelgen' && applied) {
        levelgenCfg = resolveActiveLevelgen();
        sim.applyLevelgen(levelgenCfg);
        scene.setLevelgen(levelgenCfg);
        restartSimulation();
        scene.reset();
        hud.resetRun();
      }
      if (key === 'game' && applied) {
        resolvedGameCfg = resolveActiveGame();
        tutorial.setConfig(resolvedGameCfg);
        audio.setTutorialConfig(resolvedGameCfg.tutorial);
        sim.applyAdrenalineConfig(resolvedGameCfg.adrenaline);
        restartSimulation();
        scene.reset();
        hud.resetRun();
      }
    },
  });
  const overlay = new DebugOverlay(container, config.get('debug').overlay, fxSwitches);
  const timeline = new EventTimeline(container, config.get('debug').timeline.zoomSecondsPerScreen);

  window.addEventListener('keydown', (e) => {
    if (runPhase === 'menu') return;
    if (e.code === 'Escape') {
      e.preventDefault();
      if (endRunPanel.isBlocking) {
        dismissEndRunSurvey();
        return;
      }
      if (runPhase === 'running' && !playback) {
        pauseRun();
      } else if (runPhase === 'paused') {
        void resumeRun();
      }
      return;
    }
    if (runPhase === 'gameOver') {
      if (endRunPanel.isBlocking) return;
      if (performance.now() < gameOverRestartAllowedAt) return;
      if (audio.isReady) {
        void startSongRun();
      } else {
        restartSimulation();
        scene.reset();
        hud.resetRun();
        runPhase = 'running';
      }
      return;
    }
    if (runPhase !== 'running') return;
    if (e.code === 'KeyR' && !e.shiftKey) {
      if (recorder.isRecording) {
        lastReplay = recorder.finish(sim.playerSim.state.gameTime);
        showToast(lastReplay ? `replay recorded (${lastReplay.durationSeconds.toFixed(1)}s)` : 'replay empty');
      } else {
        restartSimulation();
        scene.reset();
        recorder.start(sim.seed, audio.trackDuration, { musicPlanningEnabled, gameplayRules: activeGameplayRulesId });
        showToast('recording… (R to stop)');
      }
    } else if (e.code === 'KeyR' && e.shiftKey) {
      if (recorder.isRecording) {
        lastReplay = recorder.finish(sim.playerSim.state.gameTime);
      }
      if (!lastReplay) {
        showToast('no replay recorded');
        return;
      }
      const runner = new ReplayRunner({
        game: gameCfg,
        levelgen: levelgenCfg,
        director: new ActiveDirector(directorCfg),
      });
      const snapshots = runner.run(lastReplay);
      if (snapshots.length === 0) {
        showToast('replay is empty');
        return;
      }
      scene.reset();
      playback = { snapshots, startedAt: performance.now() };
      tutorialIntent = tutorial.suspend();
      audio.setTutorialPlaybackScale(1);
      showToast(`replay ${(snapshots.length / 60).toFixed(1)}s`);
    }
  });

  audio.onPreparationProgress = message => { if (mainMenu.isOpen) mainMenu.setBusy(true, message); };
  const loop = new GameLoop({
    fixedUpdate: (dt) => {
      if (musicPlanningEnabled && runPhase === 'countdown' && !sim.isLevelIntroActive()) return;
      if (!playback && (runPhase === 'running' || runPhase === 'countdown' || runPhase === 'menu')) {
        const mode = sim.playerSim.state.mode;
        if (mode !== tutorialMode || sim.gameOver || isTutorialRampFlight(sim.playerSim.state)) {
          tutorialIntent = tutorial.suspend();
          audio.setTutorialPlaybackScale(1);
          tutorialMode = mode;
        }
        sim.fixedUpdate(dt * tutorialIntent.timeScale);
      }
    },
    variableUpdate: (dt) => {
      const music = audio.getMusicState();
      let snapshot: GameSnapshot;
      let replayTag = '';

      if (playback) {
        const elapsed = (performance.now() - playback.startedAt) / 1000;
        const index = Math.min(playback.snapshots.length - 1, Math.floor(elapsed * 60));
        snapshot = playback.snapshots[index];
        if (elapsed * 60 >= playback.snapshots.length) {
          playback = null;
          restartSimulation();
          scene.reset();
        }
        replayTag = 'play';
      } else {
        snapshot = sim.getSnapshot();
      }

      const previousTutorialStatus = tutorial.status;
      if (replayTag !== 'play') tutorialSnapshot = snapshot;
      if (replayTag !== 'play' && runPhase === 'countdown') {
        const introCfg = resolvedGameCfg.levelIntro;
        const elapsed = sim.getLevelIntroElapsed();
        const label = levelIntroCountdownLabel(elapsed, introCfg);
        hud.showCountdown(label);
        if (!musicPlanningEnabled && elapsed >= introCfg.musicDelaySeconds && !introMusicStarted) {
          introMusicStarted = true;
          void audio.restart();
        }
        if (musicPlanningEnabled && elapsed >= introCfg.countdownSeconds && !introMusicStarted) {
          introMusicStarted = true;
          const sequence = countdownSequence;
          void audio.play().then(() => {
            if (sequence !== countdownSequence || runPhase !== 'countdown') return;
            runPhase = 'running';
            beginPlaytestRecording();
            fpsTracker.reset();
            audioControls.setStatus('playing');
            hud.showCountdown(null);
          }).catch(() => {
            if (sequence !== countdownSequence) return;
            enterMenu();
            mainMenu.setError('Нажмите на трек ещё раз, чтобы разрешить воспроизведение');
          });
        }
        if (!musicPlanningEnabled && elapsed >= introCfg.countdownSeconds) {
          runPhase = 'running';
          beginPlaytestRecording();
          fpsTracker.reset();
          lastFpsStats = fpsTracker.finish();
          audioControls.setStatus('playing');
          if (introGoHideTimer !== null) window.clearTimeout(introGoHideTimer);
          introGoHideTimer = window.setTimeout(() => {
            introGoHideTimer = null;
            if (runPhase === 'running') hud.showCountdown(null);
          }, 550);
        }
      }

      if (replayTag !== 'play' && runPhase === 'running') {
        tutorialIntent = tutorial.update(snapshot, dt);
      } else if (runPhase !== 'paused' || replayTag === 'play') {
        tutorialIntent = tutorial.suspend();
      }
      tutorialMode = snapshot.player.mode;
      if (previousTutorialStatus !== tutorial.status) tutorialStorage.save(tutorial.status);
      sim.setSkillMomentumEligible(tutorial.status === 'veteran');

      if (replayTag !== 'play' && runPhase === 'menu' && snapshot.player.gameOver) {
        restartSimulation();
        scene.reset();
      } else if (replayTag !== 'play' && runPhase === 'running' && snapshot.player.gameOver) {
        runPhase = 'gameOver';
        gameOverRestartAllowedAt = performance.now() + GAME_OVER_RESTART_DELAY_MS;
        audio.pause();
        audioControls.setStatus('game over');
        openEndRunSurvey('death', snapshot);
      } else if (replayTag !== 'play' && runPhase === 'running' && audio.hasEnded) {
        finishSong(snapshot);
      }

      if (sim.gameOver && recorder.isRecording) {
        lastReplay = recorder.finish(sim.playerSim.state.gameTime);
        if (lastReplay) showToast(`replay recorded (${lastReplay.durationSeconds.toFixed(1)}s)`);
      }

      if (runPhase !== 'running' && runPhase !== 'paused') tutorialIntent = tutorial.suspend();
      audio.setTutorialPlaybackScale(runPhase === 'running' ? tutorialIntent.timeScale : 1);
      const sfxEvents = sim.sfxEvents.drain();
      audio.updateSfx(runPhase === 'menu' ? [] : sfxEvents, {
        state: sim.getSfxState(),
        phase: document.hidden ? 'idle' : replayTag === 'play' ? 'replay' : runPhase === 'menu' ? 'idle' : runPhase,
        tutorialScale: tutorialIntent.timeScale,
      });
      const sceneDt = replayTag === 'play'
        ? dt
        : runPhase === 'running' || runPhase === 'countdown' || runPhase === 'menu'
          ? dt * tutorialIntent.timeScale
          : 0;
      scene.update(snapshot, sceneDt, runPhase === 'running' ? tutorialIntent : null);
      if (runPhase !== 'menu') {
        hud.update(snapshot, (tutorialIntent.active && tutorialIntent.stage === 'nitro') || isTutorialRampFlight(snapshot.player));
        hud.updateTrack(audio.trackTime, audio.trackDuration);
      }
      const audioRecoveryScale = 1 - 0.3;
      const nitroActive =
        snapshot.player.mode === 'car' && snapshot.player.isAbilityActive;
      const rocketCfg = resolvedGameCfg.rocket;
      const rocketActive = snapshot.player.mode === 'rocket';
      if (snapshot.bonusPicked === 'horse' || snapshot.bonusPicked === 'car') {
        audio.triggerPortalJelly();
      }
      audio.setMusicMix(snapshot.player.damageState, nitroActive, {
        maxWet: resolvedGameCfg.destroy.damageAudioMaxWet,
        minHz: resolvedGameCfg.destroy.damageAudioMinHz,
        maxGainReduction: resolvedGameCfg.destroy.damageAudioMaxGainReduction,
        attackSeconds: resolvedGameCfg.destroy.damageAudioAttackSeconds * audioRecoveryScale,
        releaseSeconds: Math.max(
          0.02,
          resolvedGameCfg.destroy.damageAudioReleaseSeconds * audioRecoveryScale,
        ),
        damagedStress: resolvedGameCfg.destroy.damageAudioDamagedStress,
        clearSeconds: resolvedGameCfg.nitro.audioClearSeconds,
        shelfGainDb: resolvedGameCfg.nitro.audioShelfGainDb,
        shelfFrequencyHz: resolvedGameCfg.nitro.audioShelfFrequencyHz,
        gainBoost: resolvedGameCfg.nitro.audioGainBoost,
      }, sceneDt, rocketActive ? {
        active: true,
        phase: snapshot.player.rocketPhase,
        anticipationFx: snapshot.player.rocketFx,
        boostPulse: snapshot.player.rocketBoostPulse,
        audio: {
          muffleMax: rocketCfg.audioMuffleMax,
          muffleMinHz: rocketCfg.audioMuffleMinHz,
          muffleAttackSeconds: rocketCfg.audioMuffleAttackSeconds,
          muffleReleaseSeconds: rocketCfg.audioMuffleReleaseSeconds,
          turboShelfGainDb: rocketCfg.audioTurboShelfGainDb,
          turboGainBoost: rocketCfg.audioTurboGainBoost,
          turboSnapSeconds: rocketCfg.audioTurboSnapSeconds,
          turboReleaseSeconds: rocketCfg.audioTurboReleaseSeconds,
          sampleMusicGain: rocketCfg.audioSampleMusicGain,
          sampleMusicAttackSeconds: rocketCfg.audioSampleMusicAttackSeconds,
          sampleMusicReleaseSeconds: rocketCfg.audioSampleMusicReleaseSeconds,
        },
      } : undefined, snapshot.greenSmashFx);
      const trackRemaining = Math.max(0, audio.trackDuration - audio.trackTime);
      audio.setTrackEndFade(
        trackRemaining,
        config.get('audio').trackEndFadeSeconds,
      );
      if (!playback && snapshot.bonusPicked && runPhase !== 'menu') {
        showToast(`bonus: ${snapshot.bonusPicked}`);
      }
      overlay.update({
        fps: dt > 0 ? 1 / dt : 0,
        frameMs: dt * 1000,
        draws: scene.drawCalls,
        objects: snapshot.obstacles.length + snapshot.coins.length,
        seed: sim.seed,
        latencyOffset: audio.latencyOffset,
        music,
        speed: snapshot.player.speed,
        distance: snapshot.player.distance,
        lane: snapshot.player.lane,
        mode: snapshot.player.mode,
        phase: snapshot.phase,
        vfx: snapshot.vfxIntensity,
        intents: director.memory.intents
          .slice(-6)
          .map((i) => `${i.target}=${i.value}`)
          .join(' '),
        replay: replayTag || (recorder.isRecording ? 'rec' : ''),
        wound:
          snapshot.player.damageState !== 'normal'
            ? `${snapshot.player.damageState} ${snapshot.player.recoveryTimer.toFixed(1)}s`
            : 'ok',
        combo: `${snapshot.combo}`,
        pulse: snapshot.pulse,
        strongPulse: snapshot.strongPulse,
        turbo: snapshot.turbo,
        nitro: (snapshot.player.nitroCharge / snapshot.nitroMaxFill) * 100,
        fx: scene.fxDiagnostics(),
        musicPattern: snapshot.musicPattern ?? '-',
        musicScene: snapshot.musicTiming ? `${snapshot.runStage} ${snapshot.musicAnalysis} planned ${snapshot.musicTiming.planned} measured ${snapshot.musicTiming.samples} rejected ${snapshot.musicTiming.rejected} hit ${Math.round((snapshot.musicTiming.hitShare ?? 0) * 100)}% median ${snapshot.musicTiming.medianMs?.toFixed(0) ?? '—'}ms p95 ${snapshot.musicTiming.p95Ms?.toFixed(0) ?? '—'}ms` : snapshot.musicScene
          ? `${snapshot.musicScene.kind} ${snapshot.musicScene.reason} ` +
            `in ${snapshot.musicScene.remainingSeconds.toFixed(1)}s ` +
            `route ${snapshot.musicScene.routeHint} [${snapshot.musicScene.guideLanes.join(',')}] ` +
            `echo ${snapshot.musicScene.echo}`
          : '-',
        requestedDensity: snapshot.requestedDensity,
        effectiveDensity: snapshot.effectiveDensity,
        coinFrequency: snapshot.effectiveCoinFrequency,
      });
    if (!playback) {
        timeline.update(dt, music, snapshot.phase);
      }

      if (!playback && runPhase === 'running' && dt > 0) {
        fpsTracker.sample(1 / dt);
      }

      if (playtest.isRecording && !playback) {
        playtest.sampleMusic(snapshot);
        const songProgress =
          audio.trackDuration > 0 ? audio.trackTime / audio.trackDuration : 0;
        playtest.maybeHeartbeat(snapshot, songProgress);
        audioControls.syncLogButton();
      }
    },
    render: () => scene.render(),
  });
  context.provide(LOOP_KEY, loop);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.updateSfx([], { state: sim.getSfxState(), phase: 'idle', tutorialScale: 1 });
  });
  if (devUi) Object.assign(window, { runnerSfxDiagnostics: () => ({ ...audio.getSfxDiagnostics(), queueDropped: sim.sfxEvents.dropped }) });
  loop.start();

  function restartSimulation(): void {
    audio.resetSfx();
    sim.restart();
    tutorial.resetRun();
    tutorialIntent = tutorial.suspend();
    tutorialSnapshot = undefined;
    tutorialMode = sim.playerSim.state.mode;
    audio.setTutorialPlaybackScale(1);
  }

  async function startSongRun(): Promise<void> {
    pendingPlaytestDraft = null;
    lastEndReason = null;
    lastRunResults = null;
    endRunPanel.hide();
    hud.setEndRunBlocking(false);
    hud.showResults(null);
    if (!audio.isReady) return;
    leaveMenu();
    const sequence = ++countdownSequence;
    if (introGoHideTimer !== null) {
      window.clearTimeout(introGoHideTimer);
      introGoHideTimer = null;
    }
    runPhase = 'countdown';
    introMusicStarted = false;
    audio.prepareRestart();
    inputBuffer.clear();
    restartSimulation();
    sim.beginLevelIntro();
    sim.fixedUpdate(0);
    scene.reset();
    hud.resetRun();
    hud.updateTrack(0, audio.trackDuration);
    if (sequence !== countdownSequence) return;
    void audio.playEngineStart();
    hud.showCountdown('3');
    audioControls.setStatus('countdown');
  }

  function applyMasterVolume(value: number): void {
    audio.setMasterVolume(value);
    storeMasterVolume(audio.getMasterVolume());
    mainMenu.setVolume(audio.getMasterVolume());
    hud.setMasterVolume(audio.getMasterVolume());
  }

  function enterMenu(): void {
    if (introGoHideTimer !== null) {
      window.clearTimeout(introGoHideTimer);
      introGoHideTimer = null;
    }
    playback = null;
    pendingPlaytestDraft = null;
    lastEndReason = null;
    lastRunResults = null;
    endRunPanel.hide();
    hud.setEndRunBlocking(false);
    hud.showResults(null);
    hud.showCountdown(null);
    hud.setPaused(false);
    audio.pause();
    inputBuffer.clear();
    runPhase = 'menu';
    scene.setPlayerHidden(true);
    hud.setHidden(true);
    restartSimulation();
    scene.reset();
    sim.setGhost(true);
    mainMenu.setVolume(audio.getMasterVolume());
    mainMenu.show();
    audioControls.setStatus('menu');
  }

  function leaveMenu(): void {
    mainMenu.hide();
    sim.setGhost(false);
    scene.setPlayerHidden(false);
    hud.setHidden(false);
  }

  async function startBundledTrack(track: BundledTrack): Promise<void> {
    mainMenu.setBusy(true, 'загрузка…');
    try {
      await audio.loadUrl(track.url, track.fileName);
      applyVideoDisplayMode();
      leaveMenu();
      audioControls.setStatus('countdown');
      await startSongRun();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      mainMenu.setError(message);
      showToast(message, 'error');
    }
  }

  function pauseRun(): void {
    runPhase = 'paused';
    inputBuffer.clear();
    audio.pause();
    audioControls.setStatus('paused');
    hud.setPaused(true);
  }

  async function resumeRun(): Promise<void> {
    if (runPhase !== 'paused') return;
    inputBuffer.clear();
    if (tutorialSnapshot) tutorialIntent = tutorial.update(tutorialSnapshot, 0);
    audio.setTutorialPlaybackScale(tutorialIntent.timeScale);
    await audio.play();
    runPhase = 'running';
    audioControls.setStatus('playing');
    hud.setPaused(false);
  }

  function finishSong(snapshot: GameSnapshot): void {
    runPhase = 'finished';
    inputBuffer.clear();
    audio.pause();
    audioControls.setStatus('finished');
    hud.showCountdown(null);
    lastRunResults = {
      score: snapshot.scoreTotal,
      distance: snapshot.player.distance,
      coins: snapshot.player.coins,
      maxCombo: snapshot.runStats.maxCombo,
      smashes: snapshot.runStats.smashes,
      tricks: snapshot.runStats.tricks,
      trainRideSeconds: snapshot.runStats.trainRideSeconds,
      carSeconds: snapshot.runStats.carSeconds,
      horseSeconds: snapshot.runStats.horseSeconds,
      modeSwitches: snapshot.runStats.modeSwitches,
      horseOffers: snapshot.runStats.horseOffers,
      carOffers: snapshot.runStats.carOffers,
      horsePickups: snapshot.runStats.horsePickups,
      carPickups: snapshot.runStats.carPickups,
      horseJumpClears: snapshot.runStats.horseJumpClears,
      horseSlideClears: snapshot.runStats.horseSlideClears,
      hits: snapshot.runStats.hits,
      nitroActivations: snapshot.runStats.nitroActivations,
      blasterSaves: snapshot.runStats.blasterSaves,
      maxHorseMomentum: snapshot.runStats.maxHorseMomentum,
    };
    openEndRunSurvey('song_end', snapshot, lastRunResults);
  }

  function openEndRunSurvey(
    kind: 'death' | 'song_end',
    snapshot: GameSnapshot,
    results?: RunResults,
  ): void {
    lastEndReason = kind;
    lastFpsStats = fpsTracker.finish();
    if (playtest.isRecording) {
      const songProgress =
        audio.trackDuration > 0 ? audio.trackTime / audio.trackDuration : 0;
      pendingPlaytestDraft = playtest.finish(kind, snapshot, songProgress);
    } else {
      pendingPlaytestDraft = null;
    }
    hud.setEndRunBlocking(true);
    endRunPanel.show({
      kind,
      survey: PLAYTEST_SURVEY_CONFIG,
      results,
      onSubmit: (answers) => {
        void submitPlaytestSurvey(answers);
      },
      onDismiss: () => {
        dismissEndRunSurvey();
      },
      onRestart: () => {
        void startSongRun();
      },
      onChooseTrack: () => {
        enterMenu();
      },
    });
  }

  function dismissEndRunSurvey(): void {
    pendingPlaytestDraft = null;
    endRunPanel.hide();
    hud.setEndRunBlocking(false);
    if (lastEndReason === 'song_end' && lastRunResults) {
      hud.showResults(lastRunResults);
    } else if (lastEndReason === 'death') {
      gameOverRestartAllowedAt = performance.now();
    }
  }

  async function submitPlaytestSurvey(answers: PlaytestSurveyAnswers): Promise<void> {
    if (!pendingPlaytestDraft) {
      endRunPanel.hide();
      hud.setEndRunBlocking(false);
      return;
    }
    const session = attachSurveyToSession(
      pendingPlaytestDraft,
      answers,
      {
        buildVersion: APP_BUILD_VERSION,
        buildSeq: APP_BUILD_SEQ,
        gameplayRules: activeGameplayRulesId,
        levelgenPreset: activeLevelgenPresetId,
        adrenalinePreset: activeAdrenalinePresetId,
        fps: lastFpsStats,
        userAgent: navigator.userAgent,
      },
    );
    try {
      await savePlaytestSession(session);
      pendingPlaytestDraft = null;
      await refreshStoredPlaytestCount();
      showToast(`playtest лог сохранён (${session.events.length} events)`, 'success');
    } catch (err) {
      showToast(
        `не удалось сохранить лог: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
      return;
    }
    endRunPanel.hide();
    hud.setEndRunBlocking(false);
    if (lastEndReason === 'song_end' && lastRunResults) {
      hud.showResults(lastRunResults);
    } else if (lastEndReason === 'death') {
      gameOverRestartAllowedAt = performance.now();
    }
  }

  async function refreshStoredPlaytestCount(): Promise<void> {
    try {
      storedPlaytestCount = await countPlaytestSessions();
    } catch {
      storedPlaytestCount = 0;
    }
    audioControls.syncLogButton();
  }

  async function exportPlaytestLogs(): Promise<void> {
    try {
      const sessions = await listPlaytestSessions();
      if (sessions.length === 0) {
        showToast('нет сохранённых playtest-логов', 'error');
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      downloadPlaytestSessionsExport(
        sessions,
        `playtest-export-b${APP_BUILD_SEQ}-${stamp}.json`,
        { buildVersion: APP_BUILD_VERSION, buildSeq: APP_BUILD_SEQ },
      );
      await clearPlaytestSessions();
      await refreshStoredPlaytestCount();
      showToast(`экспорт ${sessions.length} логов · список очищен`, 'success');
    } catch (err) {
      showToast(
        `экспорт не удался: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    }
  }

  function beginPlaytestRecording(): void {
    if (!audio.loadedTrackFileName) return;
    const track = parseTrackMeta(audio.loadedTrackFileName, audio.trackDuration);
    playtest.start(track, sim.seed);
    audioControls.syncLogButton();
  }

  void refreshStoredPlaytestCount();

  return { context, config, scene, loop, sim, audio };
}

type RunPhase = 'menu' | 'running' | 'countdown' | 'paused' | 'finished' | 'gameOver';

function neutralMusic(): MusicState {
  return {
    audioTime: 0,
    energy: { value: 0.5, audioTime: 0 },
    beat: { value: false, audioTime: 0 },
    brightness: { value: 0.5, audioTime: 0 },
    silence: { value: false, audioTime: 0 },
  };
}

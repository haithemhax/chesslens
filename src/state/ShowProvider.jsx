import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Chess } from 'chess.js';
import { StockfishEngine } from '../engine/StockfishEngine.js';
import { VisionController } from '../vision/VisionController.js';
import { RecordingController } from '../recording/RecordingController.js';
import { playChessSound } from '../lib/sound.js';
import {
  persistableSettings,
  useChessLens,
} from './store.js';
import { saveCalibration, saveSettings } from '../lib/storage.js';
import { translate, languageDir } from '../i18n/translations.js';
import { parseMoveInput } from '../lib/chessHelpers.js';
import { evalFromMaterial, gameResult, normalizeEngineScore } from '../lib/evaluation.js';
import { buildWarpMap } from '../lib/homography.js';
import { evaluateCameraFit } from '../lib/cameraFit.js';
import { buildLlmContext } from '../commentary/commentary.js';
import { requestLlmCommentary } from '../commentary/llm.js';
import { DEMO_MOVE_INTERVAL_MS, OPERA_GAME } from '../demo/operaGame.js';

const ShowContext = createContext(null);

export function useShow() {
  const context = useContext(ShowContext);
  if (!context) throw new Error('useShow must be used inside ShowProvider');
  return context;
}

export function ShowProvider({ children }) {
  const [cameraStream, setCameraStream] = useState(null);
  const videoRef = useRef(null);
  const engineRef = useRef(null);
  const engineGenerationRef = useRef(0);
  const visionRef = useRef(null);
  const streamRef = useRef(null);
  const recordingControllerRef = useRef(null);
  const activeTrackRef = useRef(null);
  const trackEndedHandlerRef = useRef(null);
  const syncTimerRef = useRef(0);
  const cameraGenerationRef = useRef(0);
  const evalInFlightRef = useRef(new Set());
  const llmRequestRef = useRef({ key: null });
  const handlersRef = useRef({});
  const actionsRef = useRef({});
  const lastVisionErrorRef = useRef(0);
  const lastFitStatusRef = useRef('good');
  const analysisWarpCanvasRef = useRef(null);
  const analysisSourceCanvasRef = useRef(null);

  const settings = useChessLens((state) => state.settings);
  const cameraStatus = useChessLens((state) => state.camera.status);
  const calibration = useChessLens((state) => state.calibration);
  const demoActive = useChessLens((state) => state.demo.active);
  const demoMode = useChessLens((state) => state.demo.mode);
  const demoPlayerColor = useChessLens((state) => state.demo.playerColor);
  const demoIndex = useChessLens((state) => state.demo.index);
  const demoFinished = useChessLens((state) => state.demo.finished);
  const toastId = useChessLens((state) => state.ui.toast?.id);
  const engineStatus = useChessLens((state) => state.engine.status);
  const gameFen = useChessLens((state) => state.game.fen);
  const gamePly = useChessLens((state) => state.game.ply);
  const gameEpoch = useChessLens((state) => state.game.epoch);
  const engineMs = useChessLens((state) => state.settings.engineMs);
  const skillLevel = useChessLens((state) => state.settings.skillLevel);
  const flip = useChessLens((state) => state.settings.flip);
  const sensitivity = useChessLens((state) => state.settings.motionSensitivity);
  const settleMs = useChessLens((state) => state.settings.settleMs);
  const detectionPaused = useChessLens((state) => state.settings.detectionPaused);
  const calibrating = useChessLens((state) => state.ui.calibrating);
  const lastRecord = useChessLens((state) => state.game.moves[state.game.moves.length - 1] || null);
  const lang = useChessLens((state) => state.settings.lang);
  const llmEnabled = useChessLens((state) => state.settings.llmEnabled);
  const llmBaseUrl = useChessLens((state) => state.settings.llmBaseUrl);
  const llmModel = useChessLens((state) => state.settings.llmModel);
  const llmKey = useChessLens((state) => state.llmKey);
  const online = useChessLens((state) => state.online);

  function notifyKey(key, kind = 'info') {
    const state = useChessLens.getState();
    state.notify(translate(state.settings.lang, key), kind);
  }

  // ------------------------------------------------------------------ engine
  function initEngine() {
    engineGenerationRef.current += 1;
    const generation = engineGenerationRef.current;
    engineRef.current?.dispose();
    const engine = new StockfishEngine({
      onWatchdogRestart: () => {
        const state = useChessLens.getState();
        state.notify(translate(state.settings.lang, 'engineWatchdogRestart'), 'warning');
      },
    });
    engineRef.current = engine;
    useChessLens.getState().setEngine({ status: 'loading', message: '' });

    engine.init()
      .then(() => {
        if (generation !== engineGenerationRef.current) return;
        useChessLens.getState().setEngine({ status: 'ready', message: '' });
      })
      .catch((error) => {
        if (generation !== engineGenerationRef.current) return;
        useChessLens.getState().setEngine({
          status: 'error',
          message: error?.message || 'Engine failed to load',
        });
        notifyKey('engineError', 'error');
      });
  }

  function disposeEngine() {
    engineGenerationRef.current += 1;
    engineRef.current?.dispose();
    engineRef.current = null;
  }

  // ------------------------------------------------------------------ camera
  async function refreshDevices() {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices
        .filter((device) => device.kind === 'videoinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `${translate(useChessLens.getState().settings.lang, 'camera')} ${index + 1}`,
        }));
      useChessLens.getState().setCamera({ devices: cameras });
      return cameras;
    } catch {
      return [];
    }
  }

  function stopActiveStream() {
    setCameraStream(null);
    if (activeTrackRef.current && trackEndedHandlerRef.current) {
      activeTrackRef.current.removeEventListener('ended', trackEndedHandlerRef.current);
    }
    activeTrackRef.current = null;
    trackEndedHandlerRef.current = null;

    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
    }

    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
      } catch {
        /* ignore */
      }
      video.srcObject = null;
    }
  }

  function waitForVideo(video) {
    if (video.videoWidth) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        video.removeEventListener('loadedmetadata', finish);
        resolve();
      };
      video.addEventListener('loadedmetadata', finish);
      setTimeout(finish, 4000);
    });
  }

  async function acquireStream(deviceId) {
    const videoBase = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    };

    if (deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { ...videoBase, deviceId: { exact: deviceId } },
          audio: false,
        });
      } catch (error) {
        if (!['OverconstrainedError', 'NotFoundError'].includes(error.name)) throw error;
      }
    }

    return navigator.mediaDevices.getUserMedia({ video: videoBase, audio: false });
  }

  async function startCamera(deviceId) {
    const state = useChessLens.getState();
    if (!navigator.mediaDevices?.getUserMedia) {
      state.setCamera({ status: 'error', message: 'getUserMedia is unavailable' });
      notifyKey('cameraError', 'error');
      return;
    }

    const generation = cameraGenerationRef.current + 1;
    cameraGenerationRef.current = generation;
    state.setCamera({ status: 'starting', message: '' });
    stopActiveStream();

    let stream = null;
    try {
      stream = await acquireStream(deviceId);
      if (generation !== cameraGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error('Video element is unavailable');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      try {
        await video.play();
      } catch {
        /* autoplay of a muted stream should normally succeed */
      }

      await waitForVideo(video);
      if (generation !== cameraGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (!video.videoWidth || !video.videoHeight) {
        throw new Error('No video frames received');
      }

      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('No video track');
      const trackSettings = track.getSettings?.() || {};
      const actualId = trackSettings.deviceId || deviceId || '';

      activeTrackRef.current = track;
      const ended = () => handlersRef.current.handleTrackEnded?.();
      trackEndedHandlerRef.current = ended;
      track.addEventListener('ended', ended);

      const latest = useChessLens.getState();
      setCameraStream(stream);
      latest.setCamera({ status: 'live', message: '', deviceId: actualId });
      if (actualId && actualId !== latest.settings.deviceId) {
        latest.setSettings({ deviceId: actualId });
      }
      await refreshDevices();
      notifyKey('cameraOk', 'success');
    } catch (error) {
      if (generation !== cameraGenerationRef.current) {
        if (stream) stream.getTracks().forEach((track) => track.stop());
        return;
      }
      stopActiveStream();
      const latest = useChessLens.getState();
      latest.setCamera({
        status: 'error',
        message: error?.message || 'Camera error',
      });
      visionRef.current?.stop();
      notifyKey('cameraError', 'error');
    }
  }

  function stopCamera() {
    cameraGenerationRef.current += 1;
    stopActiveStream();
    visionRef.current?.stop();
    const state = useChessLens.getState();
    state.setCamera({ status: 'idle', message: '' });
    state.setVision({ mode: 'idle', pending: false, candidates: [], changedCells: [] });
  }

  function selectDevice(deviceId) {
    const state = useChessLens.getState();
    state.setSettings({ deviceId });
    if (state.camera.status === 'live' || state.camera.status === 'starting') {
      startCamera(deviceId);
    }
  }

  function handleTrackEnded() {
    cameraGenerationRef.current += 1;
    setCameraStream(null);
    const state = useChessLens.getState();
    state.setCamera({ status: 'error', message: 'Camera disconnected' });
    state.setVision({ mode: 'idle', pending: false, candidates: [], changedCells: [] });
    visionRef.current?.stop();
    notifyKey('cameraDisconnected', 'error');
  }

  // ------------------------------------------------------------- fullscreen
  async function requestFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      /* fullscreen can be denied; the show still runs windowed */
    }
  }

  async function exitFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* ignore */
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) exitFullscreen();
    else requestFullscreen();
  }

  function startShow(withFullscreen = true) {
    const state = useChessLens.getState();
    state.setUi({ splash: false });
    if (withFullscreen) requestFullscreen();
    if (!state.demo.active && state.calibration && state.camera.status !== 'live') {
      startCamera(state.settings.deviceId);
    }
  }

  function toggleOperator() {
    const state = useChessLens.getState();
    const operatorOpen = !state.ui.operatorOpen;
    state.setUi({
      operatorOpen,
      ...(operatorOpen ? { splash: false } : {}),
    });
  }

  // ------------------------------------------------------------- calibration
  async function openCalibration() {
    const state = useChessLens.getState();
    if (state.camera.status !== 'live') {
      await startCamera(state.settings.deviceId);
      if (useChessLens.getState().camera.status !== 'live') {
        notifyKey('cameraRequired', 'warning');
        return;
      }
    }
    useChessLens.getState().setUi({ calibrating: true });
  }

  function closeCalibration() {
    useChessLens.getState().setUi({ calibrating: false });
  }

  function finishCalibration(corners) {
    if (!corners || corners.length !== 4) return;
    const state = useChessLens.getState();
    const nextCalibration = { corners, createdAt: Date.now(), version: 1 };
    const saved = saveCalibration(nextCalibration);

    state.setCalibration(nextCalibration);
    state.setSettings({ detectionPaused: false });
    state.newGame();
    state.setUi({ calibrating: false });
    state.setVision({
      mode: state.demo.active ? 'idle' : 'watching',
      pending: false,
      candidates: [],
      changedCells: [],
    });

    visionRef.current?.setCalibration(nextCalibration, state.settings.flip);
    if (!state.demo.active) visionRef.current?.start();

    // Give the operator a moment to take their hands away, then anchor the
    // reference to a clean frame of the starting position.
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      const latest = useChessLens.getState();
      if (latest.calibration !== nextCalibration || latest.camera.status !== 'live' || latest.demo.active) {
        return;
      }
      if (visionRef.current?.syncReference()) {
        latest.setDebug({ changedCells: [], candidates: [] });
        latest.notify(translate(latest.settings.lang, 'calibrationSaved'), saved ? 'success' : 'warning');
      }
      runCameraFitCheck();
    }, 1400);
  }

  // ------------------------------------------------------------- camera fit
  function runCameraFitCheck(customCorners = null) {
    const state = useChessLens.getState();
    const video = videoRef.current;
    const corners = customCorners || state.calibration?.corners || null;
    const driftDetected = Boolean(state.vision.driftDetected);
    const flip = Boolean(state.settings.flip);
    const baselineSharpness = state.calibration?.baselineSharpness || null;

    let videoWidth = 1280;
    let videoHeight = 720;
    let imageData = null;

    if (video && video.videoWidth && video.videoHeight) {
      videoWidth = video.videoWidth;
      videoHeight = video.videoHeight;

      if (corners && corners.length === 4) {
        try {
          if (!analysisWarpCanvasRef.current) {
            analysisWarpCanvasRef.current = document.createElement('canvas');
            analysisWarpCanvasRef.current.width = 256;
            analysisWarpCanvasRef.current.height = 256;
          }
          const warpCanvas = analysisWarpCanvasRef.current;
          const warpCtx = warpCanvas.getContext('2d', { willReadFrequently: true });

          const scale = Math.min(1, 512 / Math.max(videoWidth, videoHeight));
          const sw = Math.max(2, Math.round(videoWidth * scale));
          const sh = Math.max(2, Math.round(videoHeight * scale));

          if (!analysisSourceCanvasRef.current) {
            analysisSourceCanvasRef.current = document.createElement('canvas');
          }
          const srcCanvas = analysisSourceCanvasRef.current;
          if (srcCanvas.width !== sw || srcCanvas.height !== sh) {
            srcCanvas.width = sw;
            srcCanvas.height = sh;
          }
          const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
          srcCtx.drawImage(video, 0, 0, sw, sh);
          const source = srcCtx.getImageData(0, 0, sw, sh).data;

          const map = buildWarpMap({
            corners,
            destSize: 256,
            sourceWidth: sw,
            sourceHeight: sh,
          });

          if (map) {
            const image = warpCtx.createImageData(256, 256);
            const offsets = map.offsets;
            const dest = image.data;
            for (let i = 0, o = 0; i < offsets.length; i += 1, o += 4) {
              const s = offsets[i];
              dest[o] = source[s];
              dest[o + 1] = source[s + 1];
              dest[o + 2] = source[s + 2];
              dest[o + 3] = 255;
            }
            warpCtx.putImageData(image, 0, 0);
            imageData = image;
          }
        } catch {
          /* ignore frame capture errors during resize */
        }
      } else {
        // Measure what can be measured on raw frame (brightness, sharpness) before corners are calibrated
        try {
          if (!analysisSourceCanvasRef.current) {
            analysisSourceCanvasRef.current = document.createElement('canvas');
          }
          const srcCanvas = analysisSourceCanvasRef.current;
          if (srcCanvas.width !== 256 || srcCanvas.height !== 256) {
            srcCanvas.width = 256;
            srcCanvas.height = 256;
          }
          const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
          srcCtx.drawImage(video, 0, 0, 256, 256);
          imageData = srcCtx.getImageData(0, 0, 256, 256);
        } catch {
          /* ignore */
        }
      }
    }

    const fitResult = evaluateCameraFit({
      corners,
      videoWidth,
      videoHeight,
      imageData,
      baselineSharpness,
      driftDetected,
      flip,
    });

    const prevStatus = lastFitStatusRef.current;
    lastFitStatusRef.current = fitResult.status;

    // Operator toast when status drops to poor during live show
    if (prevStatus === 'good' && fitResult.status === 'poor' && state.camera.status === 'live' && !state.demo.active) {
      state.notify(translate(state.settings.lang, 'cameraFitPoorToast'), 'warning');
    }

    state.setCameraFit(fitResult);
    return fitResult;
  }

  function captureBaselineAction(type = 'start') {
    const state = useChessLens.getState();
    if (state.cameraFit?.status === 'poor') {
      const ok = typeof window !== 'undefined' ? window.confirm(translate(state.settings.lang, 'confirmPoorBaseline')) : true;
      if (!ok) return null;
    }
    const res = visionRef.current?.captureBaseline(type);
    const fit = runCameraFitCheck();
    if (state.calibration && fit?.img?.sharpness) {
      const updated = {
        ...state.calibration,
        baselineSharpness: fit.img.sharpness,
      };
      saveCalibration(updated);
      state.setCalibration(updated);
    }
    notifyKey('baselineCaptured', 'success');
    return res;
  }

  // --------------------------------------------------------------- detection
  function syncBoard() {
    const state = useChessLens.getState();
    const reconciliation = visionRef.current?.reconcilePhysicalBoard(state.game.fen);
    if (reconciliation && reconciliation.moves?.length > 0) {
      if (reconciliation.type === '1-ply') {
        const move = reconciliation.moves[0];
        const record = applyUci(reconciliation.candidate.uci, 'detected', { commitPending: true });
        if (record) {
          state.clearDetection();
          state.setDebug({ changedCells: [], candidates: [] });
          notifyKey('synced', 'success');
          return;
        }
      } else if (reconciliation.type === '2-ply') {
        const m1 = reconciliation.moves[0];
        const m2 = reconciliation.moves[1];
        const uci1 = `${m1.from}${m1.to}${m1.promotion || ''}`;
        const uci2 = `${m2.from}${m2.to}${m2.promotion || ''}`;
        const rec1 = applyUci(uci1, 'detected');
        if (rec1) {
          applyUci(uci2, 'detected', { commitPending: true });
          state.clearDetection();
          state.setDebug({ changedCells: [], candidates: [] });
          notifyKey('synced', 'success');
          return;
        }
      }
    }
    const synced = visionRef.current?.syncReference();
    state.clearDetection();
    state.setDebug({ changedCells: [], candidates: [] });
    if (synced) notifyKey('synced', 'success');
  }

  function handleVisionState(payload) {
    const state = useChessLens.getState();
    state.setVision({
      mode: payload.mode,
      motion: payload.motion,
      occluded: Boolean(payload.occluded),
      occlusionReason: payload.occlusionReason || null,
      driftDetected: Boolean(payload.driftDetected),
    });
    state.setDebug({ motion: payload.motion, cellDiffs: payload.cellDiffs });
  }

  function handleVisionDetection(payload) {
    const state = useChessLens.getState();
    if (state.demo.active) {
      visionRef.current?.rejectPending();
      return;
    }

    state.setDebug({
      changedCells: payload.changedCells,
      candidates: payload.candidates,
      lastAnalysisAt: Date.now(),
      cellDiffs: visionRef.current?.getDebugState().cellDiffs || [],
    });

    if (payload.autoAccept) {
      const record = applyUci(payload.best.uci, 'detected', { commitPending: true });
      if (record) {
        state.setVision({ mode: 'watching', pending: false, candidates: [], changedCells: [] });
        state.setDebug({ changedCells: [], candidates: [] });
      } else {
        visionRef.current?.rejectPending();
        state.setVision({ mode: 'watching', pending: false, candidates: [], changedCells: [] });
        notifyKey('invalidMove', 'error');
      }
      return;
    }

    // Ambiguity: keep audience screen clean on last good state, show candidates only in operator view
    state.setPendingDetection({
      changedCells: payload.changedCells,
      candidates: payload.candidates,
    });
  }

  function handleTestDetection(payload) {
    const state = useChessLens.getState();
    state.setVision({
      testResult: {
        changedCells: payload.changedCells,
        candidates: payload.candidates,
        best: payload.best,
        at: Date.now(),
      },
    });
    state.setDebug({
      changedCells: payload.changedCells,
      candidates: payload.candidates,
      lastAnalysisAt: Date.now(),
      cellDiffs: visionRef.current?.getDebugState().cellDiffs || [],
    });
  }

  function handleVisionDrift(payload) {
    const state = useChessLens.getState();
    state.setVision({ driftDetected: true });
    notifyKey('cameraMovedWarning', 'warning');
  }

  function handleVisionError(error) {
    console.warn('Vision error', error);
    const now = Date.now();
    if (now - lastVisionErrorRef.current > 5000) {
      lastVisionErrorRef.current = now;
      notifyKey('cameraError', 'error');
    }
  }

  // ------------------------------------------------------------------- moves
  function applyUci(uci, source = 'operator', { commitPending = false } = {}) {
    const state = useChessLens.getState();
    if (!uci || state.game.status.over) return null;

    const game = new Chess(state.game.fen);
    const forced = game.moves().length === 1;
    let move;
    try {
      move = game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
    } catch {
      return null;
    }

    const record = state.commitMove({
      move,
      fenAfter: game.fen(),
      source,
      gameOver: gameResult(game),
      forced,
    });

    if (record) {
      if (move.flags && (move.flags.includes('k') || move.flags.includes('q'))) {
        playChessSound('castle');
      } else if (record.gameOver?.over && record.gameOver.type === 'checkmate') {
        playChessSound('check');
      } else if (new Chess(game.fen()).inCheck()) {
        playChessSound('check');
      } else if (move.captured) {
        playChessSound('capture');
      } else {
        playChessSound('move');
      }

      if (commitPending) {
        visionRef.current?.commitPending();
      } else if (
        source !== 'demo'
        && source !== 'detected'
        && state.calibration
        && state.camera.status === 'live'
        && !state.demo.active
      ) {
        // A manual correction means the physical board and the app may now
        // disagree. Pause until the operator has fixed the board and resumed,
        // so a half-set position can never be read as a move.
        state.setSettings({ detectionPaused: true });
        visionRef.current?.pause();
        notifyKey('setBoardAndResume', 'info');
      }
    }
    return record;
  }

  function playBoardMove(from, to, promotion = 'q') {
    const state = useChessLens.getState();
    if (state.game.status.over) {
      notifyKey('gameOver', 'warning');
      return null;
    }
    if (state.demo.active && state.demo.mode === 'opera') {
      notifyKey('demoOn', 'warning');
      return null;
    }

    let move;
    try {
      const game = new Chess(state.game.fen);
      move = game.move({ from, to, promotion });
      if (!move) {
        notifyKey('invalidMove', 'error');
        return null;
      }
    } catch {
      notifyKey('invalidMove', 'error');
      return null;
    }

    const uci = `${from}${to}${move.promotion || ''}`;
    const source = state.demo.active ? 'demo' : 'board';
    const record = applyUci(uci, source, { commitPending: state.vision.pending });
    if (record) {
      const latest = useChessLens.getState();
      const live = latest.camera.status === 'live' && latest.calibration && !latest.demo.active;
      latest.setVision({
        mode: live ? (latest.settings.detectionPaused ? 'paused' : 'watching') : 'idle',
        pending: false,
        candidates: [],
        changedCells: [],
      });
      latest.setDebug({ changedCells: [], candidates: [] });
    }
    return record;
  }

  function applyMoveText(input, source = 'manual') {
    const state = useChessLens.getState();
    if (state.demo.active && state.demo.mode === 'opera' && source !== 'demo') {
      notifyKey('demoOn', 'warning');
      return null;
    }
    if (state.game.status.over) {
      notifyKey('gameOver', 'warning');
      return null;
    }
    const parsed = parseMoveInput(state.game.fen, input);
    if (!parsed) {
      notifyKey('invalidMove', 'error');
      return null;
    }
    const uci = `${parsed.from}${parsed.to}${parsed.promotion || ''}`;
    const record = applyUci(uci, source, { commitPending: state.vision.pending });
    if (record) {
      const latest = useChessLens.getState();
      const live = latest.camera.status === 'live' && latest.calibration && !latest.demo.active;
      latest.setVision({
        mode: live ? (latest.settings.detectionPaused ? 'paused' : 'watching') : 'idle',
        pending: false,
        candidates: [],
        changedCells: [],
      });
      latest.setDebug({ changedCells: [], candidates: [] });
    }
    return record;
  }

  function resolveCandidate(candidate) {
    const state = useChessLens.getState();
    const record = applyUci(candidate.uci, 'operator', { commitPending: true });
    if (record) {
      state.setVision({ mode: 'watching', pending: false, candidates: [], changedCells: [] });
      state.setDebug({ changedCells: [], candidates: [] });
    }
  }

  function ignoreCandidates() {
    const state = useChessLens.getState();
    visionRef.current?.resync();
    state.clearDetection();
    state.setDebug({ changedCells: [], candidates: [] });
    notifyKey('ignored', 'info');
  }

  function newGameAction() {
    const state = useChessLens.getState();
    state.newGame();
    visionRef.current?.rejectPending();
    const live = state.camera.status === 'live' && state.calibration && !state.demo.active;
    state.setVision({
      mode: live ? (state.settings.detectionPaused ? 'paused' : 'watching') : 'idle',
      pending: false,
      candidates: [],
      changedCells: [],
    });
    state.setDebug({ changedCells: [], candidates: [] });

    if (state.camera.status === 'live' && state.calibration && !state.demo.active) {
      state.setSettings({ detectionPaused: true });
      notifyKey('setBoardAndResume', 'info');
    }
  }

  function undoAction() {
    const state = useChessLens.getState();
    if (!state.undo()) {
      notifyKey('undoUnavailable', 'info');
      return;
    }
    visionRef.current?.rejectPending();
    state.setVision({ pending: false, candidates: [], changedCells: [] });
    state.setDebug({ changedCells: [], candidates: [] });
    if (state.camera.status === 'live' && state.calibration && !state.demo.active) {
      state.setSettings({ detectionPaused: true });
      notifyKey('setBoardAndResume', 'info');
    }
  }

  function togglePause() {
    const state = useChessLens.getState();
    const paused = !state.settings.detectionPaused;
    state.setSettings({ detectionPaused: paused });
    if (paused) visionRef.current?.pause();
    else visionRef.current?.resume();
    notifyKey(paused ? 'paused' : 'synced', paused ? 'warning' : 'success');
  }

  function flipBoard() {
    const state = useChessLens.getState();
    const nextFlip = !state.settings.flip;
    state.setSettings({ flip: nextFlip });
    visionRef.current?.setFlip(nextFlip);
    if (state.vision.pending) {
      visionRef.current?.rejectPending();
      state.clearDetection();
    }
  }

  function setLanguageAction(nextLang) {
    useChessLens.getState().setLanguage(nextLang);
  }

  // -------------------------------------------------------------------- demo
  function toggleDemo(force) {
    const state = useChessLens.getState();
    const active = typeof force === 'boolean' ? force : !state.demo.active;
    if (active === state.demo.active) return;

    if (active) {
      state.setDemo({ active: true, index: 0, finished: false });
      state.newGame();
      state.setUi({ splash: false, operatorOpen: false });
      state.setVision({ mode: 'idle', pending: false, candidates: [], changedCells: [] });
      notifyKey('demoOn', 'info');
    } else {
      state.setDemo({ active: false, index: 0, finished: false });
      state.newGame();
      notifyKey('demoOff', 'info');
      if (state.camera.status === 'live' && state.calibration) {
        state.setSettings({ detectionPaused: true });
        notifyKey('setBoardAndResume', 'info');
      }
    }
  }

  // ------------------------------------------------------------- recording
  async function startRecording() {
    const state = useChessLens.getState();
    const source = state.settings.recordingSource || 'camera';
    const controller = recordingControllerRef.current;
    if (!controller) return;

    let streamToRecord = null;
    if (source === 'screen') {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        state.notify(
          `${translate(state.settings.lang, 'recordingError')}: getDisplayMedia unavailable`,
          'error'
        );
        return;
      }
      try {
        streamToRecord = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 } },
          audio: false,
        });
      } catch (err) {
        if (err.name !== 'NotAllowedError') {
          state.notify(
            `${translate(state.settings.lang, 'recordingError')}: ${err?.message || err}`,
            'error'
          );
        }
        return;
      }
    } else {
      streamToRecord = streamRef.current;
      if (!streamToRecord || !streamToRecord.active) {
        state.notify(translate(state.settings.lang, 'cameraOff'), 'warning');
        return;
      }
    }

    try {
      await controller.start(streamToRecord, {
        bitrate: state.settings.recordingBitrate,
        segmentMinutes: state.settings.recordingSegmentMinutes,
        source,
        eventName: state.settings.eventName,
        whitePlayer: state.settings.whitePlayer,
        blackPlayer: state.settings.blackPlayer,
      });
    } catch (err) {
      state.notify(
        `${translate(state.settings.lang, 'recordingError')}: ${err?.message || err}`,
        'error'
      );
    }
  }

  async function stopRecording() {
    const controller = recordingControllerRef.current;
    if (!controller) return;
    await controller.stop();
  }

  async function selectRecordingDirectory() {
    const controller = recordingControllerRef.current;
    if (!controller) return false;
    return controller.selectDirectory();
  }

  // Assign the latest handlers for the vision callbacks. The vision controller
  // is created once, so it always calls through this ref.
  handlersRef.current = {
    handleTrackEnded,
    handleVisionState,
    handleVisionDetection,
    handleTestDetection,
    handleVisionDrift,
    handleVisionError,
  };

  actionsRef.current = {
    startCamera,
    stopCamera,
    selectDevice,
    startRecording,
    stopRecording,
    selectRecordingDirectory,
    startShow,
    toggleOperator,
    openCalibration,
    closeCalibration,
    finishCalibration,
    runCameraFitCheck,
    captureBaseline: captureBaselineAction,
    syncBoard,
    applyUci,
    applyMoveText,
    playBoardMove,
    resolveCandidate,
    ignoreCandidates,
    newGameAction,
    undoAction,
    togglePause,
    flipBoard,
    toggleDemo,
    setLanguageAction,
    toggleFullscreen,
    initEngine,
    disposeEngine,
  };

  // ------------------------------------------------------------ vision setup
  useEffect(() => {
    const controller = new RecordingController({
      onState: (recState) => {
        useChessLens.getState().setRecording(recState);
      },
      onSegmentSaved: (meta) => {
        const state = useChessLens.getState();
        state.notify(
          `${translate(state.settings.lang, 'recordingSaved')}: ${meta.filename}`,
          'success',
        );
      },
      onError: (err) => {
        const state = useChessLens.getState();
        state.notify(
          `${translate(state.settings.lang, 'recordingError')}: ${err?.message || err}`,
          'error',
        );
      },
      onStorageLow: () => {
        const state = useChessLens.getState();
        state.notify(
          translate(state.settings.lang, 'storageWarning'),
          'warning',
        );
      },
    });
    recordingControllerRef.current = controller;
    return () => {
      controller.dispose();
      recordingControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const vision = new VisionController();
    visionRef.current = vision;
    vision.setCallbacks({
      onState: (payload) => handlersRef.current.handleVisionState?.(payload),
      onDetection: (payload) => handlersRef.current.handleVisionDetection?.(payload),
      onTestDetection: (payload) => handlersRef.current.handleTestDetection?.(payload),
      onDrift: (payload) => handlersRef.current.handleVisionDrift?.(payload),
      onError: (error) => handlersRef.current.handleVisionError?.(error),
    });
    vision.setLegalMovesProvider(() => {
      const state = useChessLens.getState();
      try {
        return new Chess(state.game.fen).moves({ verbose: true });
      } catch {
        return [];
      }
    });

    return () => {
      vision.stop();
      visionRef.current = null;
    };
  }, []);

  useEffect(() => {
    actionsRef.current.initEngine();
    return () => actionsRef.current.disposeEngine();
  }, []);

  // Periodic Camera Fit check (every 2 seconds while camera is live and not actively calibrating)
  useEffect(() => {
    if (cameraStatus !== 'live' || calibrating) return undefined;
    runCameraFitCheck();
    const interval = setInterval(() => {
      runCameraFitCheck();
    }, 2000);
    return () => clearInterval(interval);
  }, [cameraStatus, calibrating, calibration]);

  useEffect(() => {
    const vision = visionRef.current;
    if (!vision) return;
    const state = useChessLens.getState();

    if (cameraStatus === 'live' && calibration && !demoActive && !calibrating) {
      vision.setVideo(videoRef.current);
      vision.setCalibration(calibration, state.settings.flip);
      vision.setSensitivity(state.settings.motionSensitivity);
      vision.setSettleMs(state.settings.settleMs);
      if (state.settings.detectionPaused) vision.pause();
      else vision.start();
    } else {
      vision.stop();
    }
  }, [cameraStatus, calibration, demoActive, calibrating]);

  useEffect(() => {
    const vision = visionRef.current;
    if (!vision) return;
    if (!(cameraStatus === 'live' && calibration && !demoActive && !calibrating)) return;
    if (detectionPaused) vision.pause();
    else if (vision.paused) vision.resume();
  }, [detectionPaused, cameraStatus, calibration, demoActive, calibrating]);

  useEffect(() => {
    visionRef.current?.setFlip(flip);
  }, [flip]);

  useEffect(() => {
    visionRef.current?.setSensitivity(sensitivity);
  }, [sensitivity]);

  useEffect(() => {
    visionRef.current?.setSettleMs(settleMs);
  }, [settleMs]);

  // -------------------------------------------------------------- persistence
  useEffect(() => {
    saveSettings(persistableSettings(settings));
    document.documentElement.lang = settings.lang;
    document.documentElement.dir = languageDir(settings.lang);
  }, [settings]);

  useEffect(() => {
    if (!toastId) return undefined;
    const timer = setTimeout(() => useChessLens.getState().clearToast(toastId), 4200);
    return () => clearTimeout(timer);
  }, [toastId]);

  useEffect(() => {
    const handleOnline = () => useChessLens.getState().setOnline(true);
    const handleOffline = () => useChessLens.getState().setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let wakeLock = null;
    let released = false;

    async function requestWakeLock() {
      if ('wakeLock' in navigator && !released) {
        try {
          wakeLock = await navigator.wakeLock.request('screen');
        } catch {
          /* ignore */
        }
      }
    }

    requestWakeLock();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wakeLock) {
        wakeLock.release().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    const handleFullscreen = () => {
      useChessLens.getState().setUi({ fullscreen: Boolean(document.fullscreenElement) });
    };
    document.addEventListener('fullscreenchange', handleFullscreen);
    return () => document.removeEventListener('fullscreenchange', handleFullscreen);
  }, []);

  useEffect(() => {
    refreshDevices();
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return undefined;
    const handler = () => refreshDevices();
    mediaDevices.addEventListener('devicechange', handler);
    return () => mediaDevices.removeEventListener('devicechange', handler);
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const typing = target
        && (target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
          || target.isContentEditable);

      if (event.key === '`' || event.key === '~') {
        if (typing) return;
        event.preventDefault();
        actionsRef.current.toggleOperator();
      } else if (!typing && (event.key === 'f' || event.key === 'F') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        actionsRef.current.toggleFullscreen?.();
      } else if (!typing && (event.key === 'p' || event.key === 'P') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // Panic hotkey: instantly toggle/switch to Demo mode replay
        actionsRef.current.toggleDemo();
      } else if (!typing && ['1', '2', '3'].includes(event.key)) {
        const state = useChessLens.getState();
        if (state.vision.pending && state.vision.candidates.length > 0) {
          const index = Number(event.key) - 1;
          const candidate = state.vision.candidates[index];
          if (candidate) {
            event.preventDefault();
            actionsRef.current.resolveCandidate(candidate);
          }
        }
      } else if (event.key === 'Escape') {
        const state = useChessLens.getState();
        if (state.ui.calibrating) state.setUi({ calibrating: false });
        else if (state.ui.operatorOpen) state.setUi({ operatorOpen: false });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      cameraGenerationRef.current += 1;
      stopActiveStream();
      clearTimeout(syncTimerRef.current);
      visionRef.current?.stop();
    };
  }, []);

  // ------------------------------------------------------------- evaluation
  useEffect(() => {
    const state = useChessLens.getState();
    const { fen, ply, epoch, evalHistory, status } = state.game;
    if (status.over) return;

    const entry = evalHistory[ply];
    if (!entry) return;
    if (entry.eval && entry.source === 'engine') return;

    if (engineStatus !== 'ready' || !engineRef.current) {
      if (engineStatus === 'error' && entry.source !== 'engine') {
        const fallback = entry.eval || evalFromMaterial(fen);
        state.completeEval({
          ply,
          fen,
          evalWhite: fallback,
          bestMove: null,
          depth: 0,
          source: 'material',
          epoch,
        });
      }
      return;
    }

    const key = `${epoch}:${ply}:${fen}`;
    if (evalInFlightRef.current.has(key)) return;
    evalInFlightRef.current.add(key);

    let turn = 'w';
    try {
      turn = new Chess(fen).turn();
    } catch {
      turn = 'w';
    }

    engineRef.current.evaluate(fen, { movetime: engineMs, skillLevel })
      .then((result) => {
        const latest = useChessLens.getState();
        if (latest.game.epoch !== epoch) return;
        const normalized = result.score ? normalizeEngineScore(result.score, turn) : null;
        if (!normalized) {
          latest.completeEval({
            ply,
            fen,
            evalWhite: evalFromMaterial(fen),
            bestMove: result.bestMove,
            depth: result.depth,
            source: 'material',
            epoch,
          });
          return;
        }
        latest.completeEval({
          ply,
          fen,
          evalWhite: normalized,
          bestMove: result.bestMove,
          depth: result.depth,
          source: 'engine',
          epoch,
        });
      })
      .catch((error) => {
        console.warn('Stockfish evaluation failed', error);
        const latest = useChessLens.getState();
        if (latest.game.epoch !== epoch) return;
        latest.completeEval({
          ply,
          fen,
          evalWhite: evalFromMaterial(fen),
          bestMove: null,
          depth: 0,
          source: 'material',
          epoch,
        });
      })
      .finally(() => {
        evalInFlightRef.current.delete(key);
      });
  }, [gameFen, gamePly, gameEpoch, engineStatus, engineMs, skillLevel]);

  // ---------------------------------------------------------------- demo play
  useEffect(() => {
    if (!demoActive || demoFinished || demoMode !== 'opera') return undefined;
    if (demoIndex >= OPERA_GAME.moves.length) {
      useChessLens.getState().setDemo({ finished: true });
      return undefined;
    }

    const delay = demoIndex === 0 ? 900 : DEMO_MOVE_INTERVAL_MS;
    const timer = setTimeout(() => {
      const state = useChessLens.getState();
      const record = actionsRef.current.applyMoveText(OPERA_GAME.moves[demoIndex], 'demo');
      if (!record) {
        state.setDemo({ finished: true });
        state.notify(translate(state.settings.lang, 'demoFinished'), 'info');
        return;
      }
      state.setDemo({ index: demoIndex + 1 });
      if (record.gameOver?.over) {
        state.setDemo({ finished: true });
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [demoActive, demoIndex, demoFinished, demoMode]);

  // -------------------------------------------------------- vs computer play
  useEffect(() => {
    if (!demoActive || demoMode !== 'vs-computer') return undefined;
    const state = useChessLens.getState();
    if (state.game.status.over) return undefined;

    let turn = 'w';
    try {
      turn = new Chess(gameFen).turn();
    } catch {
      return undefined;
    }

    const isComputerTurn = turn !== (demoPlayerColor || 'w');
    if (!isComputerTurn) return undefined;

    const epoch = gameEpoch;
    const ply = gamePly;

    const timer = setTimeout(() => {
      const current = useChessLens.getState();
      if (!current.demo.active || current.demo.mode !== 'vs-computer') return;
      if (current.game.epoch !== epoch || current.game.ply !== ply || current.game.status.over) return;

      const engine = engineRef.current;
      if (!engine || current.engine.status !== 'ready') {
        const moves = new Chess(current.game.fen).moves({ verbose: true });
        if (moves.length > 0) {
          const move = moves[Math.floor(Math.random() * moves.length)];
          actionsRef.current.applyUci(`${move.from}${move.to}${move.promotion || ''}`, 'demo');
        }
        return;
      }

      engine
        .evaluate({
          fen: current.game.fen,
          movetime: Math.min(800, Math.max(300, current.settings.engineMs || 600)),
          skillLevel: current.settings.skillLevel,
        })
        .then((res) => {
          const latest = useChessLens.getState();
          if (!latest.demo.active || latest.demo.mode !== 'vs-computer') return;
          if (latest.game.epoch !== epoch || latest.game.ply !== ply || latest.game.status.over) return;

          let best = res.bestMove;
          if (!best) {
            const legals = new Chess(latest.game.fen).moves({ verbose: true });
            if (legals.length > 0) {
              const m = legals[0];
              best = `${m.from}${m.to}${m.promotion || ''}`;
            }
          }
          if (best) {
            actionsRef.current.applyUci(best, 'demo');
          }
        })
        .catch(() => {
          const legals = new Chess(useChessLens.getState().game.fen).moves({ verbose: true });
          if (legals.length > 0) {
            const m = legals[0];
            actionsRef.current.applyUci(`${m.from}${m.to}${m.promotion || ''}`, 'demo');
          }
        });
    }, 550);

    return () => clearTimeout(timer);
  }, [demoActive, demoMode, demoPlayerColor, gameFen, gamePly, gameEpoch]);

  // ------------------------------------------------------- optional LLM layer
  useEffect(() => {
    if (!llmEnabled || !llmKey || !online || demoActive) return;
    if (!lastRecord?.verdict) return;

    const key = `${lastRecord.id}:${lang}:${lastRecord.verdict}`;
    if (llmRequestRef.current.key === key) return;
    llmRequestRef.current.key = key;

    const context = buildLlmContext(lastRecord);
    requestLlmCommentary({
      baseUrl: llmBaseUrl,
      apiKey: llmKey,
      model: llmModel,
      lang,
      context,
    })
      .then((text) => {
        useChessLens.getState().applyLlmCommentary({
          moveId: lastRecord.id,
          lang,
          text,
        });
      })
      .catch(() => {
        // Offline, timeout, bad key: templates remain on screen.
      })
      .finally(() => {
        if (llmRequestRef.current.key === key) llmRequestRef.current.key = null;
      });
  }, [llmEnabled, llmKey, online, lastRecord?.id, lastRecord?.verdict, lang, llmBaseUrl, llmModel, demoActive]);

  const contextValue = useMemo(() => ({
    cameraStream,
    videoRef,
    startCamera: (...args) => actionsRef.current.startCamera(...args),
    stopCamera: () => actionsRef.current.stopCamera(),
    selectDevice: (...args) => actionsRef.current.selectDevice(...args),
    startRecording: () => actionsRef.current.startRecording(),
    stopRecording: () => actionsRef.current.stopRecording(),
    selectRecordingDirectory: () => actionsRef.current.selectRecordingDirectory(),
    startShow: (...args) => actionsRef.current.startShow(...args),
    toggleOperator: () => actionsRef.current.toggleOperator(),
    openCalibration: () => actionsRef.current.openCalibration(),
    closeCalibration: () => actionsRef.current.closeCalibration(),
    finishCalibration: (...args) => actionsRef.current.finishCalibration(...args),
    syncBoard: () => actionsRef.current.syncBoard(),
    applyManualMove: (...args) => actionsRef.current.applyMoveText(...args),
    playBoardMove: (...args) => actionsRef.current.playBoardMove(...args),
    applyUci: (...args) => actionsRef.current.applyUci(...args),
    resolveCandidate: (...args) => actionsRef.current.resolveCandidate(...args),
    ignoreCandidates: () => actionsRef.current.ignoreCandidates(),
    newGame: () => actionsRef.current.newGameAction(),
    undo: () => actionsRef.current.undoAction(),
    togglePause: () => actionsRef.current.togglePause(),
    flipBoard: () => actionsRef.current.flipBoard(),
    toggleDemo: (...args) => actionsRef.current.toggleDemo(...args),
    setLanguage: (...args) => actionsRef.current.setLanguageAction(...args),
    restartEngine: () => actionsRef.current.initEngine(),
    requestFullscreen: () => requestFullscreen(),
    exitFullscreen: () => exitFullscreen(),
    toggleFullscreen: () => toggleFullscreen(),
    setTestMode: (enabled) => visionRef.current?.setTestMode(enabled),
    runCameraFitCheck: (...args) => runCameraFitCheck(...args),
    captureBaseline: (type) => captureBaselineAction(type),
    startVisionRecording: () => visionRef.current?.startRecording(),
    stopVisionRecording: () => visionRef.current?.stopRecording(),
    getVisionRecordedFrames: () => visionRef.current?.getRecordedFrames() || [],
    loadVisionRecordedFrames: (frames) => visionRef.current?.loadRecordedFrames(frames),
    replayVisionFrame: (frame) => visionRef.current?.replayFrame(frame),
    getDebugCanvas: () => visionRef.current?.getDebugCanvas() || null,
    getVisionDebugState: () => visionRef.current?.getDebugState() || null,
  }), [cameraStream]);

  return (
    <ShowContext.Provider value={contextValue}>
      {children}
      <video
        ref={videoRef}
        className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
        autoPlay
        muted
        playsInline
        aria-hidden="true"
      />
    </ShowContext.Provider>
  );
}

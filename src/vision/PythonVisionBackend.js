import { VisionBackend } from './VisionBackend.js';
import { PythonVisionClient } from './PythonVisionClient.js';

export class PythonVisionBackend extends VisionBackend {
  constructor({ url } = {}) {
    super('python', 'Python Vision Service');
    this.client = new PythonVisionClient({
      url,
      onObservation: (obs) => this.#handleObservation(obs),
      onState: (st) => this.#handleState(st),
      onProposal: (prop) => this.onProposalCallback?.(prop),
      onError: (err) => this.callbacks.onError?.(err),
      onConnectionChange: (connected, healthy) => this.onConnectionChangeCallback?.(connected, healthy),
    });

    this.video = null;
    this.calibration = null;
    this.flip = false;
    this.sensitivity = 1.0;
    this.settleMs = 400;
    this.currentFen = null;
    this.currentPly = 0;
    this.testMode = false;

    this.running = false;
    this.paused = false;
    this.raf = 0;
    this.lastFrameSentAt = 0;
    this.targetFps = 12;

    this.sendCanvas = null;
    this.sendCtx = null;

    this.pending = null;
    this.lastObservation = null;
    this.lastState = { mode: 'idle', fps: 0, latencyMs: 0, cpu: 0 };

    this.callbacks = {
      onState: null,
      onDetection: null,
      onTestDetection: null,
      onDrift: null,
      onError: null,
    };
    this.onProposalCallback = null;
    this.onConnectionChangeCallback = null;
  }

  setCallbacks(callbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  setOnProposal(callback) {
    this.onProposalCallback = callback;
  }

  setOnConnectionChange(callback) {
    this.onConnectionChangeCallback = callback;
  }

  setVideo(video) {
    this.video = video;
  }

  setCalibration(calibration, flip) {
    this.calibration = calibration;
    this.flip = Boolean(flip);
    if (this.client.connected && calibration?.corners) {
      const corners = calibration.corners.map((p) => [p.x, p.y]);
      this.client.setCalibration(corners, this.flip, this.flip ? 'black' : 'white');
    }
  }

  setFlip(flip) {
    this.flip = Boolean(flip);
    if (this.calibration) {
      this.setCalibration(this.calibration, this.flip);
    }
  }

  setSensitivity(sensitivity) {
    this.sensitivity = sensitivity;
    if (this.client.connected) {
      this.client.setConfig({ motionSensitivity: sensitivity });
    }
  }

  setSettleMs(settleMs) {
    this.settleMs = settleMs;
    if (this.client.connected) {
      this.client.setConfig({ settleMs });
    }
  }

  setPosition(fen, ply = 0) {
    this.currentFen = fen;
    this.currentPly = ply;
    if (this.client.connected) {
      this.client.setPosition(fen, ply);
    }
  }

  setTestMode(enabled) {
    this.testMode = Boolean(enabled);
  }

  autoCalibrate() {
    return this.client.autoCalibrate();
  }

  start() {
    this.client.connect();
    this.running = true;
    this.paused = false;
    this.#startFrameLoop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.client.disconnect();
  }

  pause() {
    this.paused = true;
    this.pending = null;
  }

  resume() {
    this.paused = false;
    this.pending = null;
    if (this.currentFen) {
      this.client.learnFromCurrentFrame(this.currentFen);
    }
  }

  syncReference() {
    if (this.currentFen) {
      this.client.learnFromCurrentFrame(this.currentFen);
      return true;
    }
    return false;
  }

  commitPending() {
    this.pending = null;
    return true;
  }

  rejectPending() {
    this.pending = null;
  }

  resync() {
    this.pending = null;
    return this.syncReference();
  }

  captureBaseline(type = 'start') {
    if (type === 'start') {
      this.client.learnStartPosition();
      return true;
    }
    return false;
  }

  getDebugCanvas() {
    return null;
  }

  getDebugState() {
    return {
      mode: this.lastState.mode || 'idle',
      fps: this.lastState.fps || 0,
      latencyMs: this.lastState.latencyMs || 0,
      pending: Boolean(this.pending),
      lastObservation: this.lastObservation,
    };
  }

  isHealthy() {
    return this.client.isHealthy();
  }

  #startFrameLoop() {
    cancelAnimationFrame(this.raf);
    const loop = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (this.paused) return;

      const minInterval = 1000 / this.targetFps;
      if (now - this.lastFrameSentAt < minInterval) return;

      this.#captureAndSendFrame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  #captureAndSendFrame(now) {
    const video = this.video;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

    if (!this.client.connected || !this.client.handshakeComplete) return;

    // Downscale to max 640x480 keeping aspect ratio
    const maxWidth = 640;
    const maxHeight = 480;
    const scale = Math.min(1, maxWidth / video.videoWidth, maxHeight / video.videoHeight);
    const w = Math.max(2, Math.round(video.videoWidth * scale));
    const h = Math.max(2, Math.round(video.videoHeight * scale));

    if (!this.sendCanvas) {
      this.sendCanvas = document.createElement('canvas');
      this.sendCtx = this.sendCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (this.sendCanvas.width !== w || this.sendCanvas.height !== h) {
      this.sendCanvas.width = w;
      this.sendCanvas.height = h;
    }

    this.sendCtx.drawImage(video, 0, 0, w, h);
    this.lastFrameSentAt = now;

    this.sendCanvas.toBlob(
      async (blob) => {
        if (!blob) return;
        const buffer = await blob.arrayBuffer();
        this.client.sendFrame(buffer, w, h);
      },
      'image/jpeg',
      0.75,
    );
  }

  #handleState(stateMsg) {
    this.lastState = {
      mode: stateMsg.state || 'idle',
      fps: stateMsg.fps || 0,
      latencyMs: stateMsg.latencyMs || 0,
      cpu: stateMsg.cpu || 0,
    };
    this.callbacks.onState?.({
      mode: stateMsg.state || 'idle',
      motion: 0,
      cellDiffs: [],
      fps: stateMsg.fps || 0,
      latencyMs: stateMsg.latencyMs || 0,
      backend: 'python',
    });
  }

  #handleObservation(obs) {
    this.lastObservation = obs;

    if (obs.drift) {
      this.callbacks.onDrift?.({ changedCount: obs.changedCells?.length || 0 });
      return;
    }

    if (obs.occluded) {
      this.callbacks.onState?.({
        mode: 'occluded',
        occluded: true,
        occlusionReason: 'Hand/arm detected by Python service',
        backend: 'python',
      });
      return;
    }

    if (!obs.stable || !obs.candidates?.length) {
      return;
    }

    const changedCells = (obs.changedCells || []).map((c) => c.cell ?? c.r * 8 + c.c);
    const candidates = obs.candidates.map((c) => ({
      uci: c.uci,
      score: c.score,
      scorePercent: Math.round(c.score * 100),
      margin: c.margin,
    }));

    const best = candidates[0];
    const second = candidates[1];
    const margin = best.margin ?? (best.score - (second?.score ?? 0));
    const autoAccept = (
      best.score >= 0.72 &&
      margin >= 0.15 &&
      changedCells.length <= 10
    );

    const payload = {
      changedCells,
      candidates: candidates.slice(0, 3),
      autoAccept,
      best,
      second,
      margin,
      backend: 'python',
    };

    if (this.testMode) {
      this.callbacks.onTestDetection?.(payload);
      return;
    }

    this.pending = payload;
    this.callbacks.onDetection?.(payload);
  }

  dispose() {
    this.stop();
  }
}

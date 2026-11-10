import { VisionBackend } from '../VisionBackend.js';
import { warpBoard512, WARP_SIZE_V2 } from './warp.js';
import { refineCorners, computeGridAlignmentScoreFromWarp } from './cornerRefinement.js';

/**
 * Concrete VisionBackend implementation for Vision v2.
 * High-precision, explainable JavaScript board-reading engine.
 */
export class V2VisionBackend extends VisionBackend {
  constructor() {
    super('v2', 'JavaScript Vision v2');
    this.video = null;
    this.calibration = null;
    this.flip = false;
    this.sensitivity = 'medium';
    this.settleMs = 600;
    this.currentFen = null;
    this.currentPly = 0;
    this.running = false;
    this.paused = false;
    this.testMode = false;

    this.callbacks = {
      onState: null,
      onDetection: null,
      onTestDetection: null,
      onDrift: null,
      onError: null,
    };

    this.lastWarpedBoard = null;
    this.lastGridScore = null;
    this.lastRefinement = null;
  }

  setCallbacks(callbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  setVideo(video) {
    this.video = video;
  }

  setCalibration(calibration, flip) {
    this.calibration = calibration;
    this.flip = Boolean(flip);
  }

  setFlip(flip) {
    this.flip = Boolean(flip);
  }

  setSensitivity(sensitivity) {
    this.sensitivity = sensitivity;
  }

  setSettleMs(settleMs) {
    this.settleMs = settleMs;
  }

  setPosition(fen, ply = 0) {
    this.currentFen = fen;
    this.currentPly = ply;
  }

  setTestMode(enabled) {
    this.testMode = Boolean(enabled);
  }

  start() {
    this.running = true;
    this.paused = false;
  }

  stop() {
    this.running = false;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.running = true;
  }

  refineCurrentCorners(sourceFrame = null) {
    const src = sourceFrame || this.video;
    const corners = this.calibration?.corners || this.calibration;
    if (!corners || !src) return null;

    const res = refineCorners({
      corners,
      source: src,
      sourceWidth: src.videoWidth || src.width,
      sourceHeight: src.videoHeight || src.height,
    });
    this.lastRefinement = res;
    return res;
  }

  getGridAlignmentScore(warpImageData = null) {
    if (warpImageData) {
      return computeGridAlignmentScoreFromWarp(warpImageData);
    }
    if (this.lastWarpedBoard) {
      return computeGridAlignmentScoreFromWarp(this.lastWarpedBoard);
    }
    return null;
  }

  getDebugState() {
    return {
      id: this.id,
      name: this.name,
      running: this.running,
      paused: this.paused,
      settleMs: this.settleMs,
      lastGridScore: this.lastGridScore,
      lastRefinement: this.lastRefinement,
    };
  }
}

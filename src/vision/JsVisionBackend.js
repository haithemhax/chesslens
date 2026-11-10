import { VisionBackend } from './VisionBackend.js';
import { VisionController } from './VisionController.js';

/**
 * Concrete VisionBackend wrapping the existing, battle-tested JavaScript VisionController.
 * Zero changes to existing detection logic.
 */
export class JsVisionBackend extends VisionBackend {
  constructor(controller = null) {
    super('js', 'JavaScript Vision');
    this._controller = controller;
  }

  get controller() {
    if (!this._controller) {
      this._controller = new VisionController();
    }
    return this._controller;
  }

  setCallbacks(callbacks) {
    this.controller.setCallbacks(callbacks);
  }

  setLegalMovesProvider(provider) {
    this.controller.setLegalMovesProvider(provider);
  }

  setVideo(video) {
    this.controller.setVideo(video);
  }

  setCalibration(calibration, flip) {
    this.controller.setCalibration(calibration, flip);
  }

  setFlip(flip) {
    this.controller.setFlip(flip);
  }

  setSensitivity(sensitivity) {
    this.controller.setSensitivity(sensitivity);
  }

  setSettleMs(settleMs) {
    this.controller.setSettleMs(settleMs);
  }

  setPosition(fen, ply) {
    // JS backend uses legalMovesProvider to query chess.js directly,
    // but stores fen for reconciliation if needed.
    this.currentFen = fen;
  }

  setTestMode(enabled) {
    this.controller.setTestMode(enabled);
  }

  start() {
    this.controller.start();
  }

  stop() {
    this.controller.stop();
  }

  pause() {
    this.controller.pause();
  }

  resume() {
    this.controller.resume();
  }

  syncReference() {
    return this.controller.syncReference();
  }

  commitPending() {
    return this.controller.commitPending();
  }

  rejectPending() {
    this.controller.rejectPending();
  }

  resync() {
    return this.controller.resync();
  }

  reconcilePhysicalBoard(fen) {
    return this.controller.reconcilePhysicalBoard(fen);
  }

  captureBaseline(type = 'start') {
    return this.controller.captureBaseline(type);
  }

  getDebugCanvas() {
    return this.controller.getDebugCanvas();
  }

  getDebugState() {
    return this.controller.getDebugState();
  }

  startRecording() {
    this.controller.startRecording();
  }

  stopRecording() {
    return this.controller.stopRecording();
  }

  getRecordedFrames() {
    return this.controller.getRecordedFrames();
  }

  loadRecordedFrames(frames) {
    this.controller.loadRecordedFrames(frames);
  }

  replayFrame(frame) {
    this.controller.replayFrame(frame);
  }

  dispose() {
    this.controller.stop();
  }
}

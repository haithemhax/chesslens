/**
 * Abstract interface for Vision Backends (JS or Python).
 */
export class VisionBackend {
  constructor(id, name) {
    if (new.target === VisionBackend) {
      throw new TypeError('Cannot construct VisionBackend instances directly');
    }
    this.id = id;
    this.name = name;
  }

  // Lifecycle
  start() {}
  stop() {}
  pause() {}
  resume() {}
  dispose() {}

  // Configuration
  setVideo(video) {}
  setCalibration(calibration, flip) {}
  setFlip(flip) {}
  setSensitivity(sensitivity) {}
  setSettleMs(settleMs) {}
  setPosition(fen, ply) {}
  setTestMode(enabled) {}

  // Reference & State synchronization
  syncReference() { return false; }
  commitPending() { return false; }
  rejectPending() {}
  resync() { return false; }
  captureBaseline(type = 'start') { return null; }

  // Diagnostics & Replay
  getDebugCanvas() { return null; }
  getDebugState() { return {}; }
  startRecording() {}
  stopRecording() { return []; }
  getRecordedFrames() { return []; }
  loadRecordedFrames(frames) {}
  replayFrame(frame) {}

  // Callbacks
  setCallbacks({ onState, onDetection, onTestDetection, onDrift, onError }) {}
}

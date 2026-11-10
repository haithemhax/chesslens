import { JsVisionBackend } from './JsVisionBackend.js';
import { PythonVisionBackend } from './PythonVisionBackend.js';

export const VISION_MODES = {
  JS_ONLY: 'js',
  AUTO: 'auto',
  PYTHON_ONLY: 'python',
  SHADOW: 'shadow',
};

const HEALTHY_STREAK_REQUIRED = 20;
const MIN_SWITCH_INTERVAL_MS = 60000; // at most once per minute

export class VisionRouter {
  constructor({
    jsBackend = null,
    pythonBackend = null,
    mode = VISION_MODES.JS_ONLY,
    onFallback = null,
    onShadowMismatch = null,
    onDetection = null,
    onState = null,
    onError = null,
  } = {}) {
    this.js = jsBackend || new JsVisionBackend();
    this.python = pythonBackend || new PythonVisionBackend();

    this.mode = Object.values(VISION_MODES).includes(mode) ? mode : VISION_MODES.JS_ONLY;
    this.authoritativeBackend = this.mode === VISION_MODES.PYTHON_ONLY ? this.python : this.js;

    this.callbacks = {
      onFallback: onFallback || null,
      onShadowMismatch: onShadowMismatch || null,
      onDetection: onDetection || null,
      onState: onState || null,
      onError: onError || null,
    };

    this.healthyStreak = 0;
    this.lastSwitchAt = 0;
    this.lastAuthoritativeMove = null;
    this.shadowMismatches = [];
    this.shadowMismatchCount = 0;

    this.currentFen = null;
    this.currentPly = 0;
    this.video = null;
    this.calibration = null;
    this.flip = false;

    this.#wireBackends();
  }

  #wireBackends() {
    this.js.setCallbacks({
      onState: (state) => this.#handleBackendState('js', state),
      onDetection: (detection) => this.#handleBackendDetection('js', detection),
      onTestDetection: (test) => this.#handleBackendTest('js', test),
      onDrift: (drift) => this.#handleBackendDrift('js', drift),
      onError: (err) => this.#handleBackendError('js', err),
    });

    this.python.setCallbacks({
      onState: (state) => this.#handleBackendState('python', state),
      onDetection: (detection) => this.#handleBackendDetection('python', detection),
      onTestDetection: (test) => this.#handleBackendTest('python', test),
      onDrift: (drift) => this.#handleBackendDrift('python', drift),
      onError: (err) => this.#handleBackendError('python', err),
    });

    this.python.setOnConnectionChange((connected, healthy) => {
      this.#evaluateHealth();
    });
  }

  setMode(mode) {
    if (!Object.values(VISION_MODES).includes(mode)) return;
    if (this.mode === mode) return;

    const oldMode = this.mode;
    this.mode = mode;

    let targetBackend = this.js;
    if (mode === VISION_MODES.PYTHON_ONLY) {
      targetBackend = this.python;
    } else if (mode === VISION_MODES.AUTO) {
      targetBackend = this.python.isHealthy() ? this.python : this.js;
    } else {
      // JS_ONLY and SHADOW both use JS as authoritative
      targetBackend = this.js;
    }

    if (this.authoritativeBackend !== targetBackend) {
      this.#switchAuthoritative(targetBackend, `Mode changed from ${oldMode} to ${mode}`);
    }

    // Ensure appropriate backends are running
    if (mode === VISION_MODES.JS_ONLY) {
      this.python.stop();
      this.js.start();
    } else if (mode === VISION_MODES.PYTHON_ONLY) {
      this.js.stop();
      this.python.start();
    } else {
      // AUTO and SHADOW run both
      this.js.start();
      this.python.start();
    }
  }

  #switchAuthoritative(newBackend, reason) {
    const prev = this.authoritativeBackend;
    this.authoritativeBackend = newBackend;
    this.lastSwitchAt = performance.now();

    // Notify fallback / switch handler
    this.callbacks.onFallback?.({
      from: prev.id,
      to: newBackend.id,
      reason,
      timestamp: Date.now(),
    });

    // Synchronize current position and baseline to the new backend
    if (this.currentFen) {
      newBackend.setPosition(this.currentFen, this.currentPly);
      newBackend.syncReference();
    }
  }

  evaluateHealth() {
    this.#evaluateHealth();
  }

  #evaluateHealth() {
    if (this.mode !== VISION_MODES.AUTO) return;

    const healthy = this.python.isHealthy();
    const now = performance.now();

    if (this.authoritativeBackend === this.python && !healthy) {
      // Python became unhealthy while authoritative: fallback to JS
      this.healthyStreak = 0;
      this.#switchAuthoritative(this.js, 'Python backend became unhealthy or disconnected');
    } else if (this.authoritativeBackend === this.js && healthy) {
      this.healthyStreak += 1;
      const canSwitch = now - this.lastSwitchAt >= MIN_SWITCH_INTERVAL_MS;
      if (this.healthyStreak >= HEALTHY_STREAK_REQUIRED && canSwitch) {
        this.healthyStreak = 0;
        this.#switchAuthoritative(this.python, 'Python restored after sustained healthy window');
      }
    } else if (!healthy) {
      this.healthyStreak = 0;
    }
  }

  #handleBackendState(backendId, state) {
    if (backendId === 'python') {
      this.#evaluateHealth();
    }
    if (this.authoritativeBackend.id === backendId) {
      this.callbacks.onState?.({ ...state, backend: backendId });
    }
  }

  #handleBackendDetection(backendId, payload) {
    if (this.mode === VISION_MODES.SHADOW) {
      // JS is authoritative, Python is shadow
      if (backendId === 'js') {
        this.lastAuthoritativeMove = payload.best?.uci || null;
        this.callbacks.onDetection?.({ ...payload, backend: 'js' });
      } else if (backendId === 'python') {
        const pyMove = payload.best?.uci || null;
        if (this.lastAuthoritativeMove && pyMove && this.lastAuthoritativeMove !== pyMove) {
          this.shadowMismatchCount += 1;
          const mismatchEntry = {
            jsUci: this.lastAuthoritativeMove,
            pyUci: pyMove,
            fen: this.currentFen,
            ts: Date.now(),
          };
          this.shadowMismatches.push(mismatchEntry);
          if (this.shadowMismatches.length > 50) this.shadowMismatches.shift();
          this.callbacks.onShadowMismatch?.(mismatchEntry, this.shadowMismatchCount);
        }
      }
      return;
    }

    if (this.authoritativeBackend.id === backendId) {
      this.callbacks.onDetection?.({ ...payload, backend: backendId });
    }
  }

  #handleBackendTest(backendId, testPayload) {
    if (this.authoritativeBackend.id === backendId) {
      this.callbacks.onTestDetection?.({ ...testPayload, backend: backendId });
    }
  }

  #handleBackendDrift(backendId, driftPayload) {
    if (this.authoritativeBackend.id === backendId) {
      this.callbacks.onDrift?.({ ...driftPayload, backend: backendId });
    }
  }

  #handleBackendError(backendId, error) {
    if (backendId === 'python' && this.mode === VISION_MODES.AUTO) {
      this.#evaluateHealth();
    }
    if (this.authoritativeBackend.id === backendId) {
      this.callbacks.onError?.(error);
    }
  }

  // Delegated backend controls
  setVideo(video) {
    this.video = video;
    this.js.setVideo(video);
    this.python.setVideo(video);
  }

  setCalibration(calibration, flip) {
    this.calibration = calibration;
    this.flip = Boolean(flip);
    this.js.setCalibration(calibration, flip);
    this.python.setCalibration(calibration, flip);
  }

  setFlip(flip) {
    this.flip = Boolean(flip);
    this.js.setFlip(flip);
    this.python.setFlip(flip);
  }

  setSensitivity(sensitivity) {
    this.js.setSensitivity(sensitivity);
    this.python.setSensitivity(sensitivity);
  }

  setSettleMs(settleMs) {
    this.js.setSettleMs(settleMs);
    this.python.setSettleMs(settleMs);
  }

  setPosition(fen, ply = 0) {
    this.currentFen = fen;
    this.currentPly = ply;
    this.js.setPosition(fen, ply);
    this.python.setPosition(fen, ply);
  }

  setTestMode(enabled) {
    this.js.setTestMode(enabled);
    this.python.setTestMode(enabled);
  }

  setLegalMovesProvider(provider) {
    this.js.setLegalMovesProvider(provider);
  }

  start() {
    if (this.mode === VISION_MODES.JS_ONLY) {
      this.js.start();
    } else if (this.mode === VISION_MODES.PYTHON_ONLY) {
      this.python.start();
    } else {
      this.js.start();
      this.python.start();
    }
  }

  stop() {
    this.js.stop();
    this.python.stop();
  }

  pause() {
    this.js.pause();
    this.python.pause();
  }

  resume() {
    this.js.resume();
    this.python.resume();
  }

  syncReference() {
    return this.authoritativeBackend.syncReference();
  }

  commitPending() {
    return this.authoritativeBackend.commitPending();
  }

  rejectPending() {
    this.authoritativeBackend.rejectPending();
  }

  resync() {
    return this.authoritativeBackend.resync();
  }

  reconcilePhysicalBoard(fen) {
    return this.js.reconcilePhysicalBoard(fen);
  }

  captureBaseline(type = 'start') {
    const jsBase = this.js.captureBaseline(type);
    this.python.captureBaseline(type);
    return jsBase;
  }

  getDebugCanvas() {
    return this.authoritativeBackend.getDebugCanvas() || this.js.getDebugCanvas();
  }

  getDebugState() {
    const active = this.authoritativeBackend.getDebugState();
    return {
      ...active,
      routerMode: this.mode,
      activeBackendId: this.authoritativeBackend.id,
      pythonHealthy: this.python.isHealthy(),
      shadowMismatchCount: this.shadowMismatchCount,
    };
  }

  startRecording() {
    this.js.startRecording();
  }

  stopRecording() {
    return this.js.stopRecording();
  }

  getRecordedFrames() {
    return this.js.getRecordedFrames();
  }

  loadRecordedFrames(frames) {
    this.js.loadRecordedFrames(frames);
  }

  replayFrame(frame) {
    this.js.replayFrame(frame);
  }

  autoCalibrate() {
    return this.python.autoCalibrate();
  }
}

import { buildWarpMap } from '../lib/homography.js';
import {
  detectHandOrOcclusion,
  findMatchingMoveSequence,
  scoreMoveAgainstChanges,
} from '../lib/classification.js';

// Top-down image resolution. Each board cell is 64x64 px.
const DEST_SIZE = 512;
const GRID = 8;
const CELL_SIZE = DEST_SIZE / GRID; // 64
const BLOCK_SIZE = 8;
const BLOCKS_PER_CELL = (CELL_SIZE / BLOCK_SIZE) ** 2; // 64
const VALUES_PER_BLOCK = 4; // r, g, b, gradient
const VALUES_PER_CELL = BLOCKS_PER_CELL * VALUES_PER_BLOCK; // 256
const SAMPLE_STEP = 2; // analyse every other pixel
const PROCESS_INTERVAL_MS = 1000 / 15; // ~15 fps is plenty for a chess board
const ANALYSIS_COOLDOWN_MS = 700;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Owns the camera-analysis loop. It never touches React directly; the provider
 * receives callbacks and mirrors the interesting state into the store.
 *
 * Detection idea: build a lighting-normalized descriptor of every cell
 * (8x8 block colour + gradient energy). Compare descriptors, not piece types.
 * Legal moves are then scored against the observed changed cells.
 */
export class VisionController {
  constructor() {
    this.video = null;
    this.calibration = null;
    this.flip = false;
    this.sensitivity = 1;
    this.settleMs = 400;
    this.paused = false;
    this.running = false;
    this.raf = 0;
    this.lastProcessAt = 0;

    this.sourceCanvas = document.createElement('canvas');
    this.sourceCtx = this.sourceCanvas.getContext('2d', { willReadFrequently: true });
    this.warpCanvas = document.createElement('canvas');
    this.warpCanvas.width = DEST_SIZE;
    this.warpCanvas.height = DEST_SIZE;
    this.warpCtx = this.warpCanvas.getContext('2d', { willReadFrequently: true });
    this.warpImage = this.warpCtx.createImageData(DEST_SIZE, DEST_SIZE);
    for (let i = 3; i < this.warpImage.data.length; i += 4) this.warpImage.data[i] = 255;

    this.warpMap = null;
    this.sourceWidth = 0;
    this.sourceHeight = 0;

    this.descriptor = new Float32Array(GRID * GRID * VALUES_PER_CELL);
    this.previousDescriptor = new Float32Array(GRID * GRID * VALUES_PER_CELL);
    this.reference = null;
    this.hasPrevious = false;
    this.cellDiffs = new Float32Array(GRID * GRID);
    this.lastCellDiffs = new Float32Array(GRID * GRID);
    this.refDiffs = new Float32Array(GRID * GRID);

    this.mode = 'idle';
    this.motion = 0;
    this.occluded = false;
    this.occlusionReason = null;
    this.driftDetected = false;
    this.driftCandidateSince = null;
    this.testMode = false;
    this.recording = false;
    this.recordedFrames = [];
    this.startBaseline = null;
    this.emptyBaseline = null;
    this.stableSince = null;
    this.lastAnalysisAt = 0;
    this.lastEmitAt = 0;
    this.lastEmittedMode = null;
    this.syncOnNextFrame = true;

    this.pending = null;
    this.callbacks = {
      onState: null,
      onDetection: null,
      onTestDetection: null,
      onDrift: null,
      onError: null,
    };
    this.legalMovesProvider = null;
  }

  setCallbacks({ onState, onDetection, onTestDetection, onDrift, onError }) {
    this.callbacks.onState = onState || null;
    this.callbacks.onDetection = onDetection || null;
    this.callbacks.onTestDetection = onTestDetection || null;
    this.callbacks.onDrift = onDrift || null;
    this.callbacks.onError = onError || null;
  }

  setLegalMovesProvider(provider) {
    this.legalMovesProvider = provider;
  }

  setTestMode(testMode) {
    this.testMode = Boolean(testMode);
  }

  startRecording() {
    this.recording = true;
    this.recordedFrames = [];
  }

  stopRecording() {
    this.recording = false;
    return this.recordedFrames;
  }

  getRecordedFrames() {
    return this.recordedFrames;
  }

  loadRecordedFrames(frames) {
    if (Array.isArray(frames)) {
      this.recordedFrames = frames;
    }
  }

  captureBaseline(type = 'start') {
    if (!this.reference && !this.descriptor) return null;
    const data = Array.from(this.descriptor);
    if (type === 'start') this.startBaseline = new Float32Array(data);
    else if (type === 'empty') this.emptyBaseline = new Float32Array(data);
    return data;
  }

  reconcilePhysicalBoard(gameFen) {
    if (!this.reference) return null;
    // Calculate differences against the current physical board reference
    this.#diffDescriptors(this.reference, this.cellDiffs);
    const changeThreshold = 0.1 / this.sensitivity;
    const changedCells = [];
    for (let cell = 0; cell < GRID * GRID; cell += 1) {
      if (this.cellDiffs[cell] >= changeThreshold) changedCells.push(cell);
    }
    return findMatchingMoveSequence(gameFen, changedCells, this.flip);
  }

  setVideo(video) {
    this.video = video;
    this.warpMap = null;
    this.reference = null;
    this.hasPrevious = false;
    this.syncOnNextFrame = true;
    this.#resetTemporal();
  }

  setCalibration(calibration, flip) {
    this.calibration = calibration;
    this.flip = Boolean(flip);
    if (calibration?.startBaseline) {
      this.startBaseline = new Float32Array(calibration.startBaseline);
    }
    if (calibration?.emptyBaseline) {
      this.emptyBaseline = new Float32Array(calibration.emptyBaseline);
    }
    this.warpMap = null;
    this.reference = null;
    this.hasPrevious = false;
    this.syncOnNextFrame = true;
    this.pending = null;
    this.#resetTemporal();
    this.#emitState(true);
  }

  setFlip(flip) {
    this.flip = Boolean(flip);
  }

  setSensitivity(value) {
    this.sensitivity = clamp(Number(value) || 1, 0.3, 3);
  }

  setSettleMs(value) {
    this.settleMs = clamp(Number(value) || 400, 200, 1500);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastProcessAt = 0;
    this.raf = requestAnimationFrame(this.#loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.#setMode('idle');
  }

  pause() {
    this.paused = true;
    this.pending = null;
    this.#resetTemporal();
    this.#setMode('paused');
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.reference = null;
    this.syncOnNextFrame = true;
    this.pending = null;
    this.#resetTemporal();
    this.#setMode('watching');
  }

  /** Force the current stable board to become the new reference. */
  syncReference() {
    if (!this.video || !this.calibration) return false;
    // Do not anchor on an arbitrary frame: wait until the board has been
    // still for one settle window. This avoids anchoring on a hand or a
    // piece that is still being placed.
    this.pending = null;
    this.syncOnNextFrame = true;
    this.stableSince = null;
    this.lastAnalysisAt = performance.now();
    this.#setMode('watching');
    return true;
  }

  /** Accept the snapshot that produced the current candidates. */
  commitPending() {
    if (!this.pending) return false;
    this.reference = this.pending.descriptor;
    this.pending = null;
    this.lastAnalysisAt = performance.now();
    this.stableSince = null;
    this.#setMode('watching');
    return true;
  }

  /** Throw away the candidate snapshot but keep the old reference. */
  rejectPending() {
    this.pending = null;
    this.lastAnalysisAt = performance.now();
    this.stableSince = null;
    this.#setMode('watching');
  }

  /** Ignore the observed board and re-anchor to it. */
  resync() {
    this.pending = null;
    const synced = this.syncReference();
    if (!synced) this.syncOnNextFrame = true;
    return synced;
  }

  getDebugCanvas() {
    return this.warpCanvas;
  }

  getDebugState() {
    return {
      motion: this.motion,
      cellDiffs: this.lastCellDiffs,
      mode: this.mode,
      occluded: this.occluded,
      occlusionReason: this.occlusionReason,
      driftDetected: this.driftDetected,
      testMode: this.testMode,
      recording: this.recording,
      recordedFramesCount: this.recordedFrames.length,
      pending: Boolean(this.pending),
    };
  }

  replayFrame(frame) {
    if (!frame) return;
    if (Array.isArray(frame.cellDiffs) && frame.cellDiffs.length === 64) {
      for (let i = 0; i < 64; i += 1) this.lastCellDiffs[i] = frame.cellDiffs[i];
    }
    this.motion = frame.motion ?? 0;
    this.mode = frame.mode ?? 'watching';
    this.#emitState(true);
  }

  #loop = (now) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.#loop);
    if (this.paused) return;
    if (now - this.lastProcessAt < PROCESS_INTERVAL_MS) return;
    this.lastProcessAt = now;

    try {
      this.#processFrame(now);
    } catch (error) {
      this.#setMode('error');
      if (this.callbacks.onError) {
        try {
          this.callbacks.onError(error);
        } catch {
          /* ignore callback errors */
        }
      }
    }
  };

  #processFrame(now) {
    const video = this.video;
    if (!video || !this.calibration) return;
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

    const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
    const sourceWidth = Math.max(2, Math.round(video.videoWidth * scale));
    const sourceHeight = Math.max(2, Math.round(video.videoHeight * scale));

    if (sourceWidth !== this.sourceWidth || sourceHeight !== this.sourceHeight) {
      this.sourceWidth = sourceWidth;
      this.sourceHeight = sourceHeight;
      this.sourceCanvas.width = sourceWidth;
      this.sourceCanvas.height = sourceHeight;
      this.warpMap = null;
    }

    if (!this.warpMap) {
      this.warpMap = buildWarpMap({
        corners: this.calibration.corners,
        destSize: DEST_SIZE,
        sourceWidth,
        sourceHeight,
      });
      if (!this.warpMap) return;
    }

    this.sourceCtx.drawImage(video, 0, 0, sourceWidth, sourceHeight);
    const source = this.sourceCtx.getImageData(0, 0, sourceWidth, sourceHeight).data;
    const dest = this.warpImage.data;
    const offsets = this.warpMap.offsets;

    for (let i = 0, o = 0; i < offsets.length; i += 1, o += 4) {
      const src = offsets[i];
      dest[o] = source[src];
      dest[o + 1] = source[src + 1];
      dest[o + 2] = source[src + 2];
    }

    this.warpCtx.putImageData(this.warpImage, 0, 0);
    this.#buildDescriptor(dest);

    // Per-cell difference against the previous frame drives motion detection.
    if (this.hasPrevious) {
      this.#diffDescriptors(this.previousDescriptor, this.cellDiffs);
      this.motion = this.#topAverage(this.cellDiffs, 3);
    } else {
      this.cellDiffs.fill(0);
      this.motion = 0;
    }
    this.lastCellDiffs.set(this.cellDiffs);

    const motionThreshold = 0.07 / this.sensitivity;

    // Check changed cells against reference (if reference exists)
    const refChangedCells = [];
    if (this.reference) {
      this.#diffDescriptors(this.reference, this.refDiffs);
      const changeThreshold = 0.1 / this.sensitivity;
      for (let cell = 0; cell < GRID * GRID; cell += 1) {
        if (this.refDiffs[cell] >= changeThreshold) {
          refChangedCells.push(cell);
        }
      }
    }

    // Hand/arm occlusion detection
    const occlusion = detectHandOrOcclusion(refChangedCells);
    if (occlusion.occluded) {
      this.occluded = true;
      this.occlusionReason = occlusion.reason;
      this.stableSince = null; // Always restart settle timer when hand/occlusion is present!
      this.#setMode('occluded');
      if (this.recording) {
        this.#recordFrame(now, refChangedCells);
      }
      this.#swapBuffers();
      this.#emitState(false);
      return;
    }
    this.occluded = false;
    this.occlusionReason = null;

    if (!this.reference || this.syncOnNextFrame) {
      if (this.motion <= motionThreshold) {
        if (this.stableSince == null) this.stableSince = now;
        if (now - this.stableSince >= this.settleMs) {
          this.reference = this.descriptor.slice();
          this.syncOnNextFrame = false;
          this.stableSince = now;
          this.lastAnalysisAt = now;
          this.#emitState(true);
        }
      } else {
        this.stableSince = null;
      }
    }

    if (this.pending) {
      this.#setMode('pending');
    } else if (this.motion > motionThreshold) {
      this.stableSince = null;
      this.#setMode('motion');
    } else {
      if (this.stableSince == null) this.stableSince = now;
      const settled = now - this.stableSince >= this.settleMs;
      const cooledDown = now - this.lastAnalysisAt >= Math.max(this.settleMs, ANALYSIS_COOLDOWN_MS);
      if (this.reference && settled && cooledDown) {
        this.lastAnalysisAt = now;
        this.#analyze(now, refChangedCells);
      } else {
        this.#setMode('watching');
      }
    }

    if (this.recording) {
      this.#recordFrame(now, refChangedCells);
    }

    this.#swapBuffers();
    this.#emitState(false);
  }

  #swapBuffers() {
    const swap = this.previousDescriptor;
    this.previousDescriptor = this.descriptor;
    this.descriptor = swap;
    this.hasPrevious = true;
  }

  #recordFrame(now, changedCells) {
    if (this.recordedFrames.length >= 1200) {
      this.recordedFrames.shift();
    }
    this.recordedFrames.push({
      timestamp: Math.round(now),
      motion: Number(this.motion.toFixed(4)),
      mode: this.mode,
      changedCells: [...changedCells],
      cellDiffs: Array.from(this.lastCellDiffs).map((v) => Number(v.toFixed(3))),
    });
  }

  #buildDescriptor(pixels) {
    const descriptor = this.descriptor;
    descriptor.fill(0);

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumGrad = 0;
    let samples = 0;

    const stride = DEST_SIZE * 4;

    for (let y = 0; y < DEST_SIZE; y += SAMPLE_STEP) {
      const rowBase = y * stride;
      const cellRow = y >> 6;
      const blockRow = (y & 63) >> 3;

      for (let x = 0; x < DEST_SIZE; x += SAMPLE_STEP) {
        const index = rowBase + x * 4;
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];

        const cellCol = x >> 6;
        const blockCol = (x & 63) >> 3;
        const cell = cellRow * GRID + cellCol;
        const block = blockRow * 8 + blockCol;
        const base = cell * VALUES_PER_CELL + block * VALUES_PER_BLOCK;

        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const rightX = Math.min(DEST_SIZE - 1, x + SAMPLE_STEP);
        const downY = Math.min(DEST_SIZE - 1, y + SAMPLE_STEP);
        const rightIndex = rowBase + rightX * 4;
        const downIndex = downY * stride + x * 4;
        const lumRight = 0.299 * pixels[rightIndex] + 0.587 * pixels[rightIndex + 1] + 0.114 * pixels[rightIndex + 2];
        const lumDown = 0.299 * pixels[downIndex] + 0.587 * pixels[downIndex + 1] + 0.114 * pixels[downIndex + 2];
        const gradient = Math.abs(lumRight - lum) + Math.abs(lumDown - lum);

        descriptor[base] += r;
        descriptor[base + 1] += g;
        descriptor[base + 2] += b;
        descriptor[base + 3] += gradient;

        sumR += r;
        sumG += g;
        sumB += b;
        sumGrad += gradient;
        samples += 1;
      }
    }

    const meanR = Math.max(1, sumR / samples);
    const meanG = Math.max(1, sumG / samples);
    const meanB = Math.max(1, sumB / samples);
    const meanGrad = Math.max(0.5, sumGrad / samples);

    // Normalize by the frame's global channel means. This is what makes the
    // detector tolerant to exposure and white-balance changes.
    for (let cell = 0; cell < GRID * GRID; cell += 1) {
      const cellBase = cell * VALUES_PER_CELL;
      for (let block = 0; block < BLOCKS_PER_CELL; block += 1) {
        const base = cellBase + block * VALUES_PER_BLOCK;
        descriptor[base] /= meanR;
        descriptor[base + 1] /= meanG;
        descriptor[base + 2] /= meanB;
        descriptor[base + 3] /= meanGrad;
      }
    }
  }

  #diffDescriptors(other, target) {
    const descriptor = this.descriptor;
    for (let cell = 0; cell < GRID * GRID; cell += 1) {
      const cellBase = cell * VALUES_PER_CELL;
      let sum = 0;
      let max = 0;

      for (let block = 0; block < BLOCKS_PER_CELL; block += 1) {
        const base = cellBase + block * VALUES_PER_BLOCK;
        const blockDiff = (
          Math.abs(descriptor[base] - other[base])
          + Math.abs(descriptor[base + 1] - other[base + 1])
          + Math.abs(descriptor[base + 2] - other[base + 2])
          + Math.abs(descriptor[base + 3] - other[base + 3])
        ) / VALUES_PER_BLOCK;
        sum += blockDiff;
        if (blockDiff > max) max = blockDiff;
      }

      const mean = sum / BLOCKS_PER_CELL;
      target[cell] = 0.5 * (mean + max);
    }
  }

  #topAverage(values, count) {
    let first = 0;
    let second = 0;
    let third = 0;
    for (let i = 0; i < values.length; i += 1) {
      const value = values[i];
      if (value > first) {
        third = second;
        second = first;
        first = value;
      } else if (value > second) {
        third = second;
        second = value;
      } else if (value > third) {
        third = value;
      }
    }
    const n = Math.min(count, values.length);
    if (n === 1) return first;
    if (n === 2) return (first + second) / 2;
    return (first + second + third) / 3;
  }

  #analyze(now = performance.now(), providedChangedCells = null) {
    if (!this.reference) return;
    if (!this.legalMovesProvider) {
      this.#setMode('watching');
      return;
    }

    let changedCells = providedChangedCells;
    if (!changedCells) {
      // Compare against the last accepted board, not the previous frame.
      this.#diffDescriptors(this.reference, this.cellDiffs);
      this.lastCellDiffs.set(this.cellDiffs);

      const changeThreshold = 0.1 / this.sensitivity;
      changedCells = [];
      for (let cell = 0; cell < GRID * GRID; cell += 1) {
        if (this.cellDiffs[cell] >= changeThreshold) changedCells.push(cell);
      }
    } else {
      this.lastCellDiffs.set(this.refDiffs);
    }

    if (!changedCells.length) {
      this.#setMode('watching');
      return;
    }

    // Camera / board drift detection: if many cells changed and no legal move matches
    if (changedCells.length >= 22) {
      if (this.driftCandidateSince == null) {
        this.driftCandidateSince = now;
      } else if (now - this.driftCandidateSince >= 3000) {
        this.driftDetected = true;
        if (this.callbacks.onDrift) {
          try {
            this.callbacks.onDrift({ changedCount: changedCells.length });
          } catch {
            /* ignore */
          }
        }
      }
    } else {
      this.driftCandidateSince = null;
      this.driftDetected = false;
    }

    let legalMoves = [];
    try {
      legalMoves = this.legalMovesProvider() || [];
    } catch {
      legalMoves = [];
    }

    if (!legalMoves.length) {
      // The game is over or the position is unavailable. Do not guess.
      this.#setMode('watching');
      return;
    }

    const scored = legalMoves
      .map((move) => {
        const result = scoreMoveAgainstChanges(move, changedCells, this.flip);
        return {
          uci: `${move.from}${move.to}${move.promotion || ''}`,
          san: move.san,
          from: move.from,
          to: move.to,
          color: move.color,
          flags: move.flags,
          score: result.score,
          scorePercent: Math.round(result.score * 100),
          hits: result.hits,
          expectedCount: result.expectedCount,
          extras: result.extras,
          missing: result.missing,
          expectedCells: result.expectedCells,
        };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const second = scored[1];
    const margin = best.score - (second?.score ?? 0);
    const autoAccept = (
      best.score >= 0.72
      && margin >= 0.15
      && best.extras <= 1
      && best.missing <= 1
      && changedCells.length <= 10
    );

    const candidates = scored.slice(0, 3).map((candidate) => ({
      ...candidate,
      expectedCells: undefined,
    }));

    if (this.testMode) {
      if (this.callbacks.onTestDetection) {
        try {
          this.callbacks.onTestDetection({
            changedCells,
            candidates,
            best,
            second,
            margin,
          });
        } catch {
          /* ignore */
        }
      }
      this.#setMode('watching');
      return;
    }

    this.pending = {
      descriptor: this.descriptor.slice(),
      changedCells: [...changedCells],
      candidates,
    };

    const payload = {
      changedCells,
      candidates,
      autoAccept,
      best,
      second,
      margin,
    };

    this.#setMode(autoAccept ? 'analyzing' : 'pending');
    if (this.callbacks.onDetection) {
      try {
        this.callbacks.onDetection(payload);
      } catch (error) {
        this.rejectPending();
        if (this.callbacks.onError) {
          try {
            this.callbacks.onError(error);
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  #resetTemporal() {
    this.stableSince = null;
    this.lastAnalysisAt = performance.now();
    this.motion = 0;
    this.hasPrevious = false;
    this.cellDiffs.fill(0);
    this.lastCellDiffs.fill(0);
  }

  #setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.#emitState(true);
  }

  #emitState(force) {
    const now = performance.now();
    if (!force && now - this.lastEmitAt < 250 && this.lastEmittedMode === this.mode) return;
    this.lastEmitAt = now;
    this.lastEmittedMode = this.mode;
    if (this.callbacks.onState) {
      try {
        this.callbacks.onState({
          mode: this.mode,
          motion: this.motion,
          cellDiffs: this.lastCellDiffs,
        });
      } catch {
        /* state callbacks must never stop the loop */
      }
    }
  }
}

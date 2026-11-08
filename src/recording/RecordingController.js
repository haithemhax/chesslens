/**
 * Video recording controller using the browser's MediaRecorder API.
 * Reuses the existing MediaStream without requesting additional device handles.
 *
 * Features:
 * - Codec fallback: WebM VP9 -> VP8 -> default.
 * - Auto-split into independent, valid playable segments (default 10 mins).
 * - Multi-chunk timeslice (5s) for smooth memory handling.
 * - File System Access API support with fallback to browser downloads.
 * - Low disk space check (navigator.storage.estimate).
 * - Safe error handling that notifies operator without stopping the show.
 */

export function getSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

export function sanitizeFilenamePart(value, fallback = 'chess') {
  if (!value || typeof value !== 'string') return fallback;
  const clean = value
    .trim()
    .replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return clean || fallback;
}

export function formatFilename({ eventName, whitePlayer, blackPlayer, partIndex = 1, timestamp, extension = 'webm' }) {
  const event = sanitizeFilenamePart(eventName, 'ChessShow');
  const white = sanitizeFilenamePart(whitePlayer, 'White');
  const black = sanitizeFilenamePart(blackPlayer, 'Black');
  const rawTs = timestamp || new Date().toISOString();
  const ts = rawTs.replace(/[:.]/g, '-').slice(0, 19);
  return `${event}_${white}_vs_${black}_${ts}_part${partIndex}.${extension}`;
}

export class RecordingController {
  constructor({ onState, onSegmentSaved, onError, onStorageLow } = {}) {
    this.onState = onState || null;
    this.onSegmentSaved = onSegmentSaved || null;
    this.onError = onError || null;
    this.onStorageLow = onStorageLow || null;

    this.mediaRecorder = null;
    this.stream = null;
    this.isScreenRecording = false;
    this.active = false;
    this.startedAt = 0;
    this.timerId = null;
    this.segmentTimerId = null;

    this.segmentIndex = 1;
    this.savedSegmentsCount = 0;
    this.currentChunks = [];

    this.bitrateMbps = 4;
    this.segmentMinutes = 10;
    this.dirHandle = null;
    this.meta = {
      eventName: 'Live Chess Show',
      whitePlayer: 'White',
      blackPlayer: 'Black',
      timestamp: '',
    };
  }

  setDirectoryHandle(handle) {
    this.dirHandle = handle;
  }

  getDirectoryHandle() {
    return this.dirHandle;
  }

  async selectDirectory() {
    if (typeof window === 'undefined' || !window.showDirectoryPicker) {
      throw new Error('File System Access API is not supported in this browser');
    }
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    this.dirHandle = handle;
    return handle;
  }

  async start({
    stream,
    isScreen = false,
    eventName = 'Live Chess Show',
    whitePlayer = 'White',
    blackPlayer = 'Black',
    bitrateMbps = 4,
    segmentMinutes = 10,
  }) {
    if (this.active) {
      this.stop();
    }

    if (!stream || !stream.active) {
      throw new Error('No active MediaStream available to record');
    }

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== 'live') {
      throw new Error('MediaStream has no active video track');
    }

    this.stream = stream;
    this.isScreenRecording = isScreen;
    this.bitrateMbps = Math.max(1, Math.min(10, bitrateMbps));
    this.segmentMinutes = Math.max(1, Math.min(60, segmentMinutes));
    this.segmentIndex = 1;
    this.savedSegmentsCount = 0;
    this.currentChunks = [];
    this.meta = {
      eventName,
      whitePlayer,
      blackPlayer,
      timestamp: new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19),
    };

    if (isScreen) {
      videoTrack.addEventListener(
        'ended',
        () => {
          if (this.active) {
            this.stop();
          }
        },
        { once: true },
      );
    }

    // Check storage estimate before starting
    this.#checkStorage().catch(() => {});

    this.startedAt = Date.now();
    this.active = true;

    this.#startRecorderInstance();

    this.timerId = setInterval(() => {
      this.#emitState();
    }, 1000);

    this.#emitState();
  }

  #startRecorderInstance() {
    const mimeType = getSupportedMimeType();
    const options = {
      videoBitsPerSecond: this.bitrateMbps * 1_000_000,
    };
    if (mimeType) {
      options.mimeType = mimeType;
    }

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, options);
    } catch (err) {
      this.active = false;
      if (this.onError) this.onError(err);
      throw err;
    }

    this.currentChunks = [];

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.currentChunks.push(event.data);
      }
    };

    this.mediaRecorder.onerror = (event) => {
      const err = event.error || new Error('MediaRecorder error');
      console.warn('Recording error', err);
      if (this.onError) this.onError(err);
    };

    this.mediaRecorder.onstop = () => {
      this.#finalizeCurrentSegment();
    };

    // Emit chunk every 5 seconds (5000 ms)
    this.mediaRecorder.start(5000);

    // Schedule next segment split
    const segmentDurationMs = this.segmentMinutes * 60 * 1000;
    clearTimeout(this.segmentTimerId);
    this.segmentTimerId = setTimeout(() => {
      if (this.active) {
        this.#rotateSegment();
      }
    }, segmentDurationMs);
  }

  #rotateSegment() {
    if (!this.active || !this.mediaRecorder) return;
    if (this.mediaRecorder.state !== 'inactive') {
      // Stopping flushes the current segment, onstop saves it
      try {
        this.mediaRecorder.stop();
      } catch {
        /* ignore */
      }
    }
    // Start fresh segment with clean EBML headers for part N+1
    this.segmentIndex += 1;
    this.#startRecorderInstance();
    this.#checkStorage().catch(() => {});
  }

  async #finalizeCurrentSegment() {
    const chunks = this.currentChunks;
    const partNum = this.segmentIndex;
    this.currentChunks = [];

    if (!chunks.length) return;

    const mimeType = this.mediaRecorder?.mimeType || 'video/webm';
    const blob = new Blob(chunks, { type: mimeType });
    const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';

    const filename = formatFilename({
      eventName: this.meta.eventName,
      whitePlayer: this.meta.whitePlayer,
      blackPlayer: this.meta.blackPlayer,
      partIndex: partNum,
      timestamp: this.meta.timestamp,
      extension,
    });

    const result = await this.#saveBlob(blob, filename);
    this.savedSegmentsCount += 1;
    if (this.onSegmentSaved) {
      try {
        this.onSegmentSaved({
          filename,
          blob,
          partIndex: partNum,
          sizeBytes: blob.size,
          method: result.method,
        });
      } catch {
        /* ignore callback error */
      }
    }
  }

  async #saveBlob(blob, filename) {
    if (this.dirHandle && typeof this.dirHandle.getFileHandle === 'function') {
      try {
        const fileHandle = await this.dirHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { success: true, method: 'filesystem', filename };
      } catch (err) {
        console.warn('Direct file system write failed; falling back to download', err);
      }
    }

    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 2500);
      return { success: true, method: 'download', filename };
    } catch (err) {
      console.error('Download fallback failed', err);
      return { success: false, method: 'none', error: err };
    }
  }

  async #checkStorage() {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const freeBytes = (est.quota || 0) - (est.usage || 0);
        if (est.quota && freeBytes < 500 * 1024 * 1024) {
          // Less than 500 MB free
          if (this.onStorageLow) {
            this.onStorageLow({
              freeBytes,
              freeMb: Math.round(freeBytes / (1024 * 1024)),
            });
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  #emitState() {
    if (!this.onState) return;
    const elapsed = this.active ? Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000)) : 0;
    try {
      this.onState({
        active: this.active,
        source: this.isScreenRecording ? 'screen' : 'camera',
        startedAt: this.startedAt,
        elapsedSeconds: elapsed,
        segmentIndex: this.segmentIndex,
        savedSegments: this.savedSegmentsCount,
        hasDirectory: Boolean(this.dirHandle),
      });
    } catch {
      /* ignore */
    }
  }

  stop() {
    if (!this.active && !this.mediaRecorder) return;
    this.active = false;
    clearTimeout(this.segmentTimerId);
    clearInterval(this.timerId);

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        /* ignore */
      }
    }

    if (this.isScreenRecording && this.stream) {
      try {
        this.stream.getTracks().forEach((track) => track.stop());
      } catch {
        /* ignore */
      }
    }

    this.mediaRecorder = null;
    this.stream = null;
    this.isScreenRecording = false;

    this.#emitState();
  }

  dispose() {
    this.stop();
    this.dirHandle = null;
  }
}

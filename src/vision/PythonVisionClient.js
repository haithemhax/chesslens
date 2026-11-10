const PROTOCOL_VERSION = 1;
const DEFAULT_URL = 'ws://127.0.0.1:8765';
const MAX_IN_FLIGHT_FRAMES = 2;
const HEARTBEAT_INTERVAL_MS = 1000;
const STALL_TIMEOUT_MS = 1500;

export class PythonVisionClient {
  constructor({ url = DEFAULT_URL, onObservation, onState, onProposal, onError, onConnectionChange } = {}) {
    this.url = url;
    this.callbacks = {
      onObservation: onObservation || null,
      onState: onState || null,
      onProposal: onProposal || null,
      onError: onError || null,
      onConnectionChange: onConnectionChange || null,
    };

    this.ws = null;
    this.connected = false;
    this.handshakeComplete = false;
    this.serviceCapabilities = [];
    this.protocolMismatch = false;

    this.inFlightCount = 0;
    this.frameSeq = 0;
    this.frameTimestamps = new Map();

    this.lastMessageAt = 0;
    this.latencies = [];
    this.currentLatencyMs = 0;
    this.errorCount = 0;
    this.totalMessages = 0;

    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.heartbeatTimer = null;
    this.disposed = false;
  }

  connect() {
    if (this.disposed || this.ws) return;

    try {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';
    } catch (err) {
      this.#handleDisconnect(err);
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.#sendJson({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        appVersion: '1.0.0',
      });
      this.#startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      this.lastMessageAt = performance.now();
      this.totalMessages += 1;
      this.#handleMessage(event.data);
    };

    this.ws.onerror = (err) => {
      this.errorCount += 1;
      this.callbacks.onError?.(err);
    };

    this.ws.onclose = () => {
      this.#handleDisconnect();
    };
  }

  disconnect() {
    this.disposed = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeatTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.connected = false;
    this.handshakeComplete = false;
  }

  #startHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const now = performance.now();
      if (this.lastMessageAt && now - this.lastMessageAt > STALL_TIMEOUT_MS) {
        // Stalled
        this.callbacks.onConnectionChange?.(this.connected, false);
      }
      this.#sendJson({ type: 'ping', ts: Math.round(now) });
    }, HEARTBEAT_INTERVAL_MS);
  }

  #handleDisconnect(err = null) {
    this.connected = false;
    this.handshakeComplete = false;
    this.inFlightCount = 0;
    this.frameTimestamps.clear();
    this.ws = null;
    clearInterval(this.heartbeatTimer);

    this.callbacks.onConnectionChange?.(false, false);

    if (!this.disposed) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectDelay = Math.min(10000, Math.round(this.reconnectDelay * 1.5));
        this.connect();
      }, this.reconnectDelay);
    }
  }

  #handleMessage(raw) {
    if (typeof raw !== 'string') return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.errorCount += 1;
      return;
    }

    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'hello_ack': {
        if (msg.protocol !== PROTOCOL_VERSION) {
          this.protocolMismatch = true;
          this.callbacks.onError?.(new Error(`Protocol mismatch: expected ${PROTOCOL_VERSION}, got ${msg.protocol}`));
          return;
        }
        this.connected = true;
        this.handshakeComplete = true;
        this.serviceCapabilities = Array.isArray(msg.capabilities) ? msg.capabilities : [];
        this.callbacks.onConnectionChange?.(true, true);
        break;
      }

      case 'pong': {
        if (msg.ts) {
          const rtt = performance.now() - msg.ts;
          this.#recordLatency(rtt);
        }
        break;
      }

      case 'status': {
        this.callbacks.onState?.(msg);
        break;
      }

      case 'observation': {
        if (msg.frameId != null) {
          const sentAt = this.frameTimestamps.get(msg.frameId);
          if (sentAt) {
            this.#recordLatency(performance.now() - sentAt);
            this.frameTimestamps.delete(msg.frameId);
          }
          if (this.inFlightCount > 0) this.inFlightCount -= 1;
        }
        this.callbacks.onObservation?.(msg);
        break;
      }

      case 'calibration_proposal': {
        this.callbacks.onProposal?.(msg);
        break;
      }

      case 'error': {
        this.errorCount += 1;
        this.callbacks.onError?.(new Error(msg.message || 'Unknown vision service error'));
        break;
      }

      default:
        break;
    }
  }

  #recordLatency(ms) {
    this.currentLatencyMs = ms;
    this.latencies.push(ms);
    if (this.latencies.length > 30) this.latencies.shift();
  }

  getP95Latency() {
    if (!this.latencies.length) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return sorted[idx];
  }

  isHealthy() {
    if (!this.connected || !this.handshakeComplete || this.protocolMismatch) {
      return false;
    }
    const now = performance.now();
    if (this.lastMessageAt && now - this.lastMessageAt > STALL_TIMEOUT_MS) {
      return false;
    }
    if (this.getP95Latency() > 800) {
      return false;
    }
    const errorRate = this.totalMessages > 0 ? this.errorCount / this.totalMessages : 0;
    if (errorRate > 0.05) {
      return false;
    }
    return true;
  }

  #sendJson(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  setCalibration(corners, flip, orientation = 'white') {
    return this.#sendJson({
      type: 'set_calibration',
      corners,
      flip: Boolean(flip),
      orientation,
    });
  }

  autoCalibrate() {
    return this.#sendJson({ type: 'auto_calibrate' });
  }

  setPosition(fen, ply = 0) {
    return this.#sendJson({ type: 'set_position', fen, ply });
  }

  learnStartPosition() {
    return this.#sendJson({ type: 'learn_start_position' });
  }

  learnFromCurrentFrame(fen) {
    return this.#sendJson({ type: 'learn_from_current_frame', fen });
  }

  setConfig(config) {
    return this.#sendJson({ type: 'set_config', ...config });
  }

  reset() {
    return this.#sendJson({ type: 'reset' });
  }

  /**
   * Send binary frame to Python with backpressure check.
   * Frame binary layout: [uint32 BE headerLen][UTF-8 JSON header][JPEG bytes]
   */
  sendFrame(jpegBlobOrBuffer, width, height) {
    if (!this.connected || !this.handshakeComplete || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (this.inFlightCount >= MAX_IN_FLIGHT_FRAMES) {
      // Backpressure: drop frame
      return false;
    }

    this.frameSeq += 1;
    const frameId = this.frameSeq;
    const ts = performance.now();
    this.frameTimestamps.set(frameId, ts);
    this.inFlightCount += 1;

    const header = JSON.stringify({ frameId, ts: Math.round(ts), width, height });
    const encoder = new TextEncoder();
    const headerBytes = encoder.encode(header);
    const headerLength = headerBytes.length;

    if (jpegBlobOrBuffer instanceof ArrayBuffer || ArrayBuffer.isView(jpegBlobOrBuffer)) {
      const imgBytes = jpegBlobOrBuffer instanceof ArrayBuffer
        ? new Uint8Array(jpegBlobOrBuffer)
        : new Uint8Array(jpegBlobOrBuffer.buffer, jpegBlobOrBuffer.byteOffset, jpegBlobOrBuffer.byteLength);

      const packet = new Uint8Array(4 + headerLength + imgBytes.length);
      const view = new DataView(packet.buffer);
      view.setUint32(0, headerLength, false); // Big-Endian
      packet.set(headerBytes, 4);
      packet.set(imgBytes, 4 + headerLength);

      try {
        this.ws.send(packet);
        return true;
      } catch {
        this.inFlightCount = Math.max(0, this.inFlightCount - 1);
        this.frameTimestamps.delete(frameId);
        return false;
      }
    }

    return false;
  }
}

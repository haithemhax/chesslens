# ChessLens Vision WebSocket Protocol

**Version**: `1` (`PROTOCOL_VERSION = 1`)  
**Transport**: WebSocket over TCP (`ws://127.0.0.1:8765`)  
**Security**: Localhost only (`127.0.0.1`). Rejects remote connections. Maximum frame payload size is capped (10 MB). No arbitrary file system access allowed via messages.

---

## 1. Overview & Architecture

ChessLens employs a split-architecture model:
1. **Browser (Host & Source of Truth)**:
   - Holds the single `MediaStream` hardware camera lock (via USB phone webcam).
   - Manages match state, moves, user interface, clocks, and `chess.js` validation.
   - Downscales video frames to JPEG (~640x480, 8–15 fps, quality 0.75) and transmits them as binary packets with a compact header.
   - Applies strict backpressure (at most 2 in-flight frames).
2. **Python Vision Service (Optional Accelerating Worker)**:
   - Runs locally on `127.0.0.1:8765`.
   - Never touches webcam hardware directly.
   - Computes perspective transformation (homography), CLAHE color correction, per-cell descriptors, and move ranking.
   - Emits observations and suggestions back to the browser.
   - The browser validates all candidates with `chess.js` before executing.

---

## 2. Coordinate System & Test Vectors

### A. Normalized Calibration Corners
Corners are provided as 4 normalized $[0, 1]$ points relative to the original frame dimensions:
```json
[
  [x0, y0], // 0: Top-Left (TL)     -> mapped to (0, 0)
  [x1, y1], // 1: Top-Right (TR)    -> mapped to (511, 0)
  [x2, y2], // 2: Bottom-Right (BR) -> mapped to (511, 511)
  [x3, y3]  // 3: Bottom-Left (BL)  -> mapped to (0, 511)
]
```

### B. Warped Board Grid (8x8)
- Warped image space: $512 \times 512$ pixels.
- Cells: $64 \times 64$ pixels each.
- Cell Index formula:
  $$\text{cellIndex} = \text{row} \times 8 + \text{col} \quad (0 \le \text{cellIndex} \le 63)$$
  - $\text{row} \in [0, 7]$ from top to bottom.
  - $\text{col} \in [0, 7]$ from left to right.

### C. Standard Board Mapping (`flip = false`, White South)
- $\text{row} = 0 \iff \text{Rank 8}$
- $\text{row} = 7 \iff \text{Rank 1}$
- $\text{col} = 0 \iff \text{File a}$
- $\text{col} = 7 \iff \text{File h}$

### D. Flipped Board Mapping (`flip = true`, Black South)
- $\text{row} = 0 \iff \text{Rank 1}$
- $\text{row} = 7 \iff \text{Rank 8}$
- $\text{col} = 0 \iff \text{File h}$
- $\text{col} = 7 \iff \text{File a}$

### E. Shared Test Vector (Mandatory for JS & Python Verification)
The following canonical test vector must pass identically in both JS (`test-logic.mjs`) and Python (`test_protocol.py`):

| Square | `flip = false` (Cell Index) | `flip = true` (Cell Index) |
| :---: | :---: | :---: |
| **`a8`** | `0` (row 0, col 0) | `63` (row 7, col 7) |
| **`h8`** | `7` (row 0, col 7) | `56` (row 7, col 0) |
| **`a1`** | `56` (row 7, col 0) | `7` (row 0, col 7) |
| **`h1`** | `63` (row 7, col 7) | `0` (row 0, col 0) |
| **`e4`** | `36` (row 4, col 4) | `27` (row 3, col 3) |

---

## 3. Messages: Browser -> Python (Client to Server)

All control messages are UTF-8 JSON text. Camera frames are binary packets.

### 1. `hello`
Sent immediately upon WebSocket connection:
```json
{
  "type": "hello",
  "protocol": 1,
  "appVersion": "1.0.0"
}
```

### 2. `frame` (Binary Message)
Binary structure:
```
[ 4 bytes: uint32 Big-Endian (Header Length N) ]
[ N bytes: UTF-8 JSON Header ]
[ Remaining bytes: Raw JPEG image bytes ]
```
JSON Header schema:
```json
{
  "frameId": 1042,
  "ts": 1731095000123,
  "width": 640,
  "height": 480
}
```

### 3. `set_calibration`
Sent on initial connect and whenever corners or orientation change:
```json
{
  "type": "set_calibration",
  "corners": [
    [0.12, 0.08],
    [0.88, 0.09],
    [0.91, 0.92],
    [0.11, 0.90]
  ],
  "flip": false,
  "orientation": "white"
}
```

### 4. `auto_calibrate`
Request Python to run automatic corner edge/contour detection:
```json
{
  "type": "auto_calibrate"
}
```

### 5. `set_position`
Synchronizes current game state after every move, undo, or new game:
```json
{
  "type": "set_position",
  "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  "ply": 1
}
```

### 6. `learn_start_position`
Instructs Python to calibrate empty and piece cell descriptors from the standard start FEN:
```json
{
  "type": "learn_start_position"
}
```

### 7. `learn_from_current_frame`
Online refinement using current board frame and authoritative FEN:
```json
{
  "type": "learn_from_current_frame",
  "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
}
```

### 8. `set_config`
Configures sensitivity and settle parameters:
```json
{
  "type": "set_config",
  "settleMs": 400,
  "motionSensitivity": 1.0,
  "thresholds": {
    "matchScore": 0.72,
    "marginLead": 0.15
  }
}
```

### 9. `reset` & `ping`
```json
{ "type": "reset" }
{ "type": "ping", "ts": 1731095000123 }
```

---

## 4. Messages: Python -> Browser (Server to Client)

All messages from server to client are UTF-8 JSON text (with optional base64 or separate binary JPEG previews).

### 1. `hello_ack`
```json
{
  "type": "hello_ack",
  "protocol": 1,
  "serviceVersion": "1.0.0",
  "capabilities": ["warp", "classifier", "auto_calibrate", "drift_detect"]
}
```

### 2. `status` (Periodic: every ~500 ms)
```json
{
  "type": "status",
  "state": "tracking", // "idle" | "calibrating" | "tracking" | "occluded" | "drift" | "error"
  "fps": 14.5,
  "latencyMs": 42.1,
  "cpu": 8.4,
  "classifierReady": true
}
```

### 3. `calibration_proposal`
Response to `auto_calibrate`:
```json
{
  "type": "calibration_proposal",
  "corners": [
    [0.125, 0.082],
    [0.875, 0.089],
    [0.902, 0.915],
    [0.108, 0.901]
  ],
  "confidence": 0.94
}
```

### 4. `observation`
Emitted when board analysis completes on a settled frame:
```json
{
  "type": "observation",
  "frameId": 1042,
  "stable": true,
  "occluded": false,
  "drift": false,
  "grid": [
    { "empty": 0.01, "white": 0.98, "black": 0.01 } // 64 items (row 0 to 7)
  ],
  "changedCells": [
    { "cell": 52, "r": 6, "c": 4, "score": 0.88 },
    { "cell": 36, "r": 4, "c": 4, "score": 0.92 }
  ],
  "candidates": [
    { "uci": "e2e4", "score": 0.95, "margin": 0.28 }
  ],
  "confidence": 0.95,
  "resync_suggested": false
}
```

### 5. `error`
```json
{
  "type": "error",
  "code": "BAD_MESSAGE",
  "message": "Malformed JSON payload",
  "recoverable": true
}
```

### 6. `pong`
```json
{
  "type": "pong",
  "ts": 1731095000123
}
```

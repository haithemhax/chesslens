"""ChessLens Python Vision Service (Phase 1 Skeleton & Stub Detector).
Local WebSocket server bound to 127.0.0.1:8765 only.
"""
import asyncio
import json
import logging
import os
import sys
import time
from typing import Any, Dict, Optional, Set

try:
    import websockets
except ImportError:
    websockets = None

from coordinates import square_to_cell, cell_to_square
from protocol import (
    PROTOCOL_VERSION,
    MAX_MESSAGE_BYTES,
    make_error,
    make_hello_ack,
    make_status,
    unpack_frame_binary,
    validate_client_message,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("VisionService")

HOST = "127.0.0.1"
PORT = 8765

class VisionStubDetector:
    """Stub computer vision detector for Phase 1 protocol and fallback verification."""

    def __init__(self):
        self.state = "idle"
        self.corners = None
        self.flip = False
        self.fen = None
        self.ply = 0
        self.settle_ms = 400
        self.frameCount = 0
        self.fps = 0.0
        self.last_status_time = time.monotonic()
        self.last_frame_time = time.monotonic()

    def set_calibration(self, corners, flip: bool):
        self.corners = corners
        self.flip = flip
        self.state = "tracking" if corners else "idle"

    def set_position(self, fen: str, ply: int):
        self.fen = fen
        self.ply = ply

    def process_frame(self, header: Dict[str, Any], jpeg_bytes: bytes) -> Dict[str, Any]:
        self.frameCount += 1
        now = time.monotonic()
        dt = now - self.last_frame_time
        if dt > 0:
            self.fps = 0.9 * self.fps + 0.1 * (1.0 / dt)
        self.last_frame_time = now

        # Stub observation payload
        frame_id = header.get("frameId", self.frameCount)
        return {
            "type": "observation",
            "frameId": frame_id,
            "stable": True,
            "occluded": False,
            "drift": False,
            "grid": [{"empty": 0.5, "white": 0.25, "black": 0.25}] * 64,
            "changedCells": [],
            "candidates": [],
            "confidence": 1.0,
            "resync_suggested": False,
        }

class VisionServer:
    def __init__(self, host: str = HOST, port: int = PORT):
        self.host = host
        self.port = port
        self.detector = VisionStubDetector()
        self.clients: Set[Any] = set()
        self.status_task: Optional[asyncio.Task] = None
        self.running = False

    async def start(self):
        if websockets is None:
            logger.error("Websockets package is not installed. Run scripts/setup-python.ps1 first.")
            sys.exit(1)

        self.running = True
        logger.info(f"Starting ChessLens Vision Service on ws://{self.host}:{self.port} (Protocol v{PROTOCOL_VERSION})")
        async with websockets.serve(
            self.handle_connection,
            self.host,
            self.port,
            max_size=MAX_MESSAGE_BYTES,
        ):
            self.status_task = asyncio.create_task(self._periodic_status_loop())
            await asyncio.Future()  # run forever

    async def _periodic_status_loop(self):
        while self.running:
            await asyncio.sleep(0.5)
            if not self.clients:
                continue
            status_msg = json.dumps(
                make_status(
                    state=self.detector.state,
                    fps=self.detector.fps,
                    latency_ms=25.0,
                    cpu=2.5,
                )
            )
            for ws in list(self.clients):
                try:
                    await ws.send(status_msg)
                except Exception:
                    pass

    async def handle_connection(self, websocket):
        # Security: restrict to localhost
        client_host = websocket.remote_address[0] if websocket.remote_address else ""
        if client_host not in ("127.0.0.1", "localhost", "::1"):
            logger.warning(f"Rejected non-localhost connection from {client_host}")
            await websocket.close(1008, "Localhost only")
            return

        self.clients.add(websocket)
        logger.info(f"Client connected from {client_host}")
        handshake_done = False

        try:
            async for raw_message in websocket:
                if isinstance(raw_message, bytes):
                    # Binary frame
                    if not handshake_done:
                        await websocket.send(json.dumps(make_error("HANDSHAKE_REQUIRED", "Must send hello before frames", False)))
                        continue
                    try:
                        header, jpeg_bytes = unpack_frame_binary(raw_message)
                        obs = self.detector.process_frame(header, jpeg_bytes)
                        await websocket.send(json.dumps(obs))
                    except Exception as err:
                        await websocket.send(json.dumps(make_error("BAD_FRAME", str(err), True)))
                    continue

                # Text JSON message
                try:
                    msg = json.loads(raw_message)
                except json.JSONDecodeError:
                    await websocket.send(json.dumps(make_error("BAD_JSON", "Malformed JSON payload", True)))
                    continue

                valid, err_msg = validate_client_message(msg)
                if not valid:
                    await websocket.send(json.dumps(make_error("SCHEMA_ERROR", err_msg or "Invalid message", True)))
                    continue

                mtype = msg.get("type")
                if mtype == "hello":
                    handshake_done = True
                    await websocket.send(json.dumps(make_hello_ack()))
                elif mtype == "ping":
                    await websocket.send(json.dumps({"type": "pong", "ts": msg.get("ts", 0)}))
                elif mtype == "set_calibration":
                    self.detector.set_calibration(msg.get("corners"), msg.get("flip", False))
                elif mtype == "set_position":
                    self.detector.set_position(msg.get("fen", ""), msg.get("ply", 0))
                elif mtype == "auto_calibrate":
                    # Stub corner proposal
                    await websocket.send(json.dumps({
                        "type": "calibration_proposal",
                        "corners": [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]],
                        "confidence": 0.95,
                    }))
                elif mtype == "set_config":
                    if "settleMs" in msg:
                        self.detector.settle_ms = msg["settleMs"]
                elif mtype == "reset":
                    self.detector.state = "idle"
                    self.detector.corners = None

        except websockets.exceptions.ConnectionClosed:
            logger.info("Client disconnected")
        finally:
            self.clients.discard(websocket)

if __name__ == "__main__":
    server = VisionServer()
    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        logger.info("Vision service stopped by user")

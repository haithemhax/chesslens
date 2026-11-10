"""Protocol validation, message types and frame serialization for ChessLens Vision Service.
Protocol Version: 1
"""
import json
import struct
from typing import Any, Dict, List, Optional, Tuple

PROTOCOL_VERSION = 1
MAX_MESSAGE_BYTES = 10 * 1024 * 1024  # 10 MB limit

def unpack_frame_binary(data: bytes) -> Tuple[Dict[str, Any], bytes]:
    """Unpack a binary frame packet:
    Layout: [4 bytes uint32 BE headerLen][N bytes UTF-8 JSON header][remaining bytes JPEG]
    """
    if len(data) > MAX_MESSAGE_BYTES:
        raise ValueError(f"Packet exceeds max limit of {MAX_MESSAGE_BYTES} bytes")
    if len(data) < 4:
        raise ValueError("Packet too short to contain header length")

    (header_len,) = struct.unpack(">I", data[:4])
    if len(data) < 4 + header_len:
        raise ValueError("Packet payload truncated before header end")

    header_raw = data[4 : 4 + header_len].decode("utf-8")
    header = json.loads(header_raw)
    jpeg_bytes = data[4 + header_len :]
    return header, jpeg_bytes

def pack_frame_binary(header: Dict[str, Any], jpeg_bytes: bytes) -> bytes:
    """Pack header dict and jpeg bytes into binary frame layout."""
    header_json = json.dumps(header).encode("utf-8")
    header_len = len(header_json)
    packet = bytearray()
    packet.extend(struct.pack(">I", header_len))
    packet.extend(header_json)
    packet.extend(jpeg_bytes)
    return bytes(packet)

def validate_client_message(msg: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """Validate incoming client message schemas."""
    if not isinstance(msg, dict):
        return False, "Message must be a JSON object"
    mtype = msg.get("type")
    if not mtype or not isinstance(mtype, str):
        return False, "Missing or invalid 'type' field"

    if mtype == "hello":
        if msg.get("protocol") != PROTOCOL_VERSION:
            return False, f"Protocol version mismatch: expected {PROTOCOL_VERSION}, got {msg.get('protocol')}"
        return True, None

    if mtype == "set_calibration":
        corners = msg.get("corners")
        if not isinstance(corners, list) or len(corners) != 4:
            return False, "set_calibration requires 'corners' array of 4 [x, y] coordinates"
        for pt in corners:
            if not isinstance(pt, (list, tuple)) or len(pt) != 2:
                return False, "Each corner must be [x, y]"
            if not (0.0 <= pt[0] <= 1.0 and 0.0 <= pt[1] <= 1.0):
                return False, "Corner coordinates must be normalized in range [0.0, 1.0]"
        return True, None

    if mtype == "set_position":
        if not isinstance(msg.get("fen"), str):
            return False, "set_position requires 'fen' string"
        return True, None

    if mtype in ("auto_calibrate", "learn_start_position", "learn_from_current_frame", "set_config", "reset", "ping"):
        return True, None

    return False, f"Unknown message type: {mtype}"

def make_hello_ack() -> Dict[str, Any]:
    return {
        "type": "hello_ack",
        "protocol": PROTOCOL_VERSION,
        "serviceVersion": "1.0.0",
        "capabilities": ["warp", "classifier", "auto_calibrate", "drift_detect"],
    }

def make_status(state: str, fps: float, latency_ms: float, cpu: float = 0.0) -> Dict[str, Any]:
    return {
        "type": "status",
        "state": state,
        "fps": round(fps, 1),
        "latencyMs": round(latency_ms, 1),
        "cpu": round(cpu, 1),
    }

def make_error(code: str, message: str, recoverable: bool = True) -> Dict[str, Any]:
    return {
        "type": "error",
        "code": code,
        "message": message,
        "recoverable": recoverable,
    }

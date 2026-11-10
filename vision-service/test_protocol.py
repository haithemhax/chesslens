"""Unit tests for Python Vision Service protocol, coordinate mapping, and security boundaries.
"""
import json

try:
    import pytest
except ImportError:
    pytest = None

from coordinates import square_to_cell, cell_to_square, SHARED_TEST_VECTORS
from protocol import (
    PROTOCOL_VERSION,
    MAX_MESSAGE_BYTES,
    pack_frame_binary,
    unpack_frame_binary,
    validate_client_message,
    make_hello_ack,
    make_status,
    make_error,
)

def test_shared_coordinate_vectors():
    """Verify that Python coordinate mapping satisfies the shared test vectors exactly."""
    for sq, flip, exp_cell, exp_row, exp_col in SHARED_TEST_VECTORS:
        cell = square_to_cell(sq, flipped=flip)
        assert cell == exp_cell, f"square_to_cell({sq}, flip={flip}): got {cell}, expected {exp_cell}"
        r = cell // 8
        c = cell % 8
        assert (r, c) == (exp_row, exp_col), f"Cell coordinates for {sq} (flip={flip}): got ({r}, {c}), expected ({exp_row}, {exp_col})"

        roundtrip = cell_to_square(cell, flipped=flip)
        assert roundtrip == sq, f"cell_to_square({cell}, flip={flip}): got {roundtrip}, expected {sq}"

def test_all_64_squares_roundtrip():
    """Verify that every square from a1 to h8 roundtrips in both normal and flipped modes."""
    files = "abcdefgh"
    for f in files:
        for rank in range(1, 9):
            sq = f"{f}{rank}"
            for flip in (False, True):
                cell = square_to_cell(sq, flipped=flip)
                assert 0 <= cell <= 63
                back = cell_to_square(cell, flipped=flip)
                assert back == sq

def test_pack_unpack_binary_frame():
    """Verify binary frame packing and unpacking with [uint32 BE headerLen][JSON][JPEG]."""
    header = {"frameId": 42, "ts": 1731000000, "width": 640, "height": 480}
    jpeg_dummy = b"\xff\xd8\xff\xe0dummy_jpeg_data\xff\xd9"

    packet = pack_frame_binary(header, jpeg_dummy)
    assert len(packet) > len(jpeg_dummy)

    unpacked_hdr, unpacked_jpeg = unpack_frame_binary(packet)
    assert unpacked_hdr == header
    assert unpacked_jpeg == jpeg_dummy

def test_unpack_frame_oversized_rejected():
    """Verify that frame packets exceeding max limit are rejected."""
    oversized = b"\x00" * (MAX_MESSAGE_BYTES + 1)
    failed = False
    try:
        unpack_frame_binary(oversized)
    except ValueError as err:
        failed = True
        assert "exceeds max limit" in str(err)
    assert failed, "Expected oversized frame to raise ValueError"

def test_unpack_frame_truncated_rejected():
    """Verify that truncated frame packets fail gracefully."""
    failed = False
    try:
        unpack_frame_binary(b"\x00\x01")
    except ValueError as err:
        failed = True
        assert "Packet too short" in str(err)
    assert failed, "Expected truncated frame to raise ValueError"

def test_validate_hello():
    ok, err = validate_client_message({"type": "hello", "protocol": PROTOCOL_VERSION, "appVersion": "1.0.0"})
    assert ok is True
    assert err is None

    # Version mismatch
    ok, err = validate_client_message({"type": "hello", "protocol": 999, "appVersion": "1.0.0"})
    assert ok is False
    assert "mismatch" in err

def test_validate_calibration():
    # Valid
    ok, err = validate_client_message({
        "type": "set_calibration",
        "corners": [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]],
        "flip": False,
    })
    assert ok is True

    # Bad count
    ok, err = validate_client_message({"type": "set_calibration", "corners": [[0.1, 0.1]]})
    assert ok is False

    # Out of bounds
    ok, err = validate_client_message({
        "type": "set_calibration",
        "corners": [[-0.5, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]],
    })
    assert ok is False

def test_validate_set_position():
    ok, err = validate_client_message({"type": "set_position", "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "ply": 0})
    assert ok is True

    ok, err = validate_client_message({"type": "set_position"})
    assert ok is False

if __name__ == "__main__":
    test_shared_coordinate_vectors()
    test_all_64_squares_roundtrip()
    test_pack_unpack_binary_frame()
    test_unpack_frame_oversized_rejected()
    test_unpack_frame_truncated_rejected()
    test_validate_hello()
    test_validate_calibration()
    test_validate_set_position()
    print("All Python protocol tests passed!")
